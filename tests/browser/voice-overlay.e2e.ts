import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Locator } from "@playwright/test";

// Fixture evidence: synthetic state through a stubbed IPC. Native placement,
// always-on-top and dragging across applications need the desktop app.
const captures = join(process.cwd(), "temp/verification/voice-overlay");
// Replies are chat bubbles in the companion's "Conversation" list; the newest one is last.
const lastReply = (panel: Locator) =>
  panel
    .getByRole("list", { name: "Conversation", exact: true })
    .getByRole("listitem")
    .filter({ hasText: "Reply:" })
    .last();
for (const theme of ["light", "dark"])
  test(`Turkish compact native turn menu ${theme}`, async ({ page }) => {
    const output = join(process.cwd(), "temp/verification/voice-turn-menu-2026-11-03/captures");
    await mkdir(output, { recursive: true });
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto(`/tests/browser/voice-native-menu.html?theme=${theme}&compact=1&lang=tr`);
    const frame = page.frameLocator('iframe[title="Synthetic native voice window"]'),
      proof = page.locator("[data-native-menu-proof]");
    await expect(page.locator("[data-native-window-size]")).toHaveText("380 × 56 webview");
    const automatic = frame.getByRole("button", { name: "Konuşmayı bitirme", exact: true });
    await expect(automatic).toHaveText("");
    const inside = () =>
      frame.locator("main").evaluate(
        (element) =>
          element.scrollWidth <= window.innerWidth &&
          [...element.querySelectorAll("button")].every((button) => {
            const rect = button.getBoundingClientRect();
            return (
              rect.left >= 0 &&
              rect.right <= window.innerWidth &&
              rect.top >= 0 &&
              rect.bottom <= window.innerHeight
            );
          }),
      );
    expect(await inside()).toBe(true);
    await automatic.click();
    const menu = page.getByRole("menu", { name: "Synthetic turn ending menu", exact: true });
    await expect(
      menu.getByRole("menuitemradio", { name: "Duraklayınca yanıtla", exact: false }),
    ).toBeChecked();
    await expect(
      menu.getByRole("menuitemradio", { name: "Hazır olunca ben bitireceğim", exact: false }),
    ).not.toBeChecked();
    await proof.screenshot({ path: join(output, `${theme}-800-tr-native-auto-menu.png`) });
    await menu
      .getByRole("menuitemradio", { name: "Hazır olunca ben bitireceğim", exact: false })
      .click();
    await expect(automatic).toBeVisible();
    await frame
      .locator("body")
      .evaluate(() => (window as any).fixtureOverlay.emit({ manualTurnEnd: true }));
    const finish = frame.getByRole("button", { name: "Konuşmamı bitir", exact: true });
    await expect(finish).toHaveText("");
    expect(await inside()).toBe(true);
    await frame.getByRole("button", { name: "Konuşmayı bitirme", exact: true }).click();
    await expect(
      menu.getByRole("menuitemradio", { name: "Hazır olunca ben bitireceğim", exact: false }),
    ).toBeChecked();
    await expect(
      menu.getByRole("menuitemradio", { name: "Duraklayınca yanıtla", exact: false }),
    ).not.toBeChecked();
    await proof.screenshot({ path: join(output, `${theme}-800-tr-native-manual-menu.png`) });
    const finishes = () =>
      frame
        .locator("body")
        .evaluate(
          () =>
            (window as any).fixtureOverlay.calls.filter(
              (call: any) => call.args?.payload === "finishTurn",
            ).length,
        );
    expect(await finishes()).toBe(0);
    await page.getByRole("button", { name: "Dismiss synthetic menu", exact: true }).click();
    await finish.click();
    await expect.poll(finishes).toBe(1);
    await proof.screenshot({ path: join(output, `${theme}-800-tr-native-finish.png`) });
  });
