import { expect, test } from "@playwright/test";

for (const theme of ["dark", "light"])
  for (const width of [390, 1440]) {
    test(`policies reader ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/settings.html?section=policies&theme=${theme}&lang=en`);
      const policies = page.locator(".policies-settings");
      const documents = policies.getByRole("tablist", { name: "Policy documents" });
      await expect(documents.getByRole("tab")).toHaveCount(4);
      await expect(
        documents.getByRole("tab", { name: "Privacy policy", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(policies.locator("article")).toContainText(
        "No developer collection or tracking",
      );
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const reader = policies.locator(".policy-reader");
      expect(await reader.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
      await reader.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      await expect(documents.getByRole("tab").first()).toBeInViewport();
      await documents.getByRole("tab").first().focus();
      await page.keyboard.press("End");
      await expect(
        documents.getByRole("tab", { name: "Software license (MIT)", exact: true }),
      ).toBeFocused();
      await expect(reader.locator("article")).toContainText("MIT License");
      await page.keyboard.press("Home");
      expect(await reader.evaluate((node) => node.scrollTop)).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const bounds = await reader.boundingBox();
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(901);
      await page.screenshot({
        path: `temp/verification/2026-10-18-settings-layout/policies-${theme}-${width}.png`,
      });
    });
  }

test("policy search selects the document directly in the reader", async ({ page }) => {
  await page.goto("/tests/browser/settings.html?section=general&theme=dark&lang=en");
  await page.getByRole("button", { name: "Search settings", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Search settings", exact: true })
    .fill("Third-party services and data controls");
  await page.getByRole("option").first().click();
  await expect(page.locator("#setting-third-party-data")).toBeFocused();
  await expect(page.locator(".policy-document")).toContainText("Third-party");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
