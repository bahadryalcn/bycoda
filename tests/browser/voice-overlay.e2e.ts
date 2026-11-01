import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// Fixture evidence: synthetic state through a stubbed IPC. Native placement,
// always-on-top and dragging across applications need the desktop app.
const captures = join(process.cwd(), "temp/verification/voice-overlay");

for (const theme of ["light", "dark"]) {
  test(`floating voice window: ${theme}`, async ({ page }) => {
    await mkdir(captures, { recursive: true });
    await page.setViewportSize({ width: 380, height: 56 });
    await page.goto(`/tests/browser/voice-overlay.html?theme=${theme}`);
    const panel = page.locator("main[aria-label]");
    await expect(panel).toHaveAttribute("data-compact", "true");
    await expect(panel).toHaveAttribute("data-voice-state", "assistant");
    // The newest reply is visible in the pill, not just a status word.
    await expect(panel.locator("h1 + span")).toContainText("238 test");
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: join(captures, `${theme}-compact.png`) });

    await page.getByRole("button", { name: "Pause mic" }).click();
    await page.getByRole("button", { name: "Return voice companion to the app" }).click();
    const sent = await page.evaluate(() =>
      (window as any).fixtureOverlay.calls
        .filter((call: any) => call.cmd === "plugin:event|emit_to")
        .map((call: any) => [call.args.target, call.args.payload]),
    );
    expect(sent).toContainEqual([{ kind: "AnyLabel", label: "main" }, "toggleMute"]);
    expect(sent).toContainEqual([{ kind: "AnyLabel", label: "main" }, "dock"]);

    await page.getByRole("button", { name: "Expand voice companion" }).click();
    await expect(panel).not.toHaveAttribute("data-compact");
    const fits = await page.evaluate(() =>
      (window as any).fixtureOverlay.calls.filter((call: any) => call.cmd === "voice_overlay_fit"),
    );
    const height = fits.at(-1).args.height;
    expect(height).toBeGreaterThan(120);
    await page.setViewportSize({ width: 380, height });
    await expect(panel.getByText("Testler geçti mi")).toBeVisible();
    await page.screenshot({ path: join(captures, `${theme}-expanded.png`) });

    await panel
      .getByRole("button", { name: "Move voice window. Use arrow keys to reposition." })
      .press("ArrowRight");
    const nudges = await page.evaluate(() =>
      (window as any).fixtureOverlay.calls.filter(
        (call: any) => call.cmd === "voice_overlay_nudge",
      ),
    );
    expect(nudges.at(-1).args).toEqual({ dx: 16, dy: 0 });
  });
}

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`in-app compact pill shows the latest line: ${theme} ${width}`, async ({ page }) => {
      await mkdir(captures, { recursive: true });
      await page.setViewportSize({ width, height: 700 });
      await page.goto(`/tests/browser/voice-visual-styles.html?theme=${theme}`);
      await page.getByRole("button", { name: "Voice companion", exact: true }).click();
      const panel = page.locator("section[data-voice-state]");
      await panel.getByRole("button", { name: "Start voice", exact: true }).click();
      await expect(panel).toHaveAttribute("data-voice-state", "listening");
      await page.evaluate(() =>
        (window as any).fixtureVoice.speech("Testler geçti mi, hangi dosyalar değişti?"),
      );
      await panel.getByRole("button", { name: "Compact voice companion" }).click();
      await expect(panel).toHaveAttribute("data-compact", "true");
      await expect(panel.locator("h2 + span")).toContainText("Testler geçti mi");
      const grip = panel.getByRole("button", { name: /^Move voice window/ });
      await expect(grip).toHaveAttribute("data-button-variant", "ghost");
      expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await panel.screenshot({
        path: join(captures, `inapp-${theme}-${width}-compact.png`),
        animations: "disabled",
      });
    });
