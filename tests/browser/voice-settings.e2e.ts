import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const captures = join(process.cwd(), "temp/verification/2026-10-24-voice-setup");

async function openVoice(page: Page, fixture: string, theme = "dark", width = 1280, lang = "en") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem(
      "bycoda.voice",
      JSON.stringify({ enabled: true, natural: true, python: "", whisperPath: "", ttsPath: "" }),
    );
  });
  await page.goto(
    `/tests/browser/settings.html?section=chat&voice=${fixture}&theme=${theme}&lang=${lang}`,
  );
  return page
    .locator(".settings-group")
    .filter({ has: page.locator('[data-setting-id="voice-companion"]') });
}

for (const theme of ["light", "dark"]) {
  for (const width of [390, 1280]) {
    test(`voice setup has two clear actions without technical instructions: ${theme} ${width}`, async ({
      page,
    }) => {
      const group = await openVoice(page, "missing", theme, width);
      await expect(group.getByText("Voice setup is needed", { exact: true })).toBeVisible();
      await expect(group.getByRole("button", { name: "Install", exact: true })).toBeVisible();
      await expect(
        group.getByRole("button", { name: "Locate existing", exact: true }),
      ).toBeVisible();
      await expect(group).not.toContainText("faster-whisper");
      await expect(group).not.toContainText("pip install");
      await expect(group).not.toContainText("Missing:");
      await expect(group.getByRole("textbox")).toHaveCount(0);
      await group.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const bounds = await group.boundingBox();
      expect(bounds!.height).toBeLessThan(420);
      await mkdir(captures, { recursive: true });
      await group.screenshot({ path: join(captures, `voice-missing-${theme}-${width}.png`) });
    });
  }
}

test("voice install finishes in place using a simulated job", async ({ page }) => {
  const group = await openVoice(page, "missing");
  await group.getByRole("button", { name: "Install", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("fixture-voice-install-request")))
    .not.toBeNull();
  await expect(group.getByText("Voice is ready", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(group.getByRole("button", { name: "Install", exact: true })).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("bycoda.voice")!).python))
    .toBe("/fixture/voice/bin/python");
  await mkdir(captures, { recursive: true });
  await group.screenshot({ path: join(captures, "voice-ready-dark-1280.png") });
});

test("voice locations are optional, keyboard accessible and return focus", async ({ page }) => {
  const group = await openVoice(page, "missing", "dark", 390);
  const locate = group.getByRole("button", { name: "Locate existing", exact: true });
  await locate.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Locate voice files", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Python", exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("textbox", { name: "Speech recognition model", exact: true }),
  ).toBeVisible();
  const model = dialog.getByRole("textbox", { name: "Natural voice model", exact: true });
  await expect(model).toBeVisible();
  await model.fill("/fixture/existing/model");
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("bycoda.voice")!).ttsPath))
    .toBe("/fixture/existing/model");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir(captures, { recursive: true });
  await dialog.screenshot({ path: join(captures, "voice-locate-dark-390.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(locate).toBeFocused();
});

test("connection failure offers a retry instead of installation instructions", async ({ page }) => {
  const group = await openVoice(page, "error");
  await expect(group.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  await expect(group.getByRole("button", { name: "Install", exact: true })).toHaveCount(0);
  await expect(group).not.toContainText("pip install");
  await mkdir(captures, { recursive: true });
  await group.screenshot({ path: join(captures, "voice-connection-error-dark-1280.png") });
});

test("an ongoing installation resumes with progress and prevents duplicate actions", async ({
  page,
}) => {
  const group = await openVoice(page, "installing", "light", 390);
  await expect(
    group.getByText("You can leave this page. Setup will continue.", { exact: true }),
  ).toBeVisible();
  await expect(group.getByRole("button", { name: "Install", exact: true })).toHaveCount(0);
  await expect(group.getByRole("button", { name: "Locate existing", exact: true })).toHaveCount(0);
  await expect(
    group.getByRole("switch", { name: "Enable voice companion", exact: true }),
  ).toBeDisabled();
  await mkdir(captures, { recursive: true });
  await group.screenshot({ path: join(captures, "voice-installing-light-390.png") });
});

test("Turkish voice setup keeps the same simple actions at a narrow width", async ({ page }) => {
  const group = await openVoice(page, "missing", "dark", 390, "tr");
  await expect(
    group.getByText("Sesli konuşma için kurulum gerekli", { exact: true }),
  ).toBeVisible();
  await expect(group.getByRole("button", { name: "Kur", exact: true })).toBeVisible();
  await expect(group.getByRole("button", { name: "Yerini göster", exact: true })).toBeVisible();
  await expect(group).not.toContainText("faster-whisper");
  await expect(group).not.toContainText("pip install");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir(captures, { recursive: true });
  await group.screenshot({ path: join(captures, "voice-missing-dark-390-tr.png") });
});
