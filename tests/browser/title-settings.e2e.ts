import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) {
  for (const width of [1280, 800]) {
    test(`title model automatic/custom persistence: ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/title-settings.html?theme=${theme}`);
      const row = page.locator('[data-setting-id="title-model-default"]');
      await row.scrollIntoViewIfNeeded();
      await expect(row).toContainText("Haiku, Terra or Flash");
      await page.locator("main").evaluate((element) => {
        element.scrollTop = 0;
      });
      mkdirSync("temp/verification/title-regeneration", { recursive: true });
      await page.screenshot({
        path: `temp/verification/title-regeneration/settings-${theme}-${width}-automatic.png`,
      });
      await row.getByRole("radio", { name: "Choose model", exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(
            () => JSON.parse(localStorage.getItem("bycoda.title.default.v1") ?? "null")?.model,
          ),
        )
        .toBeTruthy();
      await expect(row.locator('button[aria-haspopup="menu"]')).toBeVisible();
      await expect(row).not.toContainText("Selected model does not support text actions");
      await page.locator("main").evaluate((element) => {
        element.scrollTop = 0;
      });
      await page.screenshot({
        path: `temp/verification/title-regeneration/settings-${theme}-${width}-custom.png`,
      });
      await row.locator('button[aria-haspopup="menu"]').click();
      await expect(
        page.getByRole("menu", { name: "Model and settings", exact: true }),
      ).toBeVisible();
      await page.getByRole("menuitem", { name: /^Model\s/ }).click();
      await expect(page.getByRole("dialog", { name: "Models", exact: true })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/title-regeneration/settings-${theme}-${width}-picker.png`,
      });
      await page.getByRole("option", { name: /^Haiku 4\.5(?:\s|,)/ }).click();
      await expect
        .poll(() =>
          page.evaluate(
            () => JSON.parse(localStorage.getItem("bycoda.title.default.v1") ?? "null")?.model,
          ),
        )
        .toBe("claude:haiku-4.5");
      await page.reload();
      await row.scrollIntoViewIfNeeded();
      await expect(row.locator('button[aria-haspopup="menu"]')).toBeVisible();
      await row.getByRole("radio", { name: "Automatic", exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("bycoda.title.default.v1")))
        .toBe("null");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    });
  }
}