for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`native turn menu outside bounded webview ${theme} ${width}`, async ({ page }) => {
      const output = join(process.cwd(), "temp/verification/voice-turn-menu-2026-11-03/captures");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/voice-visual-styles.html?theme=${theme}&global`);
      await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
      const panel = page.locator("section[data-voice-state]");
      await panel.getByRole("button", { name: "Start voice", exact: true }).click();
      await panel.getByRole("button", { name: "Reply when I pause", exact: true }).click();
      await expect(
        page.getByRole("menuitemradio", { name: "Reply when I pause", exact: true }),
      ).toBeChecked();
      await expect(
        page.getByRole("menuitemradio", { name: "I'll finish when ready", exact: true }),
      ).not.toBeChecked();
      expect(await page.evaluate(() => (window as any).fixtureVoice.finishes)).toBe(0);
      await page.screenshot({
        path: join(output, `${theme}-${width}-in-app-auto-menu.png`),
        animations: "disabled",
      });
      await page
        .getByRole("menuitemradio", { name: "I'll finish when ready", exact: true })
        .click();
      await expect(panel.getByRole("button", { name: "Finish turn", exact: true })).toBeVisible();
      expect(await page.evaluate(() => (window as any).fixtureVoice.finishes)).toBe(0);
      await page.goto(`/tests/browser/voice-native-menu.html?theme=${theme}&compact=1`);
      const frame = page.frameLocator('iframe[title="Synthetic native voice window"]');
      const proof = page.locator("[data-native-menu-proof]");
      const commands = () =>
        frame
          .locator("body")
          .evaluate(() =>
            (window as any).fixtureOverlay.calls
              .filter((call: any) => call.cmd === "plugin:event|emit_to")
              .map((call: any) => call.args.payload),
          );
      await expect(page.locator("[data-native-window-size]")).toHaveText("380 × 56 webview");
      await frame.getByRole("button", { name: "Turn ending", exact: true }).click();
      const menu = page.getByRole("menu", { name: "Synthetic turn ending menu", exact: true });
      await expect(
        menu.getByRole("menuitemradio", { name: "Reply when I pause", exact: false }),
      ).toBeChecked();
      await expect(
        menu.getByRole("menuitemradio", { name: "I'll finish when ready", exact: false }),
      ).not.toBeChecked();
      await expect(frame.getByRole("menu")).toHaveCount(0);
      expect(
        (await commands()).filter((command: string) =>
          ["finishTurn", "manualTurnEnd", "automaticTurnEnd"].includes(command),
        ),
      ).toEqual([]);
      await proof.screenshot({
        path: join(output, `${theme}-${width}-native-compact-auto-menu.png`),
      });
      await page.getByRole("button", { name: "Dismiss synthetic menu", exact: true }).click();
      await expect(menu).toHaveCount(0);
      expect(
        (await commands()).filter((command: string) =>
          ["finishTurn", "manualTurnEnd", "automaticTurnEnd"].includes(command),
        ),
      ).toEqual([]);
      await frame.getByRole("button", { name: "Turn ending", exact: true }).click();
      await menu
        .getByRole("menuitemradio", { name: "I'll finish when ready", exact: false })
        .click();
      await expect
        .poll(
          async () =>
            (await commands()).filter((command: string) => command === "manualTurnEnd").length,
        )
        .toBe(1);
      await expect(frame.getByRole("button", { name: "Turn ending", exact: true })).toBeVisible(); // no optimistic owner ACK
      await frame
        .locator("body")
        .evaluate(() => (window as any).fixtureOverlay.emit({ manualTurnEnd: true }));
      await frame.getByRole("button", { name: "Turn ending", exact: true }).click();
      await expect(
        menu.getByRole("menuitemradio", { name: "I'll finish when ready", exact: false }),
      ).toBeChecked();
      await expect(
        menu.getByRole("menuitemradio", { name: "Reply when I pause", exact: false }),
      ).not.toBeChecked();
      await proof.screenshot({
        path: join(output, `${theme}-${width}-native-compact-manual-menu.png`),
      });
      await page.getByRole("button", { name: "Dismiss synthetic menu", exact: true }).click();
      expect((await commands()).filter((command: string) => command === "finishTurn")).toHaveLength(
        0,
      );
      await frame.getByRole("button", { name: "Finish turn", exact: true }).click();
      await expect
        .poll(
          async () =>
            (await commands()).filter((command: string) => command === "finishTurn").length,
        )
        .toBe(1);
      await frame.getByRole("button", { name: "Expand voice companion", exact: true }).click();
      await expect(frame.locator("main")).not.toHaveAttribute("data-compact");
      // Expanded, the turn mode button is named after the current mode.
      await frame.getByRole("button", { name: "I'll finish when ready", exact: true }).click();
      await expect(
        menu.getByRole("menuitemradio", { name: "I'll finish when ready", exact: false }),
      ).toBeChecked();
      await proof.screenshot({
        path: join(output, `${theme}-${width}-native-expanded-manual-menu.png`),
      });
      await menu.getByRole("menuitemradio", { name: "Reply when I pause", exact: false }).click();
      await expect
        .poll(
          async () =>
            (await commands()).filter((command: string) => command === "automaticTurnEnd").length,
        )
        .toBe(1);
      await expect(frame.getByRole("button", { name: "Finish turn", exact: true })).toBeVisible();
      await frame
        .locator("body")
        .evaluate(() => (window as any).fixtureOverlay.emit({ manualTurnEnd: false }));
      await frame.getByRole("button", { name: "Reply when I pause", exact: true }).click();
      await expect(
        menu.getByRole("menuitemradio", { name: "Reply when I pause", exact: false }),
      ).toBeChecked();
      await proof.screenshot({
        path: join(output, `${theme}-${width}-native-expanded-auto-menu.png`),
      });
      await page.goto(
        `/tests/browser/voice-native-menu.html?theme=${theme}&compact=1&native-menu-fail`,
      );
      await frame.getByRole("button", { name: "Turn ending", exact: true }).click();
      await expect(
        frame.getByText("The turn mode menu could not be opened. Try again.", { exact: true }),
      ).toBeVisible();
      expect(
        await frame
          .locator("body")
          .evaluate(() => JSON.parse(localStorage.getItem("bycoda.voice")!).compact),
      ).toBe(true);
      await expect(frame.locator("main")).not.toHaveAttribute("data-compact");
      await expect(frame.locator("main")).toHaveAttribute("data-voice-state", "assistant");
      expect(
        (await commands()).filter((command: string) =>
          ["finishTurn", "manualTurnEnd", "automaticTurnEnd"].includes(command),
        ),
      ).toEqual([]);
      await proof.screenshot({ path: join(output, `${theme}-${width}-native-failure.png`) });
      await frame.getByRole("button", { name: "Dismiss", exact: true }).click();
      await expect(page.locator("[data-native-window-size]")).toHaveText("380 × 56 webview");
      await frame.getByRole("button", { name: "Turn ending", exact: true }).click();
      await expect(
        menu.getByRole("menuitemradio", { name: "Reply when I pause", exact: false }),
      ).toBeChecked();
      await proof.screenshot({ path: join(output, `${theme}-${width}-native-retry-menu.png`) });
      await menu
        .getByRole("menuitemradio", { name: "I'll finish when ready", exact: false })
        .click();
      await expect
        .poll(
          async () =>
            (await commands()).filter((command: string) => command === "manualTurnEnd").length,
        )
        .toBe(1);
      await expect(frame.getByRole("button", { name: "Turn ending", exact: true })).toBeVisible();
      await frame
        .locator("body")
        .evaluate(() => (window as any).fixtureOverlay.emit({ manualTurnEnd: true }));
      await expect(frame.getByRole("button", { name: "Finish turn", exact: true })).toBeVisible();
    });
for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`voice navigation and recovery controls ${theme} ${width}`, async ({ page }) => {
      const output = join(process.cwd(), "temp/verification/voice-turn-menu-2026-11-03/continuity");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/voice-visual-styles.html?theme=${theme}&navigation&fresh-scope`,
      );
      await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
      const panel = page.locator("section[data-voice-state]");
      await expect(panel.getByRole("radio", { name: "Global", exact: true })).toBeChecked();
      await expect(panel.getByRole("radio", { name: "Project", exact: true })).toBeVisible();
      await panel.screenshot({ path: join(output, `${theme}-${width}-ready.png`) });
      await panel.getByRole("button", { name: "Start voice", exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as any).fixtureVoice.connects)).toBe(1);
      await page.evaluate(() =>
        (window as any).fixtureVoice.speech("Keep my full request together."),
      );
      await expect(panel.locator("div:has(> .sr-only)").filter({ hasText: "You:" })).toContainText(
        "Keep my full request together.",
      );
      await expect(
        panel.locator("div:has(> .sr-only)").filter({ hasText: "Reply:" }),
      ).toBeVisible();
      await panel.screenshot({ path: join(output, `${theme}-${width}-listening.png`) });
      const controls = ["Pause mic", "Silence", "Disconnect voice"];
      // The controls share one row once the listening layout has settled.
      await expect
        .poll(async () => {
          const boxes = await Promise.all(
            controls.map((name) => panel.getByRole("button", { name, exact: true }).boundingBox()),
          );
          const tops = boxes.map((box) => box!.y);
          return Math.max(...tops) - Math.min(...tops);
        })
        .toBeLessThanOrEqual(1);
      await panel.getByRole("radio", { name: "Project", exact: true }).click();
      await expect(panel.getByRole("button", { name: /^Voice session/ })).toBeVisible();
      await panel.screenshot({ path: join(output, `${theme}-${width}-project.png`) });
      await page.evaluate(() => {
        const fixture = (window as any).fixtureVoice;
        (window as any).heldVoiceOnset = fixture.callbacks.start();
      });
      await page.getByRole("button", { name: "Switch fixture project", exact: true }).click();
      await page.evaluate(() => {
        const fixture = (window as any).fixtureVoice;
        const binding = fixture.callbacks.accept((window as any).heldVoiceOnset);
        fixture.callbacks.transcript({ text: "Finish the original project request." }, binding);
      });
      // The transcript keeps every turn; the newest owner bubble holds the held request.
      await expect(
        panel.locator("div:has(> .sr-only)").filter({ hasText: "You:" }).last(),
      ).toContainText("Finish the original project request.");
      expect(await page.evaluate(() => (window as any).fixtureVoice.connects)).toBe(1);
      expect(await page.evaluate(() => (window as any).fixtureVoice.closes)).toBe(0);
      await panel.getByRole("button", { name: "Reply when I pause", exact: true }).click();
      await page
        .getByRole("menuitemradio", { name: "I'll finish when ready", exact: true })
        .click();
      await expect(panel.getByRole("button", { name: "Finish turn", exact: true })).toBeVisible();
      await panel.screenshot({ path: join(output, `${theme}-${width}-manual.png`) });
      await panel.getByRole("button", { name: "Compact voice companion", exact: true }).click();
      await panel.screenshot({ path: join(output, `${theme}-${width}-compact.png`) });
      await panel.getByRole("button", { name: "Expand voice companion", exact: true }).click();
      await page.evaluate(() =>
        (window as any).fixtureVoice.callbacks.error(
          "Voice input cleanup was not confirmed. Start voice again.",
          true,
        ),
      );
      const attention = panel.getByRole("button", { name: "Voice needs attention", exact: true });
      await expect(attention).toHaveAttribute("aria-expanded", "false");
      await expect(panel.getByRole("button", { name: "Start voice", exact: true })).toBeVisible();
      await panel.screenshot({ path: join(output, `${theme}-${width}-attention.png`) });
      await attention.click();
      const errorDetails = page.getByRole("dialog", { name: "Voice needs attention", exact: true });
      await expect(
        errorDetails.getByText("Voice input cleanup was not confirmed. Start voice again.", {
          exact: true,
        }),
      ).toBeVisible();
      await page.screenshot({ path: join(output, `${theme}-${width}-error-details.png`) });
      await page.keyboard.press("Escape");
      await expect(errorDetails).toHaveCount(0);
      await expect(attention).toBeFocused();
      await panel.getByRole("button", { name: "Start voice", exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as any).fixtureVoice.connects)).toBe(2);
      expect(await page.evaluate(() => (window as any).fixtureVoice.closes)).toBe(1);
      await page.goto(`/tests/browser/voice-overlay.html?theme=${theme}&compact=0&manual`);
      const mirror = page.locator("main[data-voice-state]");
      await expect(mirror.getByRole("button", { name: "Finish turn", exact: true })).toBeVisible();
      await mirror.screenshot({ path: join(output, `${theme}-${width}-floating-listening.png`) });
      await mirror.getByRole("button", { name: "Compact voice companion", exact: true }).click();
      // The fake native IPC records the real component's requested window size;
      // apply that size to this synthetic native document before inspecting 100vh.
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
      const compactSize = await page.evaluate(
        () =>
          (window as any).fixtureOverlay.calls
            .filter((call: any) => call.cmd === "voice_overlay_fit")
            .at(-1).args,
      );
      await page.setViewportSize({ width: compactSize.width, height: compactSize.height });
      await mirror.screenshot({ path: join(output, `${theme}-${width}-floating-compact.png`) });
      await mirror.getByRole("button", { name: "Expand voice companion", exact: true }).click();
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() =>
        (window as any).fixtureOverlay.emit({
          status: "idle",
          statusText: "Ready to connect",
          visualState: "off",
          error: "Voice input cleanup was not confirmed. Start voice again.",
        }),
      );
      await expect(mirror.getByRole("button", { name: "Start voice", exact: true })).toBeVisible();
      await mirror.screenshot({ path: join(output, `${theme}-${width}-floating-attention.png`) });
      await mirror.locator('summary:has-text("Error details")').click();
      await expect(
        mirror.getByText("Voice input cleanup was not confirmed. Start voice again.", {
          exact: true,
        }),
      ).toBeVisible();
      await mirror.screenshot({ path: join(output, `${theme}-${width}-floating-details.png`) });
      expect(await mirror.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
    });
