import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const captures = "temp/verification/chat-citations";

test("interrupted recovery keeps Continue on the right above a distinct composer surface", async ({
  page,
}) => {
  const directory = "temp/verification/chat-recovery-followup";
  await mkdir(directory, { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const theme of ["dark", "light"])
    for (const width of [1280, 800]) {
      await page.setViewportSize({ width, height: 700 });
      await page.goto(`/tests/browser/chat-citations.html?theme=${theme}&recovery`, {
        waitUntil: "domcontentloaded",
      });
      const notice = page.locator("[data-interrupted-turn]");
      const button = notice.getByRole("button", { name: "Continue", exact: true });
      const text = notice.getByRole("status");
      await expect(button).toBeVisible();
      const b = (await button.boundingBox())!;
      const c = (await text.boundingBox())!;
      const n = (await notice.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(c.x + c.width);
      expect(Math.abs(b.y + b.height / 2 - c.y - c.height / 2)).toBeLessThan(3);
      expect(n.x + n.width - b.x - b.width).toBeLessThanOrEqual(18);
      if (theme === "dark") {
        const color = await page.locator("[data-composer-box]").evaluate((element) => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const context = canvas.getContext("2d")!;
          context.fillStyle = getComputedStyle(element).backgroundColor;
          context.fillRect(0, 0, 1, 1);
          return Array.from(context.getImageData(0, 0, 1, 1).data);
        });
        expect(color[0]).toBeGreaterThanOrEqual(20);
        expect(color[0]).toBeLessThanOrEqual(26);
        expect(Math.abs(color[0] - color[1])).toBeLessThanOrEqual(2);
      }
      await page
        .getByTestId("composer-pane")
        .screenshot({ path: `${directory}/${theme}-${width}.png` });
      await button.click();
      await expect(notice).toBeHidden();
      await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
        "Keep my existing draft.",
      );
    }
});
const quote =
  "Seçilen metni kaynak mesajıyla birlikte alıntı olarak ekleyelim. Yorumun da bu alıntıya bağlı kalsın.";

test.beforeEach(async ({ page }) => {
  // Settings defaults are independent of the conversation's provider.
  await page.addInitScript(() =>
    localStorage.setItem(
      "bycoda.translation.default.v1",
      JSON.stringify({
        harness: "claude",
        model: "claude:sonnet-5",
        providerAccountId: "default",
      }),
    ),
  );
});

