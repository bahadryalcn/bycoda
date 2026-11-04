import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
const captures = join(process.cwd(), "temp/verification/voice-visual-styles");
for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`explicit turn ending is discoverable without reconnecting ${theme} ${width}`, async ({
      page,
    }) => {
      const output = join(process.cwd(), "temp/verification/voice-turn-menu-2026-11-03/legacy");
      await mkdir(output, { recursive: true });
      const menuOutput = join(
        process.cwd(),
        "temp/verification/voice-turn-menu-2026-11-03/captures",
      );
      await mkdir(menuOutput, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/voice-visual-styles.html?theme=${theme}&global`);
      await page.getByRole("button", { name: "Voice companion", exact: true }).click();
      const panel = page.locator("section[data-voice-state]");
      await panel.getByRole("button", { name: "Start voice", exact: true }).click();
      await expect(panel).toHaveAttribute("data-voice-state", "listening");
      await panel.screenshot({ path: join(output, `${theme}-${width}-full-automatic.png`) });
      await panel.getByRole("button", { name: "Reply when I pause", exact: true }).click();
      await expect(
        page.getByRole("menuitemradio", { name: "Reply when I pause", exact: true }),
      ).toBeChecked();
      await page
        .getByRole("menuitemradio", { name: "I'll finish when ready", exact: true })
        .click();
      await expect(panel.getByRole("button", { name: "Finish turn", exact: true })).toBeVisible();
      const selected = await page.evaluate(() => ({
        settings: JSON.parse(localStorage.getItem("bycoda.voice")!),
        runtime: (window as any).fixtureVoice,
      }));
      expect(selected.settings).toMatchObject({ manualTurnEnd: true, manualTurnEndRevision: 1 });
      expect(selected.runtime.connects).toBe(1);
      expect(selected.runtime.finishes).toBe(0);
      expect(selected.runtime.submits).toBe(0);
      expect(selected.runtime.turnPolicies.at(-1)).toMatchObject({ manualTurnEnd: true });
      await panel.screenshot({ path: join(output, `${theme}-${width}-full-manual.png`) });
      await panel.getByRole("button", { name: "Turn ending", exact: true }).click();
      await expect(
        page.getByRole("menuitemradio", { name: "I'll finish when ready", exact: true }),
      ).toBeChecked();
      await expect(
        page.getByRole("menuitemradio", { name: "Reply when I pause", exact: true }),
      ).not.toBeChecked();
      await page.screenshot({
        path: join(output, `${theme}-${width}-policy-menu.png`),
        animations: "disabled",
      });
      await page.screenshot({
        path: join(menuOutput, `${theme}-${width}-in-app-expanded-manual-menu.png`),
        animations: "disabled",
      });
      await page.getByRole("menuitemradio", { name: "Reply when I pause", exact: true }).click();
      await panel.getByRole("button", { name: "Compact voice companion", exact: true }).click();
      await expect(panel.getByRole("button", { name: "Turn ending", exact: true })).toBeVisible();
      await panel.screenshot({ path: join(output, `${theme}-${width}-compact-automatic.png`) });
      await panel.getByRole("button", { name: "Turn ending", exact: true }).click();
      await expect(
        page.getByRole("menuitemradio", { name: "Reply when I pause", exact: true }),
      ).toBeChecked();
      await page.screenshot({
        path: join(menuOutput, `${theme}-${width}-in-app-compact-auto-menu.png`),
        animations: "disabled",
      });
      await page
        .getByRole("menuitemradio", { name: "I'll finish when ready", exact: true })
        .click();
      await panel.getByRole("button", { name: "Turn ending", exact: true }).click();
      await expect(
        page.getByRole("menuitemradio", { name: "I'll finish when ready", exact: true }),
      ).toBeChecked();
      await page.screenshot({
        path: join(menuOutput, `${theme}-${width}-in-app-compact-manual-menu.png`),
        animations: "disabled",
      });
      await page
        .getByRole("menuitemradio", { name: "I'll finish when ready", exact: true })
        .press("Escape");
      await panel.getByRole("button", { name: "Finish turn", exact: true }).click();
      expect(await page.evaluate(() => (window as any).fixtureVoice.finishes)).toBe(1);
      expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await panel.screenshot({ path: join(output, `${theme}-${width}-compact-manual.png`) });
      await page.goto(`/tests/browser/voice-overlay.html?theme=${theme}&compact=0`);
      await page
        .locator("#root")
        .evaluate((node) => ((node as HTMLElement).style.maxWidth = "380px"));
      const floating = page.locator("main[aria-label]");
      await floating.getByRole("button", { name: "Reply when I pause", exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as any).fixtureOverlay
                .nativeMenu()
                ?.items.find((item: any) => item.id === "automatic")?.checked,
          ),
        )
        .toBe(true);
      await page.evaluate(() => (window as any).fixtureOverlay.pickNativeMenu("manual"));
      expect(
        await page.evaluate(() =>
          (window as any).fixtureOverlay.calls.some(
            (call: any) => call.args?.payload === "manualTurnEnd",
          ),
        ),
      ).toBe(true);
      await page.evaluate(() => (window as any).fixtureOverlay.emit({ manualTurnEnd: true }));
      await floating.getByRole("button", { name: "Finish turn", exact: true }).click();
      expect(
        await page.evaluate(() =>
          (window as any).fixtureOverlay.calls.some(
            (call: any) => call.args?.payload === "finishTurn",
          ),
        ),
      ).toBe(true);
      await floating.screenshot({ path: join(output, `${theme}-${width}-floating-manual.png`) });
      await floating.getByRole("button", { name: "Compact voice companion", exact: true }).click();
      // Apply the component's actual native fit request to this synthetic document.
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as any).fixtureOverlay.calls
                .filter((call: any) => call.cmd === "voice_overlay_fit")
                .at(-1)?.args.height,
          ),
        )
        .toBe(56);
      const fit = await page.evaluate(
        () =>
          (window as any).fixtureOverlay.calls
            .filter((call: any) => call.cmd === "voice_overlay_fit")
            .at(-1).args,
      );
      await page.setViewportSize({ width: fit.width, height: fit.height });
      await page.evaluate(() => (window as any).fixtureOverlay.emit({ manualTurnEnd: false }));
      await floating.screenshot({
        path: join(output, `${theme}-${width}-floating-compact-automatic.png`),
      });
      await floating.getByRole("button", { name: "Turn ending", exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as any).fixtureOverlay
                .nativeMenu()
                ?.items.find((item: any) => item.id === "automatic")?.checked,
          ),
        )
        .toBe(true);
      await page.evaluate(() => (window as any).fixtureOverlay.pickNativeMenu("manual"));
      expect(
        await page.evaluate(
          () =>
            (window as any).fixtureOverlay.calls.filter(
              (call: any) => call.args?.payload === "manualTurnEnd",
            ).length,
        ),
      ).toBe(2);
      await page.evaluate(() => (window as any).fixtureOverlay.emit({ manualTurnEnd: true }));
      await expect(
        floating.getByRole("button", { name: "Finish turn", exact: true }),
      ).toBeVisible();
      expect(await floating.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await floating.screenshot({ path: join(output, `${theme}-${width}-floating-compact.png`) });
      await page.goto(`/tests/browser/voice-visual-styles.html?theme=${theme}`);
      const advanced = page.getByRole("button", { name: "Advanced", exact: true });
      await expect(advanced).toHaveAttribute("aria-expanded", "false");
      await expect(
        page.getByRole("switch", { name: "I decide when my turn ends", exact: true }),
      ).toHaveCount(0);
      await advanced.focus();
      await advanced.press("Enter");
      const toggle = page.getByRole("switch", { name: "I decide when my turn ends", exact: true });
      await toggle.scrollIntoViewIfNeeded();
      await expect(toggle).toBeChecked();
      await page.screenshot({ path: join(output, `${theme}-${width}-settings-manual.png`) });
      expect(await page.evaluate(() => (window as any).fixtureVoice.connects)).toBe(0);
    });
async function open(
  page: Page,
  visual = "mark",
  state = "listening",
  theme = "dark",
  width = 1280,
) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(
    `/tests/browser/voice-visual-styles.html?visual=${visual}&state=${state}&theme=${theme}`,
  );
  await page.getByRole("button", { name: "Voice companion", exact: true }).click();
  const panel = page.locator("section[data-voice-state]");
  if (state !== "off") {
    await panel.getByRole("button", { name: "Start voice", exact: true }).click();
    await expect(panel).toHaveAttribute(
      "data-voice-state",
      state === "connecting" ? "connecting" : "listening",
    );
  }
  await page.evaluate((state) => {
    const cb = (window as any).fixtureVoice.callbacks;
    if (state === "user") cb.state("speaking");
    if (state === "thinking") cb.state("transcribing");
    if (state === "assistant") cb.playback(true);
    if (state === "error") cb.error("Local voice disconnected. Start voice again.");
  }, state);
  if (state === "muted")
    await panel.getByRole("button", { name: "Pause mic", exact: true }).click();
  await expect(panel).toHaveAttribute(
    "data-voice-state",
    state === "working" ? "listening" : state,
  );
  return panel;
}
for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`visual/state matrix and picker: ${theme} ${width}`, async ({ page }) => {
      await mkdir(captures, { recursive: true });
      for (const visual of ["mark", "wave", "dots", "orb"]) {
        for (const state of [
          "off",
          "connecting",
          "listening",
          "user",
          "thinking",
          "assistant",
          "muted",
          "error",
          "working",
        ]) {
          const panel = await open(page, visual, state, theme, width);
          await expect(panel.locator(`[data-visual="${visual}"]`)).toBeVisible();
          expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
          await panel.screenshot({
            path: join(captures, `${theme}-${width}-${visual}-${state}.png`),
            animations: "disabled",
          });
        }
        await panelCompact(page, visual, theme, width);
      }
      await page.getByRole("button", { name: "Expand voice companion", exact: true }).click();
      const picker = page.getByRole("radiogroup", { name: "Visual style", exact: true });
      await expect(picker).toHaveCount(0);
      const advanced = page.getByRole("button", { name: "Advanced", exact: true });
      await expect(advanced).toHaveAttribute("aria-expanded", "false");
      await advanced.focus();
      await advanced.press("Enter");
      await picker.scrollIntoViewIfNeeded();
      await picker.getByRole("radio", { name: "Wave", exact: true }).click();
      await expect(
        page.locator("section[data-voice-state]").locator('[data-visual="wave"]'),
      ).toBeVisible();
      await picker.getByRole("radio", { name: "Wave", exact: true }).press("ArrowRight");
      await expect(picker.getByRole("radio", { name: "Dots", exact: true })).toBeFocused();
      await expect(picker.getByRole("radio", { name: "Dots", exact: true })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await expect.poll(() => page.evaluate(() => (window as any).fixtureVoice.connects)).toBe(1);
      await picker.screenshot({
        path: join(captures, `${theme}-${width}-picker.png`),
        animations: "disabled",
      });
    });
  }
async function panelCompact(page: Page, visual: string, theme: string, width: number) {
  const panel = await open(page, visual, "assistant", theme, width);
  await panel.getByRole("button", { name: "Compact voice companion" }).click();
  await expect(panel).toHaveAttribute("data-compact", "true");
  await expect(panel.getByRole("button", { name: "Expand voice companion" })).toBeFocused();
  await panel.screenshot({
    path: join(captures, `${theme}-${width}-${visual}-compact.png`),
    animations: "disabled",
  });
  expect(await page.evaluate(() => (window as any).fixtureVoice.closes)).toBe(0);
}
test("keyboard move, drag, compact double click, viewport clamp, Escape and reduced motion", async ({
  page,
}) => {
  const panel = await open(page);
  const grip = panel.getByRole("button", {
    name: "Move voice window. Use arrow keys to reposition.",
  });
  const before = (await panel.boundingBox())!;
  await grip.press("ArrowLeft");
  expect((await panel.boundingBox())!.x).toBe(before.x - 16);
  await panel.getByRole("button", { name: "Compact voice companion" }).click();
  await expect(panel).toHaveAttribute("data-compact", "true");
  await expect(panel.getByRole("button", { name: "Expand voice companion" })).toBeFocused();
  // Wait for the changed grip geometry before sending raw pointer coordinates.
  await grip.click({ trial: true });
  const pos = (await grip.boundingBox())!;
  await page.mouse.move(pos.x + 10, pos.y + 10);
  await page.mouse.down();
  await page.mouse.move(500, 100);
  await page.mouse.up();
  expect((await panel.boundingBox())!.y).toBeLessThan(150);
  await grip.dblclick();
  await expect(panel).not.toHaveAttribute("data-compact");
  await page.setViewportSize({ width: 800, height: 600 });
  await expect
    .poll(async () => {
      const b = (await panel.boundingBox())!;
      return b.x + b.width <= 800 && b.y + b.height <= 600;
    })
    .toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(panel.locator("[data-visual]")).toHaveAttribute("data-animating", "false");
  await page.screenshot({
    path: join(captures, "reduced-motion-dark-800.png"),
    animations: "disabled",
  });
  await panel.press("Escape");
  await expect(panel).toHaveAttribute("data-voice-state", "listening");
  expect(await page.evaluate(() => (window as any).fixtureVoice.closes)).toBe(0);
  await panel.getByRole("button", { name: "Close voice companion", exact: true }).click();
  await expect(page.getByRole("button", { name: "Voice companion", exact: true })).toBeFocused();
});