for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`manual Away keeps explicit Talk closed without certified native presence ${theme} ${width}`, async ({
      page,
    }) => {
      const output = join(process.cwd(), "temp/verification/arif-assistant");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/voice-visual-styles.html?theme=${theme}&availability-away`);
      await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
      const panel = page.locator("section[data-voice-state]");
      await panel.getByRole("button", { name: "Start voice", exact: true }).click();
      await expect(
        panel.getByText(
          "Current computer presence could not be verified. Mark yourself here before talking.",
          { exact: true },
        ),
      ).toBeVisible();
      expect(await page.evaluate(() => (window as any).fixtureVoice.connects)).toBe(0);
      await panel.screenshot({
        path: join(output, `${theme}-${width}-voice-presence-unverified.png`),
        animations: "disabled",
      });
    });
for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`owner correction and manual turn require real controls ${theme} ${width}`, async ({
      page,
    }) => {
      const output = join(process.cwd(), "temp/verification/arif-assistant");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/voice-visual-styles.html?theme=${theme}&rule-ack-lost`);
      await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
      const panel = page.locator("section[data-voice-state]");
      await panel.getByRole("button", { name: "Start voice", exact: true }).click();
      await page.evaluate(() => (window as any).fixtureVoice.speech("Sözümü kesme."));
      await expect(panel.getByText("Rule save is pending. Retry.", { exact: true })).toBeVisible();
      await expect(panel.getByRole("button", { name: "Finish turn", exact: true })).toHaveCount(0);
      await panel.screenshot({ path: join(output, `${theme}-${width}-rule-pending.png`) });
      await panel.getByRole("button", { name: "Retry rule save", exact: true }).click();
      await expect(lastReply(panel)).toContainText("Your rule was saved.");
      // Saving a no-interruption rule must not change how the owner ends a turn.
      await expect(panel.getByRole("button", { name: "Finish turn", exact: true })).toHaveCount(0);
      await panel.getByRole("button", { name: "Reply when I pause", exact: true }).click();
      await page
        .getByRole("menuitemradio", { name: "I'll finish when ready", exact: true })
        .click();
      await expect(panel.getByRole("button", { name: "Finish turn", exact: true })).toBeVisible();
      await panel.getByRole("button", { name: "Finish turn", exact: true }).click();
      expect(await page.evaluate(() => (window as any).fixtureVoice.finishes)).toBe(1);
      expect(await page.evaluate(() => (window as any).fixtureVoice.memories)).toMatchObject([
        { kind: "rule", source: "spoken", quote: "Sözümü kesme." },
      ]);
      await panel.screenshot({ path: join(output, `${theme}-${width}-manual-turn.png`) });
      await panel.getByRole("button", { name: "Compact voice companion", exact: true }).click();
      // The compact pill keeps Finish turn in its More menu.
      await panel.getByRole("button", { name: "More voice options", exact: true }).click();
      await expect(page.getByRole("menuitem", { name: "Finish turn", exact: true })).toBeEnabled();
      await page.keyboard.press("Escape");
      expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await panel.screenshot({ path: join(output, `${theme}-${width}-manual-compact.png`) });
      await page.goto(`/tests/browser/voice-overlay.html?theme=${theme}&manual&compact=0`);
      const overlay = page.locator("main[aria-label]");
      await overlay.getByRole("button", { name: "Finish turn", exact: true }).click();
      const calls = await page.evaluate(() => (window as any).fixtureOverlay.calls);
      expect(calls.some((call: any) => call.args?.payload === "finishTurn")).toBe(true);
      await overlay.screenshot({ path: join(output, `${theme}-${width}-manual-overlay.png`) });
      await page.goto(`/tests/browser/voice-visual-styles.html?theme=${theme}`);
      // The conversation style group shows this switch directly, without an Advanced disclosure.
      const manual = page.getByRole("switch", { name: "I decide when my turn ends", exact: true });
      await manual.scrollIntoViewIfNeeded();
      await expect(manual).toBeVisible();
      await manual.uncheck();
      await expect(manual).not.toBeChecked();
      await manual.check();
      await expect(manual).toBeChecked();
      await page.screenshot({ path: join(output, `${theme}-${width}-manual-settings.png`) });
      expect(await page.evaluate(() => (window as any).fixtureVoice.connects)).toBe(0);
    });
