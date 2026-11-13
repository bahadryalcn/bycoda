import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page, type Locator } from "@playwright/test";

const captures = join(process.cwd(), "temp/verification/2026-10-24-voice-setup");

async function assertVoiceRows(region: Locator) {
  const problems = await region.evaluate((root) => {
    const issues: string[] = [];
    const bounds = root.getBoundingClientRect();
    for (const row of root.querySelectorAll<HTMLElement>(".settings-row")) {
      const box = row.getBoundingClientRect();
      if (!box.width || !box.height || !row.checkVisibility()) continue;
      const name = row.dataset.settingId ?? row.textContent?.trim().slice(0, 40);
      if (box.left < bounds.left - 1 || box.right > bounds.right + 1)
        issues.push(`${name}: row outside content`);
      const label = row.querySelector(":scope > .settings-row-label")?.getBoundingClientRect();
      const control = row.querySelector(":scope > .settings-row-control")?.getBoundingClientRect();
      if (
        label &&
        control &&
        Math.min(label.right, control.right) > Math.max(label.left, control.left) + 1 &&
        Math.min(label.bottom, control.bottom) > Math.max(label.top, control.top) + 1
      )
        issues.push(`${name}: overlapping label and control`);
      for (const field of row.querySelectorAll<HTMLElement>(
        "button,input,textarea,[role='radiogroup']",
      )) {
        const rect = field.getBoundingClientRect();
        if (
          !rect.width ||
          !rect.height ||
          getComputedStyle(field).opacity === "0" ||
          !field.checkVisibility()
        )
          continue;
        if (
          rect.left < box.left - 1 ||
          rect.right > box.right + 1 ||
          rect.top < box.top - 1 ||
          rect.bottom > box.bottom + 1
        )
          issues.push(`${name}: ${field.getAttribute("aria-label") ?? field.tagName} outside row`);
      }
    }
    return issues;
  });
  expect(problems).toEqual([]);
}

for (const [theme, width] of [
  ["light", 1280],
  ["dark", 1280],
  ["light", 800],
  ["dark", 800],
  ["dark", 560],
] as const) {
  test(`voice settings compact geometry and shared assistant route ${theme} ${width}`, async ({
    page,
  }) => {
    const region = await openVoice(page, "ready", theme, width);
    const output = join(process.cwd(), "temp/verification/voice-settings-layout-20261113/after");
    await mkdir(output, { recursive: true });
    const capture = async (name: string) => {
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: join(output, `${theme}-${width}-${name}.png`),
        animations: "disabled",
      });
    };
    await expect(region.getByText("Voice is ready", { exact: true })).toBeVisible();
    await assertVoiceRows(region);
    await capture("top");
    await region.locator('[data-setting-id="voice-persona"]').scrollIntoViewIfNeeded();
    await capture("bottom");
    for (const title of [
      "Voice options",
      "Dictation options",
      "Sleep and wake",
      "Appearance and voice style",
    ])
      await region.getByRole("button", { name: new RegExp(`^${title}`) }).click();
    await assertVoiceRows(region);
    for (const [name, id] of [
      ["engine-expanded", "voice-device"],
      ["dictation-expanded", "dictation-engine"],
      ["conversation-expanded", "voice-idle-sleep"],
      ["appearance-expanded", "voice-visual-style"],
    ]) {
      await region.locator(`[data-setting-id="${id}"]`).scrollIntoViewIfNeeded();
      await capture(name);
    }
    const last = region.getByRole("radio", { name: "Orb", exact: true });
    await last.scrollIntoViewIfNeeded();
    expect(
      await last.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return !!hit && (hit === element || element.contains(hit));
      }),
    ).toBe(true);
    await region.getByRole("button", { name: /^Reply voice:/ }).click();
    await expect(page.getByRole("listbox")).toBeVisible();
    const popup = (await page.getByRole("listbox").boundingBox())!;
    expect(popup.x).toBeGreaterThanOrEqual(0);
    expect(popup.x + popup.width).toBeLessThanOrEqual(width + 1);
    await capture("voice-picker");
    await page.keyboard.press("Escape");
    await region.getByRole("radio", { name: "Grok Voice", exact: true }).click();
    await assertVoiceRows(region);
    await region.locator('[data-setting-id="voice-mode"]').scrollIntoViewIfNeeded();
    await capture("grok");
    await region.getByRole("button", { name: /^Speaker:/ }).click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await capture("grok-speaker-picker");
    await page.keyboard.press("Escape");
    await region.getByRole("radio", { name: "OpenAI Realtime", exact: true }).click();
    await region.getByText("Advanced turn detection", { exact: true }).click();
    await assertVoiceRows(region);
    await region.locator('[data-setting-id="voice-semantic-vad"]').scrollIntoViewIfNeeded();
    await capture("openai-turn-detection");
    const experimental = region.getByRole("switch", {
      name: "Experimental OpenAI turn detection",
      exact: true,
    });
    const manual = region.getByRole("switch", { name: "I decide when my turn ends", exact: true });
    await expect(experimental).not.toBeChecked();
    await manual.check();
    await expect(experimental).toBeDisabled();
    await region.locator('[data-setting-id="voice-semantic-vad"]').scrollIntoViewIfNeeded();
    await capture("openai-manual-disabled");
    await manual.uncheck();
    await experimental.check();
    await expect(experimental).toBeChecked();
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("bycoda.voice")!).experimentalSemanticVad,
      ),
    ).toBe(true);
    await capture("openai-opt-in");
    await region.getByRole("button", { name: "Assistant settings", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /^Settings/ });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("textbox", { name: "Assistant name", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("radiogroup", { name: "How often to use your name", exact: true }),
    ).not.toBeVisible();
    await assertVoiceRows(dialog);
    await capture("assistant-personal");
    await dialog.getByRole("tab", { name: "Access", exact: true }).click();
    await assertVoiceRows(dialog);
    await expect(
      dialog.getByRole("switch", { name: "Physical input", exact: true }),
    ).not.toBeVisible();
    await capture("assistant-access");
    const footer = dialog.getByRole("button", { name: "Save profile settings", exact: true });
    await expect(footer).toBeVisible();
    const checks = dialog.locator("summary").filter({ hasText: "All checks" });
    await checks.scrollIntoViewIfNeeded();
    const checkBox = (await checks.boundingBox())!;
    const footerBox = (await footer.boundingBox())!;
    expect(checkBox.y + checkBox.height).toBeLessThan(footerBox.y);
    expect(
      await checks.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return !!hit && (hit === element || element.contains(hit));
      }),
    ).toBe(true);
    await capture("assistant-access-bottom");
  });
}

