import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`build identity and existing Host notice: ${theme} ${width}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/tests/browser/build-identity.html?theme=${theme}`);
      const details = page.getByTestId("build-identity-details");
      await details.getByText("Build details", { exact: true }).click();
      await expect(details).toContainText("fixture-i2a");
      await expect(
        page.getByRole("status").filter({ hasText: "does not support managed workspace" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Copy build details", exact: true }).click();
      await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
      mkdirSync("temp/verification/i2a", { recursive: true });
      await page.screenshot({
        path: `temp/verification/i2a/build-identity-${theme}-${width}.png`,
        fullPage: true,
      });
      await page.goto(`/tests/browser/build-identity.html?unknown&theme=${theme}`);
      await page.getByText("Build details", { exact: true }).click();
      await expect(page.getByTestId("build-identity-details")).toContainText(
        "source identity unknown",
      );
    });
  }
