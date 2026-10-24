import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) {
  for (const lang of ["en", "tr"]) {
    test(`narrow provider search preserves selection across resize: ${theme} ${lang}`, async ({
      page,
    }, info) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: 390, height: 800 });
      await page.goto(`/tests/browser/settings.html?section=providers&theme=${theme}&lang=${lang}`);
      const picker = page.locator(".provider-cli-select").getByRole("button");
      await expect(picker).toBeVisible();
      await expect(page.locator(".provider-cli-selector")).toBeHidden();
      await picker.click();
      const search = page.getByRole("combobox", {
        name: lang === "tr" ? "Sağlayıcı ara…" : "Search providers…",
        exact: true,
      });
      await expect(search).toBeFocused();
      await search.fill("Codex");
      const option = page.getByRole("option", { name: /^Codex/ });
      await expect(option).toBeVisible();
      await option.click();
      await expect(picker).toContainText("Codex");
      await expect(picker).toBeFocused();
      await expect(page.locator(".provider-cli-detail > .provider-cli-header")).toContainText(
        "Codex",
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: info.outputPath("provider-narrow.png") });
      await page.setViewportSize({ width: 1280, height: 800 });
      await expect(picker).toBeHidden();
      const selected = page
        .locator(".provider-cli-selector")
        .getByRole("button", { name: /^Codex,/ });
      await expect(selected).toHaveAttribute("aria-current", "true");
      await page.setViewportSize({ width: 390, height: 800 });
      await expect(picker).toContainText("Codex");
      await picker.click();
      await page.keyboard.press("Escape");
      await expect(picker).toBeFocused();
    });
  }

  test(`general settings keep short cards fitted to their content: ${theme}`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/tests/browser/settings.html?section=general&theme=${theme}&lang=en`);
    const row = page.locator('[data-setting-id="close-to-tray"]');
    await expect(row).toBeVisible();
    const card = page
      .locator(".general-settings > .settings-group > .settings-group-content")
      .filter({ has: row });
    const rowBounds = (await row.boundingBox())!;
    const cardBounds = (await card.boundingBox())!;
    expect(cardBounds.height - rowBounds.height).toBeLessThan(4);
    await expect(row.getByRole("switch")).toBeVisible();
    await page.screenshot({ path: info.outputPath("general-compact-card.png") });
  });
}