async function selectReply(page: Page, blockId = "citation-assistant") {
  const source = page.locator(`[data-selectable-agent-response="${blockId}"]`).first();
  await expect(source).toBeVisible();
  await source.evaluate((element) => {
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(page.getByRole("toolbar", { name: "Selected text actions" })).toBeVisible();
  return source;
}

async function addCitation(page: Page, comment = "Bunu daha kompakt hale getirelim.") {
  await selectReply(page);
  await page.getByRole("button", { name: "Add citation", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add citation", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Comment", { exact: true }).fill(comment);
  await dialog.getByRole("button", { name: "Add to chat", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Quoted reply", { exact: true })).toBeVisible();
}

for (const width of [1280, 800]) {
  for (const theme of ["dark", "light"]) {
    test(`selection, citation and applied translation: ${theme} ${width}`, async ({ page }) => {
      await mkdir(captures, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/chat-citations.html?theme=${theme}`, {
        waitUntil: "domcontentloaded",
      });
      const prompt = page.getByRole("textbox", { name: "Message", exact: true });
      await expect(prompt).toHaveValue("Keep my existing draft.");

      await selectReply(page, "citation-user");
      await expect(page.getByRole("button", { name: "Reprompt", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      const source = await selectReply(page);
      const menu = page.getByRole("toolbar", { name: "Selected text actions" });
      await expect(menu.getByRole("button", { name: "Reprompt", exact: true })).toHaveCount(0);
      await expect(menu.getByRole("button", { name: "Copy", exact: true })).toBeVisible();
      const sourceBox = await source.boundingBox();
      const menuBox = await menu.boundingBox();
      expect(sourceBox).not.toBeNull();
      expect(menuBox).not.toBeNull();
      expect(menuBox!.x).toBeGreaterThanOrEqual(0);
      expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(width);
      expect(
        Math.min(
          Math.abs(menuBox!.y + menuBox!.height - sourceBox!.y),
          Math.abs(menuBox!.y - sourceBox!.y - sourceBox!.height),
        ),
      ).toBeLessThan(100);
      await page.screenshot({ path: `${captures}/${theme}-${width}-selection.png` });

      await menu.getByRole("button", { name: "Add citation", exact: true }).click();
      const comment = page.getByRole("dialog", { name: "Add citation", exact: true });
      await expect(comment).toBeVisible();
      await comment
        .getByLabel("Comment", { exact: true })
        .fill("Bunu daha kompakt hale getirelim.");
      await page.screenshot({ path: `${captures}/${theme}-${width}-comment.png` });
      await comment.getByRole("button", { name: "Add to chat", exact: true }).click();
      await expect(prompt).toHaveValue("Keep my existing draft.");
      const composer = page.getByTestId("composer-pane");
      const chip = composer.getByRole("button", {
        name: "Bunu daha kompakt hale getirelim.",
        exact: true,
      });
      await expect(chip).toBeVisible();
      await chip.hover();
      await expect
        .poll(() => page.evaluate(() => CSS.highlights?.has("bycoda-chat-citation")))
        .toBe(true);
      await chip.click();
      await expect(
        composer.getByText("Source changed or unavailable. The saved quote is preserved.", {
          exact: true,
        }),
      ).toHaveCount(0);
      await composer.getByRole("button", { name: "Copy quote", exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.fixtureCopiedText)).toBe(quote);
      await page.screenshot({ path: `${captures}/${theme}-${width}-composer.png` });
      await expect
        .poll(() => page.evaluate(() => window.__chatCitationFixture.draft()))
        .toContain("bycoda-citation:");
      await page.evaluate(() => window.__chatCitationFixture.remount());
      await expect(chip).toBeVisible();
      await expect(prompt).toHaveValue("Keep my existing draft.");
      await composer.getByRole("button", { name: "Edit citation comment", exact: true }).click();
      const edit = page.getByRole("dialog", { name: "Edit citation comment", exact: true });
      await edit
        .getByLabel("Comment (optional)", { exact: true })
        .fill("Keep this unfinished comment.");
      await prompt.click();
      await expect(edit).toBeHidden();
      await composer.getByRole("button", { name: "Edit citation comment", exact: true }).click();
      await expect(edit.getByLabel("Comment (optional)", { exact: true })).toHaveValue(
        "Keep this unfinished comment.",
      );
      await edit
        .getByLabel("Comment (optional)", { exact: true })
        .fill("Keep the source reference.");
      await edit.getByRole("button", { name: "Save comment", exact: true }).click();
      await expect(
        composer.getByRole("button", { name: "Keep the source reference.", exact: true }),
      ).toBeVisible();
      await composer.getByRole("button", { name: "Remove citation", exact: true }).click();
      await expect(composer.getByText("Quoted reply", { exact: true })).toHaveCount(0);
      await expect(prompt).toHaveValue("Keep my existing draft.");

      await selectReply(page);
      await page.getByRole("button", { name: "Translate to English", exact: true }).click();
      const translation = page.getByRole("dialog", { name: "Translate to English", exact: true });
      await expect(
        translation.getByRole("button", { name: "Apply translation", exact: true }),
      ).toBeEnabled();
      await page.screenshot({ path: `${captures}/${theme}-${width}-translation-dialog.png` });
      await translation.getByRole("button", { name: "Apply translation", exact: true }).click();
      await expect(translation).toBeHidden();
      await expect(
        page.getByRole("button", { name: "Close translation", exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: `${captures}/${theme}-${width}-translation.png` });
      await page.getByRole("button", { name: "Original text", exact: true }).click();
      await expect(source).toContainText(quote);
      await page.getByRole("button", { name: "Close translation", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Close translation", exact: true }),
      ).toHaveCount(0);
      await expect(source).toContainText(quote);
    });
  }
}

test("citation submit retains exact quote and comment, changed source remains readable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/tests/browser/chat-citations.html", { waitUntil: "domcontentloaded" });
  await addCitation(page, "Focus on this specific sentence.");
  await page.evaluate(() => window.__chatCitationFixture.changeSource());
  const composer = page.getByTestId("composer-pane");
  await page.evaluate(() => {
    window.fixtureClipboardFailure = true;
  });
  await composer.getByRole("button", { name: "Copy quote", exact: true }).click();
  await expect(
    composer.getByText("Could not copy quote. Please try again.", { exact: true }),
  ).toBeVisible();
  await expect(
    composer.getByRole("button", { name: "Focus on this specific sentence.", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.fixtureClipboardFailure = false;
  });
  await composer
    .getByRole("button", { name: "Focus on this specific sentence.", exact: true })
    .click();
  await expect(
    composer.getByText("Source changed or unavailable. The saved quote is preserved.", {
      exact: true,
    }),
  ).toBeVisible();
  await composer.getByRole("button", { name: "Copy quote", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.fixtureCopiedText)).toBe(quote);
  await composer.getByRole("button", { name: "Send", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__chatCitationFixture.submitted()))
    .toContain("bycoda-citation:");
  await expect(page.locator('[data-selectable-agent-response="citation-sent"]')).toContainText(
    "Keep my existing draft.",
  );
  await expect(page.locator('[data-selectable-agent-response="citation-sent"]')).not.toContainText(
    "bycoda-citation:",
  );
});
