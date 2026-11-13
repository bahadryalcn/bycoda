import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
const captures = join(process.cwd(), "temp/verification/voice-visual-styles");
for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`bounded voice motion on high-refresh display ${theme} ${width}`, async ({
      browser,
      baseURL,
    }) => {
      const output = join(process.cwd(), "temp/verification/2026-11-13-voice-motion");
      await mkdir(output, { recursive: true });
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: "no-preference",
        recordVideo: { dir: output },
      });
      const page = await context.newPage();
      const base = new URL("/tests/browser/voice/", baseURL).href;
      const moving = async (selector: string) => {
        const node = page.locator(selector).first();
        await expect(node).toBeVisible();
        const before = await node.evaluate((el) => el.outerHTML);
        await expect.poll(() => node.evaluate((el) => el.outerHTML)).not.toBe(before);
      };
      try {
        await page.goto(`${base}voice-visual-styles.html?theme=${theme}&high-refresh`);
        await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
        await page.getByRole("button", { name: "Start voice", exact: true }).click();
        await expect(page.locator("html")).toHaveAttribute("data-decorative-motion", "off");
        await moving("[data-turn]");
        await page.screenshot({ path: join(output, `${theme}-${width}-listening.png`) });
        for (const visual of ["mark", "wave", "dots", "orb"]) {
          await page.goto(
            `${base}voice-visual-styles.html?theme=${theme}&high-refresh&working-probe&visual=${visual}`,
          );
          await moving("[data-visual] svg");
          await expect(page.locator("[data-visual]")).toHaveAttribute("data-hearing", "false");
          await page.emulateMedia({ reducedMotion: "reduce" });
          await expect(page.locator("[data-visual]")).toHaveAttribute("data-animating", "false");
          const still = await page.locator("[data-visual] svg").innerHTML();
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              ),
          );
          expect(await page.locator("[data-visual] svg").innerHTML()).toBe(still);
          await page.emulateMedia({ reducedMotion: "no-preference" });
        }
        await page.goto(`${base}voice-overlay.html?theme=${theme}&compact=0&high-refresh`);
        await moving("[data-turn]");
      } finally {
        await context.close();
        await page.video()?.saveAs(join(output, `${theme}-${width}-motion.webm`));
      }
    });
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
      await page.goto(`/tests/browser/voice/voice-visual-styles.html?theme=${theme}&global`);
      await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
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
      // Expanded, the turn mode button is named after the current mode.
      await panel.getByRole("button", { name: "I'll finish when ready", exact: true }).click();
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
      // The compact pill keeps turn ending and Finish turn in its More menu.
      const more = panel.getByRole("button", { name: "More voice options", exact: true });
      await expect(more).toBeVisible();
      await panel.screenshot({ path: join(output, `${theme}-${width}-compact-automatic.png`) });
      await more.click();
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
      await more.click();
      await expect(
        page.getByRole("menuitemradio", { name: "I'll finish when ready", exact: true }),
      ).toBeChecked();
      await page.screenshot({
        path: join(menuOutput, `${theme}-${width}-in-app-compact-manual-menu.png`),
        animations: "disabled",
      });
      await page.getByRole("menuitem", { name: "Finish turn", exact: true }).click();
      expect(await page.evaluate(() => (window as any).fixtureVoice.finishes)).toBe(1);
      expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await panel.screenshot({ path: join(output, `${theme}-${width}-compact-manual.png`) });
      await page.goto(`/tests/browser/voice/voice-overlay.html?theme=${theme}&compact=0`);
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
      await page.goto(`/tests/browser/voice/voice-visual-styles.html?theme=${theme}`);
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
    `/tests/browser/voice/voice-visual-styles.html?visual=${visual}&state=${state}&theme=${theme}`,
  );
  await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
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
          const actualState = state === "working" ? "listening" : state;
          await expect(
            panel
              .locator(`span[data-state="${actualState}"]`)
              .filter({ has: page.locator("[data-spoke]") }),
          ).toBeVisible();
          expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
          await panel.screenshot({
            path: join(captures, `${theme}-${width}-${visual}-${state}.png`),
            animations: "disabled",
          });
          await panel.getByRole("button", { name: "Compact voice companion", exact: true }).click();
          await expect(panel.locator(`[data-visual="${visual}"]`)).toBeVisible();
          await expect(panel).toHaveAttribute("data-voice-state", actualState);
          await panel.getByRole("button", { name: "Expand voice companion", exact: true }).click();
        }
        await panelCompact(page, visual, theme, width);
      }
      await page.getByRole("button", { name: "Expand voice companion", exact: true }).click();
      await page.getByText("Appearance and voice style", { exact: true }).click();
      const picker = page.getByRole("radiogroup", { name: "Visual style", exact: true });
      await picker.scrollIntoViewIfNeeded();
      await picker.getByRole("radio", { name: "Wave", exact: true }).click();
      await expect(picker.getByRole("radio", { name: "Wave", exact: true })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await expect(picker.locator('[data-visual="wave"]')).toBeVisible();
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
      const panel = page.locator("section[data-voice-state]");
      await panel.getByRole("button", { name: "Compact voice companion", exact: true }).click();
      await expect(panel.locator('[data-visual="dots"]')).toBeVisible();
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
  await page.mouse.move(pos.x + pos.width / 2, pos.y + pos.height / 2);
  await page.mouse.down();
  // Cross the drag threshold inside the header before travelling outside it.
  await page.mouse.move(500, 100, { steps: 40 });
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
  const core = panel.locator("span[data-state]").filter({ has: page.locator("[data-spoke]") });
  const still = await core.innerHTML();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(await core.innerHTML()).toBe(still);
  await panel.getByRole("button", { name: "Compact voice companion", exact: true }).click();
  await expect(panel.locator("[data-visual]")).toHaveAttribute("data-animating", "false");
  await panel.getByRole("button", { name: "Expand voice companion", exact: true }).click();
  await page.screenshot({
    path: join(captures, "reduced-motion-dark-800.png"),
    animations: "disabled",
  });
  await panel.press("Escape");
  await expect(panel).toHaveAttribute("data-voice-state", "listening");
  expect(await page.evaluate(() => (window as any).fixtureVoice.closes)).toBe(0);
  await panel.getByRole("button", { name: "Close voice companion", exact: true }).click();
  await expect(page.getByRole("button", { name: "Talk to Arif", exact: true })).toBeFocused();
});

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`voice header coarse targets ${theme} ${width}`, async ({ browser, baseURL }) => {
      const context = await browser.newContext({
        baseURL,
        viewport: { width, height: 900 },
        hasTouch: true,
      });
      const page = await context.newPage();
      await page.goto(`/tests/browser/voice/voice-visual-styles.html?theme=${theme}&global`);
      await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
      const panel = page.locator("section[data-voice-state]");
      const buttons = panel.locator("header button");
      await expect(buttons.first()).toBeVisible();
      const sizes = await buttons.evaluateAll((nodes) =>
        nodes.map((node) => {
          const style = getComputedStyle(node);
          return {
            width: node.getBoundingClientRect().width,
            height: node.getBoundingClientRect().height,
            minWidth: parseFloat(style.minWidth),
            minHeight: parseFloat(style.minHeight),
            target: parseFloat(style.getPropertyValue("--ui-control-height")),
          };
        }),
      );
      for (const size of sizes) {
        expect(size.minWidth).toBeGreaterThanOrEqual(size.target);
        expect(size.minHeight).toBeGreaterThanOrEqual(size.target);
        expect(size.width).toBeGreaterThanOrEqual(size.target);
        expect(size.height).toBeGreaterThanOrEqual(size.target);
      }
      await panel.screenshot({
        path: `temp/verification/feature-controls/voice-touch-${theme}-${width}.png`,
      });
      await panel.getByRole("button", { name: "Compact voice companion" }).click();
      const compactButtons = panel.locator("header button");
      await expect(panel.getByRole("button", { name: "More voice options" })).toBeVisible();
      for (const size of await compactButtons.evaluateAll((nodes) =>
        nodes.map((node) => {
          const style = getComputedStyle(node);
          return {
            width: node.getBoundingClientRect().width,
            height: node.getBoundingClientRect().height,
            target: parseFloat(style.getPropertyValue("--ui-control-height")),
          };
        }),
      )) {
        expect(size.width).toBeGreaterThanOrEqual(size.target);
        expect(size.height).toBeGreaterThanOrEqual(size.target);
      }
      await panel.screenshot({
        path: `temp/verification/feature-controls/voice-touch-compact-${theme}-${width}.png`,
      });
      await context.close();
    });

