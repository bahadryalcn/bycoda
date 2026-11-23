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
      await page.goto(`/tests/browser/chat/chat-citations.html?theme=${theme}&recovery`, {
        waitUntil: "domcontentloaded",
      });
      const notice = page.locator("[data-interrupted-turn]");
      const button = notice.getByRole("button", { name: "Continue", exact: true });
      // The notice itself is the polite status; Continue follows the copy inline.
      await expect(notice).toHaveRole("status");
      await expect(button).toBeVisible();
      const b = (await button.boundingBox())!;
      const n = (await notice.boundingBox())!;
      const copy = (await notice.getByText("Interrupted", { exact: false }).first().boundingBox())!;
      expect(b.x).toBeGreaterThan(copy.x);
      expect(b.y).toBeGreaterThanOrEqual(n.y);
      expect(b.y + b.height).toBeLessThanOrEqual(n.y + n.height + 1);
      expect(b.x + b.width).toBeLessThanOrEqual(n.x + n.width + 1);
      {
        // Inside the chat pane the composer paints the shared glass fill, over the opaque composer surface fallback.
        const surface = await page.locator("[data-composer-box]").evaluate((element) => {
          const probe = document.createElement("div");
          probe.style.background = "var(--ui-chat-glass-fill, var(--ui-composer-surface))";
          element.parentElement!.append(probe);
          const expected = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return { background: getComputedStyle(element).backgroundColor, expected };
        });
        expect(surface.background).toBe(surface.expected);
        expect(surface.background).not.toBe("rgba(0, 0, 0, 0)");
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
      "bycoda.lastModel",
      JSON.stringify({
        harness: "claude",
        model: "claude:sonnet-5",
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
  await expect(page.getByRole("group", { name: "Quoted reply", exact: true })).toBeVisible();
}

for (const width of [1280, 800]) {
  for (const theme of ["dark", "light"]) {
    test(`selection, citation and applied translation: ${theme} ${width}`, async ({ page }) => {
      await mkdir(captures, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/chat/chat-citations.html?theme=${theme}`, {
        waitUntil: "domcontentloaded",
      });
      await page.addStyleTag({
        content:
          "main { background-image: radial-gradient(ellipse at 70% 16%, var(--ui-tone-info-subtle), transparent 65%); }",
      });
      const prompt = page.getByRole("textbox", { name: "Message", exact: true });
      await expect(prompt).toHaveValue("Keep my existing draft.");
      // Once references render inline, the role-textbox is the inline editor; the plain-text draft lives in the field.
      const draft = page.locator("[data-composer] textarea");

      await selectReply(page, "citation-user");
      await expect(page.getByRole("button", { name: "Reprompt", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      const source = await selectReply(page);
      const menu = page.getByRole("toolbar", { name: "Selected text actions" });
      const glass = page.locator(".popover-backdrop:has(+ [data-selection-menu])");
      await expect(glass).toHaveCSS("backdrop-filter", /blur\(/);
      await expect(menu).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await page.evaluate(() =>
        document.documentElement.setAttribute("data-performance-no-blur", ""),
      );
      await expect(glass).toHaveCSS("backdrop-filter", "none");
      await page.evaluate(() =>
        document.documentElement.removeAttribute("data-performance-no-blur"),
      );
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
      await expect(page.locator(".popover-backdrop:has(+ [data-citation-comment])")).toHaveCSS(
        "backdrop-filter",
        /blur\(/,
      );
      await comment
        .getByLabel("Comment", { exact: true })
        .fill("Bunu daha kompakt hale getirelim.");
      await page.screenshot({ path: `${captures}/${theme}-${width}-comment.png` });
      await comment.getByRole("button", { name: "Add to chat", exact: true }).click();
      // The quote lands as an inline token the sentence can refer to, like `[image1]`.
      await expect(draft).toHaveValue("Keep my existing draft. [quote1] ");
      const composer = page.getByTestId("composer-pane");
      // The `[quote1]` source stays in the plain-text field; the inline editor shows it as a `quote1` reference.
      await expect(
        composer.locator('[data-composer-inline-input] [data-inline-reference="quote"]'),
      ).toHaveText("quote1");
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
      await expect(draft).toHaveValue("Keep my existing draft. [quote1] ");
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
      await expect(composer.getByRole("group", { name: "Quoted reply" })).toHaveCount(0);
      await expect(draft).toHaveValue("Keep my existing draft. ");

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
      await page.getByRole("radio", { name: "Original text", exact: true }).click();
      await expect(source).toContainText(quote);
      await page.getByRole("button", { name: "Close translation", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Close translation", exact: true }),
      ).toHaveCount(0);
      await expect(source).toContainText(quote);
    });
  }
}

for (const width of [1280, 800]) {
  for (const theme of ["dark", "light"]) {
    test(`compact citation preview preserves full text: ${theme} ${width}`, async ({ page }) => {
      const directory = "temp/verification/citation-preview-2026-11-04";
      await mkdir(directory, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/chat/chat-citations.html?theme=${theme}`);
      await addCitation(page, "");
      const composer = page.getByTestId("composer-pane");
      const reference = composer.getByRole("button", { name: quote, exact: true });
      await expect(reference).toHaveText("quote1Seçilen metni kaynak mesajıyla birlikte alıntı…");
      await composer.getByRole("button", { name: "Copy quote", exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.fixtureCopiedText)).toBe(quote);
      await composer.screenshot({ path: `${directory}/${theme}-${width}-quote.png` });

      await composer.getByRole("button", { name: "Edit citation comment", exact: true }).click();
      const edit = page.getByRole("dialog", { name: "Edit citation comment", exact: true });
      await expect(edit.locator("blockquote")).toHaveText(quote);
      const longComment = "W".repeat(240);
      await edit.getByLabel("Comment (optional)", { exact: true }).fill(longComment);
      await edit.getByRole("button", { name: "Save comment", exact: true }).click();
      const longReference = composer.getByRole("button", { name: longComment, exact: true });
      await expect(longReference).toHaveText("quote1" + "W".repeat(79) + "…");
      const row = longReference.locator("..");
      expect(
        await row.evaluate((element) => element.scrollWidth - element.clientWidth),
      ).toBeLessThanOrEqual(1);
      const rowBox = (await row.boundingBox())!;
      const copyBox = (await composer
        .getByRole("button", { name: "Copy quote", exact: true })
        .boundingBox())!;
      expect(copyBox.x).toBeGreaterThanOrEqual(rowBox.x);
      expect(copyBox.x + copyBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
      await composer.screenshot({ path: `${directory}/${theme}-${width}-long-comment.png` });
      await composer.getByRole("button", { name: "Send", exact: true }).click();
      const sent = page.locator(".user-message-bubble").filter({
        has: page.locator('[data-selectable-agent-response="citation-sent"]'),
      });
      const sentReference = sent.getByRole("button", { name: longComment, exact: true });
      await expect(sentReference).toHaveText("quote1" + "W".repeat(79) + "…");
      await expect(
        sent.getByRole("button", { name: `quote1: ${longComment}`, exact: true }),
      ).toHaveText("[quote1]");
      await sent.getByRole("button", { name: "Quoted reply", exact: true }).click();
      await expect(page.locator("blockquote")).toHaveText(quote);
      await expect(page.getByText(longComment, { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await sent.screenshot({ path: `${directory}/${theme}-${width}-sent.png` });
    });
  }
}

test("citation submit retains exact quote and comment, changed source remains readable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/tests/browser/chat/chat-citations.html", { waitUntil: "domcontentloaded" });
  await addCitation(page, "Focus on this specific sentence.");
  await page.evaluate(() => window.__chatCitationFixture.changeSource());
  const composer = page.getByTestId("composer-pane");
  await page.evaluate(() => {
    window.fixtureClipboardFailure = true;
  });
  await composer.getByRole("button", { name: "Copy quote", exact: true }).click();
  const failedCopy = composer.getByRole("button", { name: "Copy failed. Try again.", exact: true });
  await expect(failedCopy).toHaveAttribute("data-copy-state", "failed");
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
  await failedCopy.click();
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
for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`handoff shared card ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/chat/chat-citations.html?theme=${theme}&handoff`);
      const card = page.locator("[data-handoff-card]");
      await expect(card.locator('[data-variant="card"]')).toBeVisible();
      await expect(card).toContainText("Continue reviewing the shared controls");
      await mkdir("temp/verification/component-inventory-skills", { recursive: true });
      await page.screenshot({
        path: `temp/verification/component-inventory-skills/handoff-${theme}-${width}.png`,
      });
      await card.getByRole("button", { name: "Remove handoff", exact: true }).click();
      await expect(card).toHaveCount(0);
      await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
        "Keep my existing draft.",
      );
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`citation token available and unavailable ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/chat/chat-citations.html?theme=${theme}&tokenSurface`);
      const button = page.getByRole("button", { name: "quote1: Fixture citation" });
      const token = button.locator("[data-surface-tone]");
      await expect(token).toHaveAttribute("data-surface-tone", "accent");
      await expect(token).toHaveAttribute("data-surface-ring", "tone-accent");
      await page.screenshot({
        animations: "disabled",
        path: `temp/verification/feature-controls/citation-available-${theme}-${width}.png`,
      });
      await button.click();
      await expect(token).toHaveAttribute("data-surface-tone", "neutral");
      await expect(token).toHaveAttribute("data-surface-ring", "tone-neutral");
      await page.screenshot({
        animations: "disabled",
        path: `temp/verification/feature-controls/citation-unavailable-${theme}-${width}.png`,
      });
    });
