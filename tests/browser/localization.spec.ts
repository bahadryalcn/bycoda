import { expect, test } from "@playwright/test";
test.setTimeout(180_000);

test("switches all eight languages and preserves an unsent draft", async ({ page }) => {
  await page.goto("/tests/browser/localization.html");
  const draft = page.getByTestId("draft");
  await draft.fill("Türkçe taslak: ğüşiöç — 日本語 {p0}");
  const languages = [
    ["tr", "Türkçe", "Ayarlar"],
    ["de", "Deutsch", "Einstellungen"],
    ["fr", "Français", "Paramètres"],
    ["es", "Español", "Configuración"],
    ["pt", "Português", "Configurações"],
    ["zh-CN", "简体中文", "设置"],
    ["ja", "日本語", "設定"],
    ["en", "English", "Settings"],
  ];
  for (const [locale, nativeName, heading] of languages) {
    await page.locator('[data-setting-id="interface-language"] button').first().click();
    await page.getByRole("option", { name: nativeName, exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", locale, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    await expect(draft).toHaveValue("Türkçe taslak: ğüşiöç — 日本語 {p0}");
    await expect(page.getByTestId("git-control")).toHaveText("Cancel");
    await expect(page.getByTestId("technical-control")).toHaveText("Cancel");
  }
});

test("chooses Git and technical languages independently and persists them", async ({ page }) => {
  await page.goto("/tests/browser/localization.html");
  const select = async (id: string, name: string) => {
    await page.locator(`[data-setting-id="${id}"] button`).first().click();
    await page.getByRole("option", { name, exact: true }).click();
  };
  await select("interface-language", "Türkçe");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ayarlar");
  await select("git-language", "Uygulama dilini takip et");
  await expect(page.getByTestId("git-control")).toHaveText("İptal");
  await select("technical-language", "English");
  await expect(page.getByTestId("technical-control")).toHaveText("Cancel");
  await page.reload();
  await expect(page.getByTestId("git-control")).toHaveText("İptal");
  await expect(page.getByTestId("technical-control")).toHaveText("Cancel");
  await select("git-language", "English");
  await expect(page.getByTestId("git-control")).toHaveText("Cancel");
  await expect(page.locator("html")).toHaveAttribute("lang", "tr");
});

test("persists Turkish and fits a narrow Japanese settings page", async ({ page }, testInfo) => {
  await page.goto("/tests/browser/localization.html");
  await page.locator('[data-setting-id="interface-language"] button').first().click();
  await page.getByRole("option", { name: "Türkçe", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "tr", { timeout: 30_000 });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ayarlar");
  await page.getByRole("combobox", { name: "Ayarları ara", exact: true }).fill("dil");
  await expect(page.getByRole("listbox")).toContainText("Uygulama dili");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: testInfo.outputPath("localization-turkish.png") });
  await page.setViewportSize({ width: 460, height: 800 });
  await page.locator('[data-setting-id="interface-language"] button').first().click();
  await page.getByRole("option", { name: "日本語", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ja", { timeout: 30_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("localization-japanese-narrow.png") });
});
