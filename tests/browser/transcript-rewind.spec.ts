import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

for (const width of [390, 1000]) {
  test(`rewind actions identify their message at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/tests/browser/transcript.html?rewind", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Stopped by you", { exact: true })).toBeVisible();
    const wrong = page.locator('[data-prompt-anchor="wrong-request"]');
    const prior = page.locator('[data-prompt-anchor="prior-request"]');
    const actions = wrong.getByRole("button", { name: "Message actions", exact: true });
    await actions.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "Edit this message", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { lastRewind: unknown }).lastRewind))
      .toEqual({ blockId: "wrong-request", action: "edit" });
    await prior.getByRole("button", { name: "Message actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Return before this message", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { lastRewind: unknown }).lastRewind))
      .toEqual({ blockId: "prior-request", action: "return" });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}

for (const width of [1280, 800])
  for (const theme of ["light", "dark"]) {
    test(`managed rewind previews files and supports undo at ${width}px ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/tests/browser/workspace-rewind.html");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const trigger = page.getByRole("button", {
        name: "Return before the later change",
        exact: true,
      });
      await trigger.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", {
        name: "Rewind conversation and files",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("Turns: 1 · Commits: 2 · Files: 3");
      await expect(dialog).toContainText("Main is not rewound");
      await dialog.locator("summary").click();
      await expect(dialog).toContainText("src/features/workspaces/model/rewindClient.ts");
      await mkdir("temp/verification/s5", { recursive: true });
      await page.screenshot({
        path: `temp/verification/s5/rewind-preview-${width}-${theme}.png`,
        animations: "disabled",
      });
      const apply = dialog.getByRole("button", {
        name: "Rewind conversation and files",
        exact: true,
      });
      await apply.focus();
      await page.keyboard.press("Enter");
      await expect(dialog).not.toBeVisible();
      await expect(page.locator('[data-block="second"]')).toHaveCount(0);
      const undo = page.getByRole("button", { name: "Undo rewind", exact: true });
      await expect(undo).toBeVisible();
      await page.screenshot({
        path: `temp/verification/s5/rewind-result-${width}-${theme}.png`,
        animations: "disabled",
      });
      await undo.click();
      const undoDialog = page.getByRole("dialog", { name: "Undo rewind", exact: true });
      await expect(undoDialog).toBeVisible();
      await page.screenshot({
        path: `temp/verification/s5/rewind-undo-${width}-${theme}.png`,
        animations: "disabled",
      });
      await undoDialog.getByRole("button", { name: "Undo rewind", exact: true }).click();
      await expect(page.locator('[data-block="second"]')).toBeVisible();
      const methods = await page.evaluate(() =>
        (
          window as unknown as { rewindFixtureCalls: Array<{ method: string }> }
        ).rewindFixtureCalls.map((call) => call.method),
      );
      expect(methods.filter((method) => method === "sessions.rewind.apply")).toHaveLength(1);
      expect(methods.filter((method) => method === "sessions.rewind.undo")).toHaveLength(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  }

test("managed rewind on an older host explains the update without changing history", async ({
  page,
}) => {
  await page.goto("/tests/browser/workspace-rewind.html?olderHost");
  await page.getByRole("button", { name: "Return before the later change", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Update bycoda Host");
  await expect(page.locator('[data-block="second"]')).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("blocked capture keeps rewind unavailable and cancellation preserves history", async ({
  page,
}) => {
  await page.goto("/tests/browser/workspace-rewind.html?blocked");
  await page.getByRole("button", { name: "Return before the later change", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("uncaptured source file");
  await expect(
    dialog.getByRole("button", { name: "Rewind conversation and files", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator('[data-block="second"]')).toBeVisible();
});
