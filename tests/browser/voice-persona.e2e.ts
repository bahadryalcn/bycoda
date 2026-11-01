import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const captures = join(process.cwd(), "temp/verification/2026-11-01-voice-persona");

for (const theme of ["light", "dark"]) {
  for (const width of [800, 1280]) {
    test(`first launch offers persona setup, Settings edits it: ${theme} ${width}`, async ({
      page,
    }) => {
      await mkdir(captures, { recursive: true });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/voice-visual-styles.html?first-run&theme=${theme}`);
      await page.getByRole("button", { name: "Voice companion", exact: true }).click();
      const welcome = page.getByRole("dialog", { name: "Make the voice companion yours" });
      await expect(welcome).toBeVisible();
      await page.screenshot({ path: join(captures, `welcome-${theme}-${width}.png`) });

      // Presets and the owner's own words are both accepted.
      await welcome.getByLabel("Companion name").fill("Ada");
      await welcome.getByLabel("Your name", { exact: true }).fill("Bahadır");
      await welcome.getByRole("checkbox", { name: "Explain code and decisions" }).check();
      await welcome.getByLabel("Ground rules").fill("Keep replies short.");
      await welcome.getByLabel("Tone").click();
      await page.getByRole("option", { name: "Calm and patient" }).click();
      await welcome.getByRole("button", { name: "Save and start" }).click();
      await expect(welcome).toBeHidden();
      const saved = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("bycoda.voice.persona") ?? "null"),
      );
      expect(saved).toMatchObject({
        status: "configured",
        name: "Ada",
        userName: "Bahadır",
        tone: "calm",
        duties: ["explain"],
        rules: "Keep replies short.",
      });

      const row = page.locator('[data-setting-id="voice-persona"]');
      await expect(row).toContainText("Ada · Calm and patient");
      await row.screenshot({ path: join(captures, `settings-row-${theme}-${width}.png`) });
      await row.getByRole("button", { name: "Customize" }).click();
      const edit = page.getByRole("dialog", { name: "Companion identity" });
      await expect(edit.getByLabel("Companion name")).toHaveValue("Ada");
      await page.screenshot({ path: join(captures, `edit-${theme}-${width}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await edit.getByRole("button", { name: "Cancel" }).click();

      // Reopening the companion does not ask again.
      await page.getByRole("button", { name: "Close voice companion", exact: true }).click();
      await page.getByRole("button", { name: "Voice companion", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });
  }
}

for (const theme of ["light", "dark"]) {
  for (const width of [800, 1280]) {
    test(`memory notes can be added, listed and forgotten from Settings: ${theme} ${width}`, async ({
      page,
    }) => {
      await mkdir(captures, { recursive: true });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/voice-visual-styles.html?theme=${theme}`);
      const row = page.locator('[data-setting-id="voice-memory"]');
      await row.getByRole("button", { name: "Manage (0)" }).click();
      const dialog = page.getByRole("dialog", { name: "Companion memory" });
      await expect(dialog).toContainText("Nothing remembered yet");
      for (const note of ["Prefers replies in Turkish", "Works mostly on the bycoda desktop app"]) {
        await dialog.getByLabel("New note").fill(note);
        await dialog.getByRole("button", { name: "Add" }).click();
      }
      const notes = dialog.getByRole("list", { name: "Saved notes" }).getByRole("listitem");
      await expect(notes).toHaveCount(2);
      await page.screenshot({ path: join(captures, `memory-${theme}-${width}.png`) });
      await notes.first().getByRole("button", { name: "Forget note" }).click();
      await expect(notes).toHaveCount(1);
      await dialog.getByRole("button", { name: "Done" }).click();
      await expect(row.getByRole("button", { name: "Manage (1)" })).toBeVisible();
      await row.screenshot({ path: join(captures, `memory-row-${theme}-${width}.png`) });
      expect(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("bycoda.voice.memory") ?? "null").notes.length,
        ),
      ).toBe(1);
    });
  }
}
