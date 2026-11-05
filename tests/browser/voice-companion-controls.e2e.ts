import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "@playwright/test";

const output = join(process.cwd(), "temp/verification/2026-11-04-voice-controls");
for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`voice controls and input feedback ${theme} ${width}`, async ({ page }) => {
      page.setDefaultTimeout(15_000);
      page.on("pageerror", (error) => {
        throw error;
      });
      await mkdir(output, { recursive: true });
      await writeFile(
        join(output, "README.md"),
        "# Voice control verification\n\nSynthetic microphone, session and native IPC fixtures. Captures exercise real React controls at both themes and widths. No acoustic, provider or installed-app acceptance.\n",
      );
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/voice-visual-styles.html?theme=${theme}&global&working`);
      await page.getByRole("button", { name: "Voice companion", exact: true }).click();
      const panel = page.locator("section[data-voice-state]");
      await panel.getByRole("button", { name: "Start voice", exact: true }).click();
      await expect(panel).toHaveAttribute("data-voice-state", "listening");
      const capture = async (name: string) => {
        const panelBounds = await panel.boundingBox();
        for (const button of await panel.getByRole("button").all()) {
          if (!(await button.isVisible())) continue;
          const bounds = await button.boundingBox();
          expect(bounds!.x).toBeGreaterThanOrEqual(panelBounds!.x);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
            panelBounds!.x + panelBounds!.width,
          );
        }
        return panel.screenshot({ path: join(output, `${theme}-${width}-${name}.png`) });
      };
      await page.evaluate(() => ((window as any).fixtureVoice.audioLevel.current = 0));
      await expect(panel.locator('[data-hearing="false"]:visible')).toHaveCount(1);
      await capture("full-silent");
      await page.evaluate(() => ((window as any).fixtureVoice.audioLevel.current = 0.8));
      await expect(panel.locator('[data-hearing="true"]:visible')).toHaveCount(1);
      await expect(panel.getByText("Microphone is receiving sound", { exact: true })).toBeVisible();
      await capture("full-hearing");
      await panel.getByRole("button", { name: "Reply when I pause", exact: true }).click();
      await expect(page.getByRole("menu")).toHaveCSS("opacity", "1");
      await page.screenshot({ path: join(output, `${theme}-${width}-turn-menu.png`) });
      await page
        .getByRole("menuitemradio", { name: "I'll finish when ready", exact: true })
        .click();
      await panel.getByRole("button", { name: "Compact voice companion", exact: true }).click();
      const finish = panel.getByRole("button", { name: "Finish turn", exact: true });
      await expect(finish).toHaveText("");
      await expect(
        panel.getByRole("button", { name: "Disconnect voice", exact: true }),
      ).toBeVisible();
      await capture("compact-hearing");
      await panel.getByRole("button", { name: "Mute speaker", exact: true }).click();
      expect(await page.evaluate(() => (window as any).fixtureVoice.speakerMuted)).toBe(true);
      await panel.getByRole("button", { name: "Pause mic", exact: true }).click();
      await expect(finish).toBeDisabled();
      await capture("compact-muted");
      expect(await page.evaluate(() => (window as any).fixtureVoice.connects)).toBe(1);
      expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await panel.getByRole("button", { name: "Resume", exact: true }).click();
      await expect(panel.locator('[data-hearing="true"]:visible')).toHaveCount(1);
      await expect(panel.getByText("Sound detected", { exact: true })).toBeVisible();
      await capture("compact-reduced-motion");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await panel.getByRole("button", { name: "Disconnect voice", exact: true }).click();
      expect(await page.evaluate(() => (window as any).fixtureVoice.stops)).toBe(0);
      await page.goto(
        `/tests/browser/voice-visual-styles.html?theme=${theme}&global&state=connecting`,
      );
      await page.getByRole("button", { name: "Voice companion", exact: true }).click();
      await panel.getByRole("button", { name: "Start voice", exact: true }).click();
      await expect(panel).toHaveAttribute("data-voice-state", "connecting");
      await capture("full-connecting");
      await page.goto(`/tests/browser/voice-native-menu.html?theme=${theme}&compact=1&manual`);
      const frame = page.frameLocator('iframe[title="Synthetic native voice window"]');
      const proof = page.locator("[data-native-menu-proof]");
      await expect(frame.getByRole("button", { name: "Mute speaker", exact: true })).toBeVisible();
      expect(
        await frame.locator("main").evaluate((node) => node.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await proof.screenshot({ path: join(output, `${theme}-${width}-floating-compact.png`) });
      await frame.getByRole("button", { name: "Turn ending", exact: true }).click();
      await expect(page.getByRole("menu", { name: "Synthetic turn ending menu" })).toBeVisible();
      await proof.screenshot({ path: join(output, `${theme}-${width}-floating-menu.png`) });
      await page.getByRole("button", { name: "Dismiss synthetic menu", exact: true }).click();
      await frame.getByRole("button", { name: "Mute speaker", exact: true }).click();
      expect(
        await frame
          .locator("body")
          .evaluate(() =>
            (window as any).fixtureOverlay.calls.some(
              (call: any) => call.args?.payload === "toggleSpeaker",
            ),
          ),
      ).toBe(true);
      await frame.getByRole("button", { name: "Expand voice companion", exact: true }).click();
      await proof.screenshot({ path: join(output, `${theme}-${width}-floating-full.png`) });
      await frame.locator("body").evaluate(() =>
        (window as any).fixtureOverlay.emit({
          activity: [
            {
              id: "fixture-activity",
              name: "tasks.start",
              target: "Fixture project",
              projectPath: "/fixture",
              requestId: "fixture-request",
              startedAt: 0,
              elapsedMs: 1200,
              state: "running",
            },
          ],
        }),
      );
      await expect(frame.getByText("Waiting for result", { exact: true })).toBeVisible();
      await proof.screenshot({ path: join(output, `${theme}-${width}-floating-activity.png`) });
      await frame.getByRole("button", { name: "Stop waiting", exact: true }).click();
      expect(
        await frame
          .locator("body")
          .evaluate(() =>
            (window as any).fixtureOverlay.calls.some(
              (call: any) =>
                call.args?.event === "voice_overlay_activity_stop_waiting" &&
                call.args?.payload === "fixture-activity",
            ),
          ),
      ).toBe(true);
      await page.goto(
        `/tests/browser/voice-visual-styles.html?theme=${theme}&global&pending-tool&push-to-talk`,
      );
      await page.getByRole("button", { name: "Voice companion", exact: true }).click();
      await panel.getByRole("button", { name: "Start voice", exact: true }).click();
      await panel.getByRole("button", { name: "Pause mic", exact: true }).click();
      await expect(panel.getByText(/Hold .* to talk/)).toBeVisible();
      await expect(panel.getByText(/Hold .* to talk/)).not.toContainText("{");
      await expect(panel.getByText(/Hold .* to talk/)).toContainText("M");
      await capture("push-to-talk-ready");
      await page.keyboard.down("Control");
      await page.keyboard.down("Shift");
      await page.keyboard.down("m");
      await expect
        .poll(() => page.evaluate(() => (window as any).fixtureVoice.pushToTalkStarts))
        .toBe(1);
      await capture("push-to-talk-held");
      await page.keyboard.up("m");
      await page.keyboard.up("Shift");
      await page.keyboard.up("Control");
      expect(await page.evaluate(() => (window as any).fixtureVoice.pushToTalkEnds)).toBe(1);
      await expect(panel.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
      await page.evaluate(() => (window as any).fixtureVoice.speech("List projects"));
      await expect(panel.getByText("Waiting for result", { exact: true })).toBeVisible();
      await capture("activity-running");
      await panel.getByRole("button", { name: "Stop waiting", exact: true }).click();
      await expect(
        panel.getByText("Result unknown. Check before retrying.", { exact: true }),
      ).toBeVisible();
      await capture("activity-uncertain");
      await page.evaluate(() =>
        (window as any).fixtureVoice.finishTool({ status: "completed", projects: [] }),
      );
      await panel.getByText("Voice actions", { exact: true }).click();
      await expect(panel.getByText(/Result received/)).toBeVisible();
      await capture("activity-returned");
    });
