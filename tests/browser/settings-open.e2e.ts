import { test, expect } from "@playwright/test";

for (const theme of ["light", "dark"]) {
  for (const width of [390, 768, 1024, 1440]) {
    test(`open appearance previews ${theme} ${width}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/settings.html?section=appearance&theme=${theme}&lang=tr`);
      const appearance = page.locator(".appearance-settings");
      await expect(appearance.locator("details, summary")).toHaveCount(0);
      await expect(appearance.locator(".appearance-section")).toHaveCount(6);
      for (const id of ["dark-lightness", "code-font-size", "sidebar-opacity", "tab-animations"]) {
        await expect(appearance.locator(`[data-setting-id="${id}"]`)).toBeVisible();
      }
      await expect(appearance.locator(".appearance-scheme-option")).toHaveCount(3);
      await expect(appearance.locator(".appearance-palette")).toHaveCount(6);
      const tide = appearance.locator(".appearance-palette").filter({ hasText: "Tide" });
      await tide.focus();
      await page.keyboard.press("Enter");
      await expect(tide).toHaveAttribute("aria-pressed", "true");
      await page.reload();
      await expect(tide).toHaveAttribute("aria-pressed", "true");
      expect(await appearance.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(
        true,
      );
      const overflow = await appearance
        .locator(".settings-row, .settings-group-heading, .appearance-scheme-options")
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => node.scrollWidth > node.clientWidth + 1)
            .map((node) => node.className),
        );
      expect(overflow).toEqual([]);
      await page.locator("[data-settings-scroller]").evaluate((node) => {
        node.scrollTop = 0;
      });
      await page.screenshot({ path: testInfo.outputPath(`appearance-${theme}-${width}.png`) });
      await appearance.locator(".appearance-type-sample").scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`typography-${theme}-${width}.png`) });
    });
  }
}

test("settings expose advanced controls without opening a menu", async ({ page }) => {
  for (const section of [
    "general",
    "chat",
    "workspace",
    "terminal",
    "providers",
    "mcp",
    "groupLock",
    "connections",
    "policies",
    "archive",
  ]) {
    await page.goto(`/tests/browser/settings.html?section=${section}&theme=dark&lang=en`);
    const form = page.locator(".bycoda-settings-form");
    await expect(form.locator("details, summary")).toHaveCount(0);
    expect(await form.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  }
});
