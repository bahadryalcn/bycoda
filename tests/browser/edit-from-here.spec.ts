import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const prompt = "Inspect the attached report and improve the result.";
const message = (page: Page) => page.locator('[data-prompt-anchor="edit-message"]');
const dialog = (page: Page) => page.getByRole("dialog", { name: "Edit from here?", exact: true });
const fixture = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          editFixture: {
            calls: Array<{ command: string; args: Record<string, unknown> }>;
            events: { rewinds: number; sends: number };
          };
        }
      ).editFixture,
  );
async function open(page: Page, query = "") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/tests/browser/edit-from-here.html?${query}`);
  const edit = message(page).getByRole("button", { name: "Edit from here", exact: true });
  await edit.focus();
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toHaveAccessibleDescription(
    'Rewind chat to before this message. Your prompt and attachments return to the composer. "Revert files too" also undoes your own edits.',
  );
}
async function restored(page: Page) {
  await expect(dialog(page)).toHaveCount(0);
  await expect(message(page)).toHaveCount(0);
  await expect(page.locator('[data-prompt-anchor="later-user"]')).toHaveCount(0);
  await expect(page.locator('[data-prompt-anchor="first"]')).toBeVisible();
  const composer = page.locator("textarea");
  await expect(composer).toHaveValue(prompt);
  await expect(composer).toBeFocused();
  expect(
    await composer.evaluate((field) => ({ start: field.selectionStart, end: field.selectionEnd })),
  ).toEqual({ start: prompt.length, end: prompt.length });
  await expect(page.getByRole("button", { name: "Remove report.csv", exact: true })).toBeVisible();
  expect((await fixture(page)).events).toEqual({ rewinds: 1, sends: 0 });
}

for (const worktree of [false, true]) {
  test(`keep changes restores prompt and attachments in ${worktree ? "worktree" : "current checkout"}`, async ({
    page,
  }) => {
    await open(page, worktree ? "worktree" : "");
    await expect(dialog(page)).toContainText("Session files: 2");
    await dialog(page)
      .getByRole("button", { name: "Revert and keep changes", exact: true })
      .click();
    await restored(page);
    expect((await fixture(page)).calls.map((call) => call.command)).toEqual([
      "session_files_revert_plan",
    ]);
  });
}

test("revert files reports reverted paths and protected conflicts before restoring draft", async ({
  page,
}) => {
  await open(page, "conflicts&worktree");
  await expect(dialog(page)).toContainText("Session files: 3");
  await expect(dialog(page)).toContainText("src/shared.ts: Changed by another session");
  await dialog(page).getByRole("button", { name: "Revert files too", exact: true }).click();
  await restored(page);
  await expect(page.getByText("src/answer.ts", { exact: false })).toBeVisible();
  await expect(page.getByText("src/new-file.ts", { exact: false })).toBeVisible();
  await expect(page.getByText("src/shared.ts", { exact: false })).toBeVisible();
  await expect(page.getByText("Changed by another session", { exact: false })).toBeVisible();
  await expect(page.locator("[data-session-files-revert-result]")).toContainText(
    "Reverted files: 2",
  );
  await expect(page.locator("[data-session-files-revert-result]")).toContainText(
    "Skipped files: 1",
  );
  await expect(page.locator("[data-session-files-revert-result]")).toBeInViewport();
  await page.screenshot({
    path: "temp/verification/v94w2/file-result.png",
    animations: "disabled",
  });
  const calls = (await fixture(page)).calls;
  expect(calls.map((call) => call.command)).toEqual([
    "session_files_revert_plan",
    "session_files_revert",
  ]);
  expect(calls[1].args).toEqual({
    sessionId: "edit-session",
    userBlockId: "edit-message",
    planToken: "fixture-plan",
  });
});

test("unavailable history disables file revert with its reason and permits keep changes", async ({
  page,
}) => {
  await open(page, "unavailable");
  const files = dialog(page).getByRole("button", { name: "Revert files too", exact: true });
  await expect(files).toBeDisabled();
  await expect(files).toHaveAttribute(
    "title",
    "File history for this older message is unavailable.",
  );
  await expect(dialog(page)).toContainText("File history for this older message is unavailable.");
  await dialog(page).getByRole("button", { name: "Revert and keep changes", exact: true }).click();
  await restored(page);
});

test("file error remains inline and retry restores the conversation once", async ({ page }) => {
  await open(page, "failRevert");
  await dialog(page).getByRole("button", { name: "Revert files too", exact: true }).click();
  await expect(dialog(page).getByRole("alert")).toContainText("File restoration failed");
  await expect(message(page)).toBeVisible();
  expect((await fixture(page)).events.rewinds).toBe(0);
  await dialog(page).getByRole("button", { name: "Revert files too", exact: true }).click();
  await restored(page);
});

test("pending state stays inside the clicked button and prevents duplicates", async ({ page }) => {
  await open(page, "slowRevert");
  await dialog(page).getByRole("button", { name: "Revert files too", exact: true }).click();
  await expect(
    dialog(page).getByRole("button", { name: "Reverting files…", exact: true }),
  ).toHaveAttribute("aria-busy", "true");
  await expect(
    dialog(page).getByRole("button", { name: "Revert and keep changes", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() =>
    (
      window as unknown as { editFixture: { releaseRevert: () => void } }
    ).editFixture.releaseRevert(),
  );
  await restored(page);
  expect(
    (await fixture(page)).calls.filter((call) => call.command === "session_files_revert"),
  ).toHaveLength(1);
});

test("conversation retry preserves successful file restoration and does not apply it twice", async ({
  page,
}) => {
  await open(page, "failConversation&conflicts");
  await dialog(page).getByRole("button", { name: "Revert files too", exact: true }).click();
  await expect(dialog(page).getByRole("alert")).toHaveText(
    "Files were reverted, but the conversation could not be rewound. Retry to finish editing this message.",
  );
  await expect(message(page)).toBeVisible();
  expect(
    (await fixture(page)).calls.filter((call) => call.command === "session_files_revert"),
  ).toHaveLength(1);
  await dialog(page).getByRole("button", { name: "Revert files too", exact: true }).click();
  await restored(page);
  expect(
    (await fixture(page)).calls.filter((call) => call.command === "session_files_revert"),
  ).toHaveLength(1);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { editFixture: { conversationAttempts: string[] } }).editFixture
          .conversationAttempts,
    ),
  ).toEqual(["edit-message", "edit-message"]);
});

test("Cancel preserves conversation and composer", async ({ page }) => {
  await page.goto("/tests/browser/edit-from-here.html");
  await page.locator("textarea").fill("Keep this draft");
  await message(page).getByRole("button", { name: "Edit from here", exact: true }).focus();
  await page.keyboard.press("Enter");
  await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(message(page)).toBeVisible();
  await expect(page.locator("textarea")).toHaveValue("Keep this draft");
  expect((await fixture(page)).events.rewinds).toBe(0);
});

test("touch keeps Edit from here visible without hover", async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:1549/tests/browser/edit-from-here.html");
  const edit = message(page).getByRole("button", { name: "Edit from here", exact: true });
  await expect(edit).toBeVisible();
  expect(
    await edit.evaluate(
      (button) => getComputedStyle(button.closest(".user-message-actions")!).opacity,
    ),
  ).toBe("1");
  await edit.tap();
  await expect(dialog(page)).toBeVisible();
  await context.close();
});

for (const width of [1280, 800])
  for (const theme of ["light", "dark"]) {
    test(`action and dialog screenshots ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/edit-from-here.html?conflicts&${theme === "light" ? "light" : ""}`,
      );
      await mkdir("temp/verification/v94w2", { recursive: true });
      const edit = message(page).getByRole("button", { name: "Edit from here", exact: true });
      await edit.focus();
      await expect(edit).toBeFocused();
      await page.screenshot({
        path: `temp/verification/v94w2/action-${width}-${theme}.png`,
        animations: "disabled",
      });
      await page.keyboard.press("Enter");
      await expect(dialog(page)).toContainText("Session files: 3");
      await page.screenshot({
        path: `temp/verification/v94w2/dialog-${width}-${theme}.png`,
        animations: "disabled",
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  }