async function openVoice(page: Page, fixture: string, theme = "dark", width = 1280, lang = "en") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem(
      "bycoda.voice",
      JSON.stringify({
        enabled: true,
        natural: true,
        dictationEnabled: true,
        python: "",
        whisperPath: "",
        ttsPath: "",
      }),
    );
  });
  await page.goto(
    `/tests/browser/settings/settings.html?section=voice&voice=${fixture}&theme=${theme}&lang=${lang}`,
  );
  // Voice has its own page; its groups share one topics container.
  return page
    .locator(".settings-topics")
    .filter({ has: page.locator('[data-setting-id="voice-companion"]') });
}

for (const theme of ["light", "dark"]) {
  for (const width of [390, 1280]) {
    test(`voice setup keeps install direct and existing files in its action menu: ${theme} ${width}`, async ({
      page,
    }, testInfo) => {
      const group = await openVoice(page, "missing", theme, width);
      await expect(group.getByText("Voice setup is needed", { exact: true })).toBeVisible();
      await expect(group.getByRole("button", { name: "Install", exact: true })).toBeVisible();
      const more = group.getByRole("button", { name: "More voice setup actions", exact: true });
      await expect(more).toBeVisible();
      await more.click();
      await expect(
        page.getByRole("menuitem", { name: "Locate existing", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(group).not.toContainText("faster-whisper");
      await expect(group).not.toContainText("pip install");
      await expect(group).not.toContainText("Missing:");
      await expect(group.getByRole("textbox")).toHaveCount(0);
      await group.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await mkdir(captures, { recursive: true });
      const status = page
        .locator(".settings-group")
        .filter({ has: page.locator('[data-setting-id="voice-companion"]') });
      await status.screenshot({ path: testInfo.outputPath(`voice-missing-${theme}-${width}.png`) });
      const bounds = await status.boundingBox();
      await testInfo.attach("setup-bounds", {
        body: JSON.stringify({ theme, width, height: bounds!.height }),
        contentType: "application/json",
      });
      // Core controls stay visible; optional processing and visual controls unfold below.
      expect(bounds!.height).toBeLessThan(width < 600 ? 1040 : 680);
      const saved = await page.evaluate(() => localStorage.getItem("bycoda.voice"));
      await expect(
        group.getByRole("switch", { name: "I decide when my turn ends", exact: true }),
      ).toBeVisible();
      await expect(group.getByRole("switch", { name: "Memory", exact: true })).toBeVisible();
      await group.getByText("Appearance and voice style", { exact: true }).click();
      await group.getByText("Voice options", { exact: true }).click();
      await expect(
        group.getByRole("radiogroup", { name: "Visual style", exact: true }),
      ).toBeVisible();
      await expect(
        group.getByRole("radiogroup", { name: "Processing", exact: true }),
      ).toBeVisible();
      // Settings owns an inner scroller: viewport captures at both ends show every row.
      await page.screenshot({ path: testInfo.outputPath(`voice-top-${theme}-${width}.png`) });
      await group
        .getByRole("radiogroup", { name: "Visual style", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`voice-bottom-${theme}-${width}.png`) });
      expect(await page.evaluate(() => localStorage.getItem("bycoda.voice"))).toBe(saved);
      expect(
        await page.evaluate(() => sessionStorage.getItem("fixture-voice-install-request")),
      ).toBeNull();
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

test("stalled detection keeps Install available and ends with a retry", async ({ page }) => {
  const group = await openVoice(page, "stalled", "dark", 390);
  await expect(group.getByText("Checking voice setup…", { exact: true })).toBeVisible();
  await expect(group.getByRole("button", { name: "Install", exact: true })).toBeVisible();
  await expect(group.getByRole("button", { name: "Try again", exact: true })).toBeVisible({
    timeout: 25_000,
  });
  await expect(group.getByText("Checking voice setup…", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("voice locations are optional, keyboard accessible and return focus", async ({ page }) => {
  const group = await openVoice(page, "missing", "dark", 390);
  await group.getByRole("button", { name: /^Reply voice:/ }).click();
  await page.getByRole("option", { name: "High quality (VoxCPM2)", exact: true }).click();
  const locate = group.getByRole("button", { name: "More voice setup actions", exact: true });
  await locate.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Locate existing", exact: true }).focus();
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
  await expect(
    group.getByRole("button", { name: "More voice setup actions", exact: true }),
  ).toHaveCount(0);
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
  await group.getByRole("button", { name: "Diğer ses kurulumu eylemleri", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Yerini göster", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(group).not.toContainText("faster-whisper");
  await expect(group).not.toContainText("pip install");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir(captures, { recursive: true });
  await group.screenshot({ path: join(captures, "voice-missing-dark-390-tr.png") });
});

for (const theme of ["light", "dark"]) {
  test(`voice processing choice and GPU upgrade offer: ${theme}`, async ({ page }) => {
    const group = await openVoice(page, "cpu-only", theme);
    await expect(group.getByText("Voice is ready", { exact: true })).toBeVisible();
    // The default Natural voice (Supertonic) runs on the CPU: no GPU offer.
    await expect(
      group.getByRole("button", { name: "Install GPU support", exact: true }),
    ).toHaveCount(0);
    await group.getByRole("button", { name: /^Reply voice:/ }).click();
    await page.getByRole("option", { name: "High quality (VoxCPM2)", exact: true }).click();
    await expect(group.getByText("Voice is ready", { exact: true })).toBeVisible();
    await expect(group.getByText("NVIDIA GeForce RTX 4070", { exact: false })).toBeVisible();
    await expect(
      group.getByRole("button", { name: "Install GPU support", exact: true }),
    ).toBeVisible();
    await group.scrollIntoViewIfNeeded();
    const gpuCaptures = join(process.cwd(), "temp/verification/2026-10-31-voice-gpu");
    await mkdir(gpuCaptures, { recursive: true });
    await group.screenshot({ path: join(gpuCaptures, `voice-gpu-offer-${theme}-1280.png`) });
    await group.getByText("Voice options", { exact: true }).click();
    await group.getByRole("radio", { name: "CPU", exact: true }).click();
    await expect(
      group.getByRole("button", { name: "Install GPU support", exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem("bycoda.voice")!).device),
    ).toBe("cpu");
  });
}