for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`voice job deletion waits for exact owner confirmation ${theme} ${width}`, async ({
      page,
    }) => {
      const output = join(process.cwd(), "temp/verification/arif-assistant");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/voice-visual-styles.html?theme=${theme}&global&control`);
      await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
      const panel = page.locator("section[data-voice-state]");
      const sourceGuard = await page.evaluate(async () => {
        const fixture = (window as any).fixtureVoice;
        const owner = await fixture.captureHostRead("fixture-host");
        let rejected = false;
        try {
          await fixture.captureHostRead("different-host");
        } catch {
          rejected = true;
        }
        return { environmentId: owner.environmentId, frozen: Object.isFrozen(owner), rejected };
      });
      expect(sourceGuard).toEqual({ environmentId: "fixture-host", frozen: true, rejected: true });
      await panel.getByRole("button", { name: "Start voice", exact: true }).click();
      await page.evaluate(() => (window as any).fixtureVoice.speech("delete recovery job"));
      // The question shows beside its icon (aria-hidden) and names the answer group.
      await expect(
        panel.getByRole("group", { name: "Delete job only: Recovery?", exact: true }),
      ).toBeVisible();
      await expect(panel.getByText("Project: Fixture project", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => (window as any).fixtureVoice.actions)).not.toContain(
        "assistant.delete",
      );
      expect(
        await page.evaluate(() =>
          (window as any).fixtureVoice.ownerRequests.filter(
            (call: any) => call.input.op === "jobs.control",
          ),
        ),
      ).toHaveLength(0);
      await panel.screenshot({ path: join(output, `${theme}-${width}-voice-job-delete.png`) });
      await panel.getByRole("radio", { name: "Delete job only", exact: true }).click();
      await panel.getByRole("button", { name: "Send answer", exact: true }).click();
      await expect(lastReply(panel)).toContainText("The selected assistant job was deleted.");
      expect(await page.evaluate(() => (window as any).fixtureVoice.actions)).toContain(
        "assistant.delete",
      );
      expect(
        await page.evaluate(() =>
          (window as any).fixtureVoice.ownerRequests.filter(
            (call: any) => call.input.op === "jobs.control",
          ),
        ),
      ).toEqual([
        {
          input: { op: "jobs.control", id: "control-job", expectedVersion: 1, action: "delete" },
          expectedEnvironmentId: "fixture-host",
        },
      ]);
    });
for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`remote voice history retains exact writes through lost acknowledgement ${theme} ${width}`, async ({
      page,
    }) => {
      const output = join(process.cwd(), "temp/verification/arif-assistant");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/voice-visual-styles.html?theme=${theme}&remote`);
      await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
      const panel = page.locator("section[data-voice-state]");
      await panel.getByRole("button", { name: "Start voice", exact: true }).click();
      await expect(panel).toHaveAttribute("data-voice-state", "listening");
      await expect(
        panel.getByText("Conversation was not saved. Retry.", { exact: true }),
      ).toHaveCount(0);
      await panel.screenshot({ path: join(output, `${theme}-${width}-remote-history.png`) });
      await page.evaluate(() => {
        (window as any).fixtureVoice.remoteAckLost = true;
        (window as any).fixtureVoice.speech("Read remote status");
      });
      await expect(
        panel.getByText("Conversation was not saved. Retry.", { exact: true }),
      ).toBeVisible();
      await panel.screenshot({ path: join(output, `${theme}-${width}-remote-pending.png`) });
      await panel.getByRole("button", { name: "Save conversation", exact: true }).click();
      await expect(
        panel.getByText("Conversation was not saved. Retry.", { exact: true }),
      ).toHaveCount(0);
      const result = await page.evaluate(() => ({
        attempts: (window as any).fixtureVoice.remoteAttempts,
        saved: (window as any).fixtureVoice.remoteTranscripts,
        local: (window as any).fixtureVoice.transcripts,
      }));
      expect(result.local).toEqual([]);
      expect(result.saved.map((entry: any) => entry.role)).toEqual(["user", "assistant"]);
      expect(result.attempts[1]).toEqual(result.attempts[0]);
      expect(
        result.saved.every(
          (entry: any) =>
            entry.threadId === "remote-fixture-thread" &&
            entry.sessionId === "remote-fixture-session",
        ),
      ).toBe(true);
      await panel.screenshot({ path: join(output, `${theme}-${width}-remote-recovered.png`) });
      await page.evaluate(() => ((window as any).fixtureVoice.remoteAvailable = false));
      await page.evaluate(() => (window as any).fixtureVoice.speech("Keep the next remote turn"));
      await expect(
        panel.getByText("Conversation was not saved. Retry.", { exact: true }),
      ).toBeVisible();
      await panel.screenshot({ path: join(output, `${theme}-${width}-remote-offline.png`) });
    });
