import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const directory = "temp/verification/inline-visuals";
const title = "From selection to reference";
const frame = (page: Page) => page.frameLocator('iframe[title="HTML live preview"]');

for (const theme of ["dark", "light"])
  for (const width of [1280, 800]) {
    test(`inline visual states and recovery: ${theme} ${width}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await mkdir(directory, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/inline-visuals.html?theme=${theme}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(
        frame(page).getByRole("heading", { name: "Keep context attached." }),
      ).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
        "Keep my existing draft.",
      );
      const card = page.locator(`section[aria-label="${title}"]`);
      const toolbarButtons = card.getByRole("button");
      await expect(toolbarButtons).toHaveCount(4);
      const positions = await toolbarButtons.evaluateAll((buttons) =>
        buttons.map((button) => button.getBoundingClientRect().top),
      );
      expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(2);
      await page.screenshot({ path: `${directory}/${theme}-${width}-inline.png` });

      await frame(page).getByRole("button", { name: "Add a reference" }).click();
      await expect(frame(page).locator("#count")).toHaveText("1 reference");
      const before = await page.evaluate(
        () =>
          (window as unknown as { inlineVisualFixture: { calls: string[] } }).inlineVisualFixture
            .calls.length,
      );
      await page.getByRole("button", { name: "Source", exact: true }).click();
      await expect(card.locator("pre")).toContainText("Keep context attached.");
      await expect(card.locator("iframe")).toBeHidden();
      await page.screenshot({ path: `${directory}/${theme}-${width}-source.png` });
      await page.getByRole("button", { name: "Source", exact: true }).click();
      await expect(frame(page).locator("#count")).toHaveText("1 reference");
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { inlineVisualFixture: { calls: string[] } }).inlineVisualFixture
              .calls.length,
        ),
      ).toBe(before);

      await page.getByRole("button", { name: "Open in panel", exact: true }).click();
      const panel = page.getByRole("dialog", { name: title, exact: true });
      await expect(panel).toBeVisible();
      await expect(panel.locator("iframe")).toBeVisible();
      await expect(
        frame(page).getByRole("heading", { name: "Keep context attached." }),
      ).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeEditable();
      const resize = panel.getByRole("separator", { name: "Resize panel" });
      const defaultWidth = Math.min(640, Math.max(320, width / 2));
      await resize.focus();
      await resize.press("ArrowLeft");
      await expect(resize).toHaveAttribute("aria-valuenow", String(defaultWidth + 16));
      await resize.press("Enter");
      await expect(resize).toHaveAttribute("aria-valuenow", String(defaultWidth));
      await page.screenshot({ path: `${directory}/${theme}-${width}-panel.png` });
      await panel.getByRole("button", { name: "Expand", exact: true }).click();
      const expanded = page.getByRole("dialog", { name: title, exact: true });
      await expect(expanded).toBeVisible();
      await expect(
        frame(page).getByRole("heading", { name: "Keep context attached." }),
      ).toBeVisible();
      await page.screenshot({ path: `${directory}/${theme}-${width}-expanded.png` });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Expand", exact: true })).toBeFocused();
      await page.getByRole("button", { name: "Open in panel", exact: true }).click();
      await page
        .getByRole("dialog", { name: title, exact: true })
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await expect(page.getByRole("button", { name: "Open in panel", exact: true })).toBeFocused();
      await page.getByRole("button", { name: "Open in panel", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Open in panel", exact: true })).toBeFocused();

      await page.evaluate(() => {
        (window as unknown as { inlineVisualFixture: { fail: boolean } }).inlineVisualFixture.fail =
          true;
      });
      await page.getByRole("button", { name: "Reload preview", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("Preview unavailable");
      await page.screenshot({ path: `${directory}/${theme}-${width}-error.png` });
      await page.evaluate(() => {
        (window as unknown as { inlineVisualFixture: { fail: boolean } }).inlineVisualFixture.fail =
          false;
      });
      await page.getByRole("button", { name: "Reload preview", exact: true }).click();
      await expect(
        frame(page).getByRole("heading", { name: "Keep context attached." }),
      ).toBeVisible();
      await expect(frame(page).locator("#count")).toHaveText("0 references");
      await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
        "Keep my existing draft.",
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      expect(errors).toEqual([]);
    });
  }
