import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
const captures = join(process.cwd(), "temp/verification/arif-assistant");
for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`Host identity and preserved device voice style: ${theme} ${width}`, async ({
      page,
    }, testInfo) => {
      await mkdir(captures, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(() => {
        localStorage.setItem(
          "bycoda.voice.persona",
          JSON.stringify({
            status: "configured",
            name: "Legacy name",
            rules: "Legacy owner rule",
            tone: "calm",
          }),
        );
        (window as any).assistantNavigation = [];
        window.addEventListener("bycoda:open-assistant", (event) =>
          (window as any).assistantNavigation.push((event as CustomEvent).detail),
        );
      });
      await page.goto(`/tests/browser/voice/voice-visual-styles.html?theme=${theme}`);
      await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
      await expect(
        page
          .locator("section[data-voice-state]")
          .getByRole("heading", { name: "Assistant Arif", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      // Identity sits in its own Companion group, visible without a disclosure.
      const row = page.locator('[data-setting-id="voice-persona"]');
      await row.getByRole("button", { name: "Customize", exact: true }).click();
      expect(await page.evaluate(() => (window as any).assistantNavigation)).toEqual([
        { tab: "settings" },
      ]);
      await row.getByRole("button", { name: "Voice style", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Voice style", exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel("Companion name", { exact: true })).toHaveCount(0);
      await expect(dialog.getByLabel("Ground rules", { exact: true })).toHaveCount(0);
      await dialog.getByRole("checkbox", { name: "Explain code and decisions" }).check();
      await dialog.getByLabel("Tone", { exact: true }).click();
      await page.getByRole("option", { name: "Calm and patient", exact: true }).click();
      await dialog.screenshot({ path: join(captures, `${theme}-${width}-voice-style.png`) });
      await dialog.screenshot({ path: testInfo.outputPath(`voice-style-${theme}-${width}.png`) });
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      expect(
        await page.evaluate(() => JSON.parse(localStorage.getItem("bycoda.voice.persona")!)),
      ).toMatchObject({
        name: "Legacy name",
        rules: "Legacy owner rule",
        tone: "calm",
        duties: ["explain"],
      });
    });
    test(`memory routes to the Host Room and device disable remains saved: ${theme} ${width}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(() => {
        (window as any).assistantNavigation = [];
        window.addEventListener("bycoda:open-assistant", (event) =>
          (window as any).assistantNavigation.push((event as CustomEvent).detail),
        );
      });
      await page.goto(`/tests/browser/voice/voice-visual-styles.html?theme=${theme}`);
      const row = page.locator('[data-setting-id="voice-memory"]');
      await row.getByRole("button", { name: "Manage (0)", exact: true }).click();
      expect(await page.evaluate(() => (window as any).assistantNavigation)).toEqual([
        { tab: "memory" },
      ]);
      await expect(page.getByRole("dialog", { name: "Companion memory", exact: true })).toHaveCount(
        0,
      );
      await row.getByRole("switch", { name: "Memory", exact: true }).click();
      expect(
        await page.evaluate(() => JSON.parse(localStorage.getItem("bycoda.voice.memory")!).enabled),
      ).toBe(false);
      await page.reload();
      await expect(row.getByRole("switch", { name: "Memory", exact: true })).not.toBeChecked();
      await row.screenshot({ path: testInfo.outputPath(`memory-disabled-${theme}-${width}.png`) });
    });
  }
