import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const screens = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../temp/verification/2026-10-29-ui-code-structure-review/screens",
);
mkdirSync(screens, { recursive: true });

const fields = ["Input field", "Textarea field", "TagInput field"] as const;

for (const theme of ["light", "dark"] as const) {
  for (const motion of ["no-preference", "reduce"] as const) {
    test(`help to error keeps one alert per field (${theme}, ${motion})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: motion });
      await page.goto(`/tests/browser/shared-ui/field-message.html?theme=${theme}`);
      const suffix = `${theme}-${motion === "reduce" ? "reduced" : "motion"}`;
      const main = page.getByRole("main", { name: "Field message fixture" });

      for (const name of fields) {
        const section = page.getByRole("region", { name, exact: true });
        await expect(section.getByRole("alert")).toHaveCount(0);
        await expect(section).toContainText("Kullanıcılara gösterilen");
      }
      await main.screenshot({ path: resolve(screens, `field-message-help-${suffix}.png`) });

      await page.getByRole("button", { name: "Show error" }).click();
      for (const name of fields) {
        const section = page.getByRole("region", { name, exact: true });
        await expect(section.getByRole("alert")).toHaveCount(1);
        await expect(section.getByRole("alert")).toContainText("Bu alan zorunludur");
        // The helper stays below the error, so both messages are present.
        await expect(section).toContainText("Kullanıcılara gösterilen");
      }
      await page.waitForTimeout(motion === "reduce" ? 50 : 700);
      for (const name of fields) {
        await expect(
          page.getByRole("region", { name, exact: true }).getByRole("alert"),
        ).toHaveCount(1);
      }
      expect(await main.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await main.screenshot({ path: resolve(screens, `field-message-error-${suffix}.png`) });

      await page.getByRole("button", { name: "Clear error" }).click();
      await page.waitForTimeout(motion === "reduce" ? 50 : 700);
      await expect(main.getByRole("alert")).toHaveCount(0);
    });
  }
}