for (const theme of ["light", "dark"]) {
  for (const width of [800, 1280]) {
    test(`voice transcript and setup surfaces ${theme} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/voice/voice-visual-styles.html?transcript-fixture=1&theme=${theme}&lang=en`,
      );
      const transcript = page.getByRole("list", { name: "Conversation" });
      await expect(transcript.getByText("Please review this draft.")).toBeVisible();
      await expect(transcript.locator('[data-surface-tone="accent"]')).toBeVisible();
      await transcript.screenshot({ path: info.outputPath(`transcript-${theme}-${width}.png`) });
      await page.goto(
        `/tests/browser/voice/voice-visual-styles.html?setup-step=provider&theme=${theme}&lang=en`,
      );
      const details = page.locator(
        '[data-surface-frame="neutral"][data-surface-edge="block-start"]',
      );
      await expect(details).toBeVisible();
      await expect(details).toHaveCSS("border-block-start-width", "1px");
      await details.screenshot({ path: info.outputPath(`setup-${theme}-${width}.png`) });
    });
  }
}

test("voice surface computed probe", async ({ page }) => {
  for (const theme of ["light", "dark"]) {
    await page.goto(
      `/tests/browser/voice/voice-visual-styles.html?transcript-fixture=1&theme=${theme}&lang=en`,
    );
    const bubble = page.locator('[data-role="assistant"] > div');
    const assistant = await bubble.evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.goto(
      `/tests/browser/voice/voice-visual-styles.html?activity-probe=1&theme=${theme}&lang=en`,
    );
    const count = page
      .getByRole("button", { name: /Taking action/ })
      .locator('[data-surface-variant="info-foreground"]');
    const activity = await count.evaluate((el) => getComputedStyle(el).backgroundColor);
    const panel = await open(page, "mark", "listening", theme, 1280);
    const normal = await panel.evaluate((el) => getComputedStyle(el).borderTopColor);
    await panel.evaluate((el) => el.setAttribute("data-surface-frame", "focus"));
    const focus = await panel.evaluate((el) => getComputedStyle(el).borderTopColor);
    await page.evaluate(() => (window as any).fixtureVoice.callbacks.error("fixture error"));
    await expect(panel.locator("[data-voice-error]")).toBeVisible();
    const danger = await panel.evaluate((el) => getComputedStyle(el).borderTopColor);
    console.log(JSON.stringify({ theme, assistant, activity, normal, focus, danger }));
  }
});

