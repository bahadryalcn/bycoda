import { expect, test } from "@playwright/test";

for (const theme of ["dark", "light"])
  for (const width of [390, 1440]) {
    test(`policies reader ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?section=policies&theme=${theme}&lang=en`,
      );
      await page.getByText("Legal", { exact: true }).click();
      const policies = page.locator(".policies-settings");
      const documents = policies.getByRole("button", { name: /^Policy documents: /, exact: false });
      await expect(documents).toContainText("Privacy policy");
      await expect(policies.locator("article")).toContainText(
        "What bycoda collects, and what it does not",
      );
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await documents.click();
      await expect(page.getByRole("option")).toHaveCount(4);
      await page.getByRole("option", { name: "Software license (MIT)", exact: true }).click();
      await expect(documents).toContainText("Software license (MIT)");
      await expect(policies.locator("article")).toContainText("MIT License");
      await policies.locator("article").scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `temp/verification/2026-10-18-settings-layout/policies-${theme}-${width}.png`,
      });
    });
  }

test("policy search selects the document directly in the reader", async ({ page }) => {
  await page.goto("/tests/browser/settings/settings.html?section=general&theme=dark&lang=en");
  await page.getByRole("button", { name: "Search settings", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Search settings", exact: true })
    .fill("Third-party services and data controls");
  await page.getByRole("option").first().click();
  await expect(page.locator("#setting-third-party-data")).toBeFocused();
  await expect(page.locator(".policy-document")).toContainText("Third-party");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
