import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) {
  for (const width of [1280, 800]) {
    test(`MCP enable and disable preserve connection identity: ${theme} ${width}`, async ({
      page,
    }, info) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/settings.html?section=mcp&mcp=1&theme=${theme}&lang=en`);
      const connections = page.locator("#setting-mcp-servers");
      // Enable/disable is the row switch; the actions menu keeps config and removal only.
      const toggle = connections.getByRole("switch", {
        name: "server-01 · Codex · Global",
        exact: true,
      });
      await expect(toggle).not.toBeChecked();
      await expect(toggle).toBeEnabled();
      await page.screenshot({ path: info.outputPath(`mcp-enable-${theme}-${width}.png`) });
      await toggle.click();
      await expect
        .poll(() =>
          page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-mcp-toggle") ?? "null")),
        )
        .toMatchObject({
          provider: "codex",
          name: "server-01",
          scope: "user",
          enabled: true,
          expectedEnabled: false,
        });
      await expect(toggle).toBeChecked();
      await expect(toggle).toBeEnabled();
      await toggle.click();
      await expect
        .poll(() =>
          page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-mcp-toggle") ?? "null")),
        )
        .toMatchObject({
          provider: "codex",
          name: "server-01",
          scope: "user",
          enabled: false,
          expectedEnabled: true,
        });
      await expect(toggle).not.toBeChecked();
      await page.screenshot({ path: info.outputPath(`mcp-disabled-${theme}-${width}.png`) });
    });
  }
}

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
      await expect(page.locator(".provider-cli-detail .provider-detail-header")).toContainText(
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
    // Close to tray is a Windows capability; exercise it deterministically
    // even when the browser fixture runs on a Linux CI worker.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "platform", { get: () => "Win32" });
    });
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