test("floating launcher surface computed baseline", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const theme of ["light", "dark"]) {
    await page.goto(`/tests/browser/voice/voice-visual-styles.html?theme=${theme}`);
    const button = page.getByRole("button", { name: "Talk to Arif", exact: true });
    const read = () =>
      button.evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          background: s.backgroundColor,
          border: s.borderTopColor,
          width: s.borderTopWidth,
          rect: el.getBoundingClientRect().toJSON(),
        };
      });
    const rest = await read();
    await button.hover();
    const hover = await read();
    await page.mouse.down();
    const active = await read();
    await page.mouse.up();
    console.log("LAUNCHER_BASELINE", JSON.stringify({ theme, rest, hover, active }));
  }
});

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`floating launcher visual ${theme} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/voice/voice-visual-styles.html?theme=${theme}`);
      const button = page.getByRole("button", { name: "Talk to Arif", exact: true });
      await expect(button).toHaveAttribute("data-surface-variant", "floating");
      await expect(button).toHaveAttribute("data-surface-frame", "neutral");
      await expect(button).toHaveCSS("border-top-width", "1px");
      const box = await button.boundingBox();
      await button.hover();
      expect(await button.boundingBox()).toEqual(box);
      await button.focus();
      await expect(button).toBeFocused();
      await button.screenshot({ path: info.outputPath(`voice-launcher-${theme}-${width}.png`) });
      await button.click();
      await expect(page.locator("section[data-voice-state]")).toBeVisible();
    });
  }

