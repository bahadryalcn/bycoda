import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// Fixture evidence: synthetic state through a stubbed IPC. Native placement,
// always-on-top and dragging across applications need the desktop app.
const captures = join(process.cwd(), "temp/verification/voice-overlay");
for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`manual Away keeps explicit Talk closed without certified native presence ${theme} ${width}`, async ({
      page,
    }) => {
      const output = join(process.cwd(), "temp/verification/arif-assistant");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/voice-visual-styles.html?theme=${theme}&availability-away`);
      await page.getByRole("button", { name: "Voice companion", exact: true }).click();
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
      await page.getByRole("button", { name: "Voice companion", exact: true }).click();
      const panel = page.locator("section[data-voice-state]");
      await panel.getByRole("button", { name: "Start voice", exact: true }).click();
      await page.evaluate(() => (window as any).fixtureVoice.speech("Sözümü kesme."));
      await expect(panel.getByText("Rule save is pending. Retry.", { exact: true })).toBeVisible();
      await expect(panel.getByRole("button", { name: "Finish turn", exact: true })).toHaveCount(0);
      await panel.screenshot({ path: join(output, `${theme}-${width}-rule-pending.png`) });
      await panel.getByRole("button", { name: "Retry rule save", exact: true }).click();
      await expect(panel.getByRole("button", { name: "Finish turn", exact: true })).toBeVisible();
      await panel.getByRole("button", { name: "Finish turn", exact: true }).click();
      expect(await page.evaluate(() => (window as any).fixtureVoice.finishes)).toBe(1);
      expect(await page.evaluate(() => (window as any).fixtureVoice.memories)).toMatchObject([
        { kind: "rule", source: "spoken", quote: "Sözümü kesme." },
      ]);
      await panel.screenshot({ path: join(output, `${theme}-${width}-manual-turn.png`) });
      await panel.getByRole("button", { name: "Compact voice companion", exact: true }).click();
      await expect(panel.getByRole("button", { name: "Finish turn", exact: true })).toBeVisible();
      expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await panel.screenshot({ path: join(output, `${theme}-${width}-manual-compact.png`) });
      await page.goto(`/tests/browser/voice-overlay.html?theme=${theme}&manual&compact=0`);
      const overlay = page.locator("main[aria-label]");
      await overlay.getByRole("button", { name: "Finish turn", exact: true }).click();
      const calls = await page.evaluate(() => (window as any).fixtureOverlay.calls);
      expect(calls.some((call: any) => call.args?.payload === "finishTurn")).toBe(true);
      await overlay.screenshot({ path: join(output, `${theme}-${width}-manual-overlay.png`) });
      await page.goto(`/tests/browser/voice-visual-styles.html?theme=${theme}`);
      const manual = page.getByRole("switch", { name: "I decide when my turn ends", exact: true });
      await expect(manual).not.toBeVisible();
      await page.getByRole("button", { name: "Advanced", exact: true }).click();
      await expect(manual).toBeVisible();
      await manual.scrollIntoViewIfNeeded();
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
      await page.getByRole("button", { name: "Voice companion", exact: true }).click();
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
      await expect(panel.getByText("Delete job only: Recovery?", { exact: true })).toBeVisible();
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
      await expect(
        panel.getByText("The selected assistant job was deleted.", { exact: true }),
      ).toBeVisible();
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
      await page.getByRole("button", { name: "Voice companion", exact: true }).click();
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
      await expect(
        panel.getByText("Which project should I follow?", { exact: true }),
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
      await panel
        .getByRole("textbox", { name: "Title", exact: true })
        .last()
        .fill("Reviewed tenth job");
      await panel.getByRole("button", { name: "Start jobs", exact: true }).scrollIntoViewIfNeeded();
      expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await panel.screenshot({ path: join(output, `${theme}-${width}-overlay-ten-jobs.png`) });
      await panel.getByRole("button", { name: "Start jobs", exact: true }).click();
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
      await page.goto(`/tests/browser/voice-visual-styles.html?theme=${theme}&global`);
      await page.getByRole("button", { name: "Voice companion", exact: true }).click();
      const panel = page.locator("section[data-voice-state]");
      await panel.getByRole("button", { name: "Start voice", exact: true }).click();
      await expect(panel).toHaveAttribute("data-voice-state", "listening");
      await page.evaluate(() => (window as any).fixtureVoice.speech("show choices"));
      await expect(
        panel.getByText("Which project should I follow?", { exact: true }),
      ).toBeVisible();
      await panel.screenshot({ path: join(output, `${theme}-${width}-choice.png`) });
      await panel.getByRole("radio", { name: /Clinic/ }).click();
      await panel.getByRole("button", { name: "Send answer", exact: true }).click();
      await expect(
        panel.getByText("Your project choice has been recorded.", { exact: true }),
      ).toBeVisible();
      expect(await page.evaluate(() => (window as any).fixtureVoice.submits)).toBe(0);
      await page.evaluate(() => (window as any).fixtureVoice.speech("give jobs"));
      await expect(panel.getByText("Review jobs before starting", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => (window as any).fixtureVoice.jobs)).toHaveLength(0);
      await panel
        .getByRole("textbox", { name: "Title", exact: true })
        .first()
        .fill("Review recovery carefully");
      await panel.screenshot({ path: join(output, `${theme}-${width}-job-review.png`) });
      await panel.getByRole("button", { name: "Start jobs", exact: true }).click();
      await expect(
        panel.getByText("The reviewed jobs were accepted.", { exact: true }),
      ).toBeVisible();
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
      await page.getByRole("button", { name: "Voice companion", exact: true }).click();
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