for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`floating choice replies stay in the owner: ${theme} ${width}`, async ({ page }) => {
      const output = join(process.cwd(), "temp/verification/arif-assistant");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/voice-overlay.html?theme=${theme}&compact=0&choice`);
      const panel = page.locator("main[aria-label]");
      // The question shows beside its icon (aria-hidden) and names the answer group.
      await expect(
        panel.getByRole("group", { name: "Which project should I follow?", exact: true }),
      ).toBeVisible();
      await panel.screenshot({ path: join(output, `${theme}-${width}-overlay-choice.png`) });
      await panel.getByRole("radio", { name: "Clinic", exact: true }).click();
      await panel.getByRole("button", { name: "Send answer", exact: true }).click();
      const reply = await page.evaluate(
        () =>
          (window as any).fixtureOverlay.calls.find(
            (call: any) =>
              call.cmd === "plugin:event|emit_to" && call.args.event === "voice_overlay_choice",
          )?.args,
      );
      expect(reply).toMatchObject({
        target: { kind: "AnyLabel", label: "main" },
        payload: { reply: { kind: "answered", answers: { choice: ["clinic"] } } },
      });
      await page.evaluate(() =>
        (window as any).fixtureOverlay.emit({
          choice: null,
          jobReview: {
            id: "ten-jobs",
            jobs: Array.from({ length: 10 }, (_, index) => ({
              id: String(index),
              idempotencyKey: `key-${index}`,
              title: `Job ${index + 1}`,
              request: "Review the requested change and retain its recovery path.",
              projectId: "project-a",
            })),
            projects: [{ id: "project-a", path: "/fixture", name: "Fixture project" }],
            busy: false,
            error: "",
            accepted: [],
          },
        }),
      );
      // Job review opens as a dialog above the floating window, not inside its panel.
      const review = page.getByRole("dialog", { name: "Review jobs before starting", exact: true });
      await review
        .getByRole("textbox", { name: "Title", exact: true })
        .last()
        .fill("Reviewed tenth job");
      await review
        .getByRole("button", { name: "Start jobs", exact: true })
        .scrollIntoViewIfNeeded();
      expect(await review.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await page.screenshot({ path: join(output, `${theme}-${width}-overlay-ten-jobs.png`) });
      await review.getByRole("button", { name: "Start jobs", exact: true }).click();
      const jobs = await page.evaluate(
        () =>
          (window as any).fixtureOverlay.calls.find(
            (call: any) =>
              call.cmd === "plugin:event|emit_to" &&
              call.args.event === "voice_overlay_job_review" &&
              call.args.payload.action === "start",
          )?.args.payload.rows,
      );
      expect(jobs).toHaveLength(10);
      expect(jobs[9].title).toBe("Reviewed tenth job");
    });

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`voice choice and setup controls: ${theme} ${width}`, async ({ page }) => {
      const output = join(process.cwd(), "temp/verification/arif-assistant");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      // Job review is opt-in (profile confirmJobs); this scenario asks for it.
      await page.goto(`/tests/browser/voice-visual-styles.html?theme=${theme}&global&confirm-jobs`);
      await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
      const panel = page.locator("section[data-voice-state]");
      await panel.getByRole("button", { name: "Start voice", exact: true }).click();
      await expect(panel).toHaveAttribute("data-voice-state", "listening");
      await page.evaluate(() => (window as any).fixtureVoice.speech("show choices"));
      // The question shows beside its icon (aria-hidden) and names the answer group.
      await expect(
        panel.getByRole("group", { name: "Which project should I follow?", exact: true }),
      ).toBeVisible();
      await panel.screenshot({ path: join(output, `${theme}-${width}-choice.png`) });
      await panel.getByRole("radio", { name: /Clinic/ }).click();
      await panel.getByRole("button", { name: "Send answer", exact: true }).click();
      await expect(lastReply(panel)).toContainText("Your project choice has been recorded.");
      expect(await page.evaluate(() => (window as any).fixtureVoice.submits)).toBe(0);
      await page.evaluate(() => (window as any).fixtureVoice.speech("give jobs"));
      // The review is a dialog outside the companion panel.
      const review = page.getByRole("dialog", { name: "Review jobs before starting", exact: true });
      await expect(review).toBeVisible();
      expect(await page.evaluate(() => (window as any).fixtureVoice.jobs)).toHaveLength(0);
      await review
        .getByRole("textbox", { name: "Title", exact: true })
        .first()
        .fill("Review recovery carefully");
      await page.screenshot({ path: join(output, `${theme}-${width}-job-review.png`) });
      await review.getByRole("button", { name: "Start jobs", exact: true }).click();
      await expect(lastReply(panel)).toContainText("The reviewed jobs were accepted.");
      expect(await page.evaluate(() => (window as any).fixtureVoice.jobs)).toMatchObject([
        { title: "Review recovery carefully" },
        { title: "Improve the help page" },
      ]);
      for (const step of ["provider", "voice", "microphone"]) {
        await page.goto(
          `/tests/browser/voice-visual-styles.html?theme=${theme}&setup-step=${step}`,
        );
        await expect(page.getByRole("heading", { name: `Assistant Arif · ${step}` })).toBeVisible();
        await page.screenshot({ path: join(output, `${theme}-${width}-setup-${step}.png`) });
      }
    });

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`voice sleeps and returns with microphone closed: ${theme} ${width}`, async ({ page }) => {
      const output = join(process.cwd(), "temp/verification/arif-assistant");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/voice-visual-styles.html?theme=${theme}`);
      await page.clock.install();
      await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
      const panel = page.locator("section[data-voice-state]");
      await panel.getByRole("button", { name: "Start voice", exact: true }).click();
      await expect(panel).toHaveAttribute("data-voice-state", "listening");
      await panel.press("Escape");
      await expect(panel).toHaveAttribute("data-voice-state", "listening");
      await page.clock.fastForward(610_000);
      await expect(panel.getByText("Asleep", { exact: true })).toBeVisible();
      const counts = await page.evaluate(() => ({
        connects: (window as any).fixtureVoice.connects,
        closes: (window as any).fixtureVoice.closes,
      }));
      expect(counts.closes).toBeGreaterThan(0);
      await panel.screenshot({ path: join(output, `${theme}-${width}-asleep.png`) });
      await page.mouse.move(3, 3);
      await expect(panel.getByText("Ready. Microphone is off.", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => (window as any).fixtureVoice.connects)).toBe(
        counts.connects,
      );
      await panel.screenshot({ path: join(output, `${theme}-${width}-ready.png`) });
      await panel.getByRole("button", { name: "Talk", exact: true }).click();
      await expect(panel).toHaveAttribute("data-voice-state", "listening");
    });

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
      await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
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