test("voice launcher status dot computed baseline", async ({ page }) => {
  for (const theme of ["light", "dark"]) {
    await page.goto(`/tests/browser/voice/voice-visual-styles.html?theme=${theme}&launcher-dot`);
    const button = page.getByRole("button", { name: "Talk to Arif", exact: true });
    const dot = button.locator('[data-appearance="solid"]');
    const read = () =>
      dot.evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          shadow: s.boxShadow,
          background: s.backgroundColor,
          width: el.getBoundingClientRect().width,
          height: el.getBoundingClientRect().height,
        };
      });
    const rest = await read();
    await button.hover();
    const hover = await read();
    console.log("VOICE_DOT_BASELINE", JSON.stringify({ theme, rest, hover }));
  }
});

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`voice launcher dot ${theme} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/voice/voice-visual-styles.html?theme=${theme}&launcher-dot`);
      const button = page.getByRole("button", { name: "Talk to Arif", exact: true });
      const dot = button.locator('[data-appearance="solid"]');
      await expect(dot).toHaveAttribute("data-halo", "floating");
      await expect(dot).toHaveAttribute("data-tone", "warning");
      await expect(dot).toHaveCSS("width", "6px");
      await expect(dot).toHaveCSS("box-shadow", /2px/);
      await button.hover();
      await expect(dot).toHaveCSS("box-shadow", /2px/);
      await button.screenshot({ path: info.outputPath(`voice-dot-${theme}-${width}.png`) });
    });
  }

test("voice live announcements remain visually hidden", async ({ page }) => {
  await page.goto("/tests/browser/voice/voice-visual-styles.html?theme=light&global");
  await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
  const panel = page.locator("section[data-voice-state]");
  const live = panel.locator(":scope > [role=status]").first();
  await expect(live).toHaveAttribute("role", "status");
  const before = await live.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      position: s.position,
      width: s.width,
      height: s.height,
      overflow: s.overflow,
      margin: s.marginTop,
    };
  });
  expect(before).toEqual({
    position: "absolute",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    margin: "-1px",
  });
});

test("voice working mark computed baseline", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const theme of ["light", "dark"]) {
    await page.goto(`/tests/browser/voice/voice-visual-styles.html?theme=${theme}&working-probe`);
    const mark = page.locator('[data-visual="mark"][data-working="true"] > span').last();
    const values = await mark.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        width: s.width,
        height: s.height,
        radius: s.borderTopLeftRadius,
        background: s.backgroundColor,
        outline: s.outline,
        rotate: s.rotate,
      };
    });
    console.log("WORKING_BASELINE", JSON.stringify({ theme, ...values }));
  }
});

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`voice working diamond ${theme} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/voice/voice-visual-styles.html?theme=${theme}&working-probe`);
      const visual = page.locator('[data-visual="mark"][data-working="true"]');
      const dot = visual.locator("[data-shape=diamond]");
      await expect(dot).toHaveAttribute("data-tone", "warning");
      await expect(dot).toHaveCSS("width", "8px");
      await expect(dot).toHaveCSS("rotate", "45deg");
      await expect(dot).toHaveCSS("outline-width", "2px");
      await visual.screenshot({ path: info.outputPath(`voice-working-${theme}-${width}.png`) });
    });
  }
for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`voice tool activity caller ${theme} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/voice/voice-visual-styles.html?activity-probe=1&theme=${theme}&lang=en`,
      );
      const trigger = page.getByRole("button", { name: /Taking action/ });
      await expect(trigger).toBeVisible();
      await trigger.click();
      const panel = page.getByRole("dialog", { name: "Voice actions" });
      await expect(panel).toContainText("Search");
      await expect(panel.getByRole("button", { name: "Stop waiting" })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`voice-activity-${theme}-${width}.png`) });
    });
