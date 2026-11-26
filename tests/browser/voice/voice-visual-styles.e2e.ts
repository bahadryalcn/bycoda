import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
const captures = join(process.cwd(), "temp/verification/voice-visual-styles");
const workViewports = [
  ["dark", 1280],
  ["light", 800],
  ["light", 1280],
  ["dark", 800],
] as const;

test("presented session form creates the edited draft in the selected project", async ({
  page,
}) => {
  await page.goto("/tests/browser/voice/voice-visual-styles.html?navigation&session-form");
  await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
  await page.getByRole("button", { name: "Start voice", exact: true }).click();
  await page.evaluate(() =>
    (window as Window & { fixtureVoice?: FixtureVoice }).fixtureVoice!.speech(
      "prepare project session",
    ),
  );
  const results = page.getByRole("region", { name: "Live results" });
  await results.getByRole("button", { name: /Destination/ }).click();
  await page.getByRole("option", { name: "Bycoda" }).click();
  const draft = results.getByLabel("Draft text");
  await draft.fill("Initial text");
  await draft.fill("Son düzenlenen taslak.");
  await results.getByRole("button", { name: "Create session" }).click();
  const workspace = page.locator("output[data-fixture-project='/fixture-next']");
  await expect(workspace).toHaveAttribute("data-fixture-selected-tab", /.+/);
  await expect(workspace.locator("[data-fixture-session]")).toHaveText("Son düzenlenen taslak.");
});
type FixtureVoice = typeof import("./voice-visual-styles-mocks").fixtureVoice;

test("voice opens the explicitly requested project in the real session drawer", async ({
  page,
}) => {
  test.setTimeout(30000);
  await page.goto("/tests/browser/voice/voice-visual-styles.html?navigation&session-outlet");
  const second = page.locator('[data-session-drop="fixture-next"]');
  const initial = await second.elementHandle();
  const draft = second.locator("[data-composer-box] textarea");
  await draft.fill("Keep my draft in the second project.");
  await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
  const panel = page.locator("section[data-voice-state]");
  await panel.getByRole("button", { name: "Start voice", exact: true }).click();
  await page.evaluate(() => {
    (window as Window & { fixtureVoice?: FixtureVoice }).fixtureVoice!.speech(
      "Open the second project's session beside Arif.",
    );
  });
  await expect(panel.locator('[data-session-drop="fixture-next"]')).toBeVisible();
  await expect(panel.locator('[data-session-drop="fixture"]')).toHaveCount(0);
  expect(await initial?.evaluate((element) => Boolean(element.closest("[data-work-panel]")))).toBe(
    true,
  );
  await expect(draft).toHaveValue("Keep my draft in the second project.");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { fixtureVoice?: FixtureVoice }).fixtureVoice!.observations[0],
      ),
    )
    .toMatchObject({
      status: "completed",
      projectPath: "/fixture-next",
      sessionId: "fixture-next",
    });
  await panel.getByRole("button", { name: "Sessions", exact: true }).click();
  await expect(panel.locator('[data-session-drop="fixture-next"]')).toHaveCount(0);
  await expect(draft).toHaveValue("Keep my draft in the second project.");
  expect(await initial?.evaluate((element) => element.isConnected)).toBe(true);
  await panel.getByRole("button", { name: "Sessions", exact: true }).click();
  await expect(panel.locator('[data-session-drop="fixture-next"]')).toBeVisible();
  await expect(draft).toHaveValue("Keep my draft in the second project.");
  await page.evaluate(() => {
    (window as Window & { fixtureVoice?: FixtureVoice }).fixtureVoice!.speech(
      "Open the second project's session in the project workspace.",
    );
  });
  await expect(panel).not.toHaveAttribute("data-full-screen");
  await expect(panel.locator('[data-session-drop="fixture-next"]')).toHaveCount(0);
  await expect(second).toBeVisible();
  await expect(draft).toHaveValue("Keep my draft in the second project.");
  expect(await initial?.evaluate((element) => element.isConnected)).toBe(true);
});

for (const [theme, width] of workViewports) {
  test(`voice Usage tool draws provider and model totals ${theme} ${width}`, async ({ page }) => {
    const directory = join(process.cwd(), "temp/verification/arif-voice-routing/usage");
    await mkdir(directory, { recursive: true });
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/voice/voice-visual-styles.html?global&usage&theme=${theme}`);
    await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
    const panel = page.locator("section[data-voice-state]");
    await panel.getByRole("button", { name: "Full screen", exact: true }).click();
    await panel.getByRole("button", { name: "Start voice", exact: true }).click();
    const drawer = panel.getByRole("region", { name: "Live results", exact: true });
    const speech = (line: string) =>
      page.evaluate((text) => {
        (window as Window & { fixtureVoice?: FixtureVoice }).fixtureVoice!.speech(text);
      }, line);
    await speech("Show this month's usage.");
    await expect(drawer.getByRole("heading", { name: "Usage · This month" })).toBeVisible();
    await expect(drawer.getByText("$10.00", { exact: true })).toBeVisible();
    await expect(drawer.getByText("800", { exact: true })).toBeVisible();
    for (const [name, rows] of [
      [
        "Providers",
        [
          ["Codex", "$7.50"],
          ["Claude", "$2.50"],
        ],
      ],
      [
        "Models",
        [
          ["GPT Fixture", "$7.50"],
          ["Sonnet Fixture", "$2.50"],
        ],
      ],
    ] as const) {
      const figure = drawer.locator("figure").filter({ hasText: name });
      await expect(figure).toBeVisible();
      for (const [label, value] of rows) {
        const row = figure.getByRole("row", { name: new RegExp(label), includeHidden: true });
        await expect(row.getByText(value, { exact: true })).toHaveCount(1);
      }
    }
    await expect
      .poll(() =>
        page.evaluate(() => {
          const fixture = (window as Window & { fixtureVoice?: FixtureVoice }).fixtureVoice!;
          return { reads: fixture.actions, submits: fixture.submits, jobs: fixture.jobs.length };
        }),
      )
      .toEqual({ reads: ["usage:month-to-date:cost"], submits: 0, jobs: 0 });
    await panel.screenshot({ path: join(directory, `${theme}-${width}-report.png`) });
    const models = drawer.locator("figure").filter({ hasText: "Models" });
    await models.scrollIntoViewIfNeeded();
    await expect(models.getByText("GPT Fixture", { exact: true }).first()).toBeInViewport();
    if (width === 800)
      await panel.screenshot({ path: join(directory, `${theme}-${width}-models.png`) });
    await speech("Show the last 30 days of usage.");
    await expect(drawer.getByRole("heading", { name: "Usage · Last 30 days" })).toBeVisible();
    await expect(drawer.getByText("No records", { exact: true })).toBeVisible();
    await expect(drawer.locator("figure")).toHaveCount(0);
    await panel.screenshot({ path: join(directory, `${theme}-${width}-empty.png`) });
  });
}

for (const [theme, width] of workViewports) {
  test(`windowed voice chat shares the call design ${theme} ${width}`, async ({ page }) => {
    const directory = join(captures, "windowed-chat");
    await mkdir(directory, { recursive: true });
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/voice/voice-visual-styles.html?global&theme=${theme}`);
    await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
    const panel = page.locator("section[data-voice-state]");
    await panel.getByRole("button", { name: "Start voice", exact: true }).click();
    await page.evaluate(() => {
      (window as Window & { fixtureVoice?: FixtureVoice }).fixtureVoice!.speech(
        "What can I do in this project?",
      );
    });
    await panel.getByRole("button", { name: "Conversation", exact: true }).click();
    const transcript = panel.getByRole("list", { name: "Conversation" });
    await expect(transcript.getByText("What can I do in this project?")).toBeVisible();
    await expect(transcript.getByText("The fixture project is available.")).toBeVisible();
    const strip = panel.locator('[data-layout="strip"]');
    await expect(strip.locator('canvas[data-call-art="orb"][data-size="strip"]')).toBeVisible();
    await expect(panel.locator('canvas[data-call-art="backdrop"]')).toBeVisible();
    await expect(panel.getByRole("button", { name: "Mute microphone", exact: true })).toBeVisible();
    await panel.screenshot({ path: join(directory, `${theme}-${width}.png`) });
  });
}

for (const [theme, width] of workViewports) {
  test(`voice changes the view without reconnecting ${theme} ${width}`, async ({ page }) => {
    const directory = join(captures, "view-modes");
    await mkdir(directory, { recursive: true });
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/voice/voice-visual-styles.html?global&theme=${theme}`);
    await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
    const panel = page.locator("section[data-voice-state]");
    await panel.getByRole("button", { name: "Start voice", exact: true }).click();
    const speak = (mode: string) =>
      page.evaluate((value) => {
        (window as Window & { fixtureVoice?: FixtureVoice }).fixtureVoice!.speech(
          `switch voice view to ${value}`,
        );
      }, mode);
    await page.evaluate(() => {
      (window as Window & { fixtureVoice?: FixtureVoice }).fixtureVoice!.speech(
        "show live results full screen",
      );
    });
    await expect(panel).toHaveAttribute("data-full-screen", "true");
    await expect(panel.getByRole("heading", { name: "Test results", exact: true })).toBeVisible();
    await speak("mini");
    await expect(panel).toHaveAttribute("data-compact", "true");
    await expect(panel).not.toHaveAttribute("data-full-screen");
    await expect(panel.locator('canvas[data-call-art="backdrop"]')).toBeVisible();
    await expect(panel.getByRole("button", { name: "Mute microphone", exact: true })).toBeVisible();
    await panel.screenshot({ path: join(directory, `${theme}-${width}-mini.png`) });
    await speak("window");
    await expect(panel).not.toHaveAttribute("data-compact");
    await expect(panel).not.toHaveAttribute("data-full-screen");
    const connection = await page.evaluate(() => {
      const voice = (window as Window & { fixtureVoice?: FixtureVoice }).fixtureVoice!;
      return { connects: voice.connects, closes: voice.closes };
    });
    expect(connection).toEqual({ connects: 1, closes: 0 });
  });
}

for (const [theme, width] of workViewports) {
  test(`fullscreen call keeps controls and shows Chat and live results on demand ${theme} ${width}`, async ({
    page,
  }) => {
    await mkdir(captures, { recursive: true });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/tests/browser/voice/voice-visual-styles.html?theme=${theme}&global`);
    await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
    const panel = page.locator("section[data-voice-state]");
    const orb = panel.locator('canvas[data-call-art="orb"]');
    const chat = panel.getByRole("button", { name: "Chat", exact: true });
    const transcript = panel.getByRole("region", { name: "Conversation" });
    const results = panel.getByRole("region", { name: "Live results", exact: true });
    const resultHeading = results.getByRole("heading", { name: "Test results", exact: true });
    const resultsToggle = panel.getByRole("button", { name: "Live results", exact: true });
    const start = panel.getByRole("button", { name: "Start voice", exact: true });
    const capture = (state: string) =>
      panel.screenshot({ path: join(captures, `${theme}-${width}-fullscreen-${state}.png`) });
    const assertNoClipping = () =>
      expect.poll(() => panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);

    await expect(panel).not.toHaveAttribute("data-full-screen");
    await panel.getByRole("button", { name: "Full screen", exact: true }).click();
    await expect(panel).toHaveAttribute("data-full-screen", "true");
    await expect(results).toHaveCount(0);
    await expect(resultsToggle).toHaveCount(0);
    await expect(orb).toHaveAttribute("data-state", "off");
    expect((await orb.boundingBox())!.width).toBeGreaterThan(300);
    await capture("ready");

    const startBounds = (await start.boundingBox())!;
    await chat.click();
    await expect(chat).toHaveAttribute("aria-expanded", "true");
    await expect(transcript.getByText("No messages yet")).toBeVisible();
    await expect(orb).toBeVisible();
    expect((await start.boundingBox())!.y).toBe(startBounds.y);
    await assertNoClipping();
    await transcript.getByRole("button", { name: "Close", exact: true }).click();
    await expect(chat).toBeFocused();
    await expect(chat).toHaveAttribute("aria-expanded", "false");

    await start.click();
    await expect(orb).toHaveAttribute("data-state", "listening");
    await page.evaluate(() => {
      const voice = (window as Window & { fixtureVoice?: FixtureVoice }).fixtureVoice!;
      voice.speech("Show the test totals.");
    });
    await chat.click();
    await expect(transcript.getByRole("list").getByText("Show the test totals.")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Mute microphone", exact: true })).toBeVisible();
    await capture("conversation");
    await chat.click();

    await page.evaluate(() => {
      const voice = (window as Window & { fixtureVoice?: FixtureVoice }).fixtureVoice!;
      voice.speech("show live results");
    });
    await expect(resultHeading).toBeVisible();
    await expect(results.getByText("Two packages finished.")).toBeVisible();
    await expect(
      panel.getByText(
        /The accepted owner turn has not been saved yet|This fixture does not mutate assistant state/,
      ),
    ).toHaveCount(0);
    const chartLabels = results.locator('div[aria-hidden="true"] > span');
    await expect(chartLabels.and(results.getByText("Web", { exact: true }))).toBeVisible();
    await expect(chartLabels.and(results.getByText("Host", { exact: true }))).toBeVisible();
    expect((await results.boundingBox())!.width).toBeLessThan(width * 0.55);
    await expect(
      panel.getByRole("button", { name: "Disconnect voice", exact: true }),
    ).toBeVisible();
    await assertNoClipping();
    await capture("results");
    await resultsToggle.click();
    await expect(results).toHaveCount(0);
    await expect(resultsToggle).toHaveAttribute("aria-expanded", "false");
    await resultsToggle.click();
    await expect(resultHeading).toBeVisible();
  });
}
for (const [theme, width] of workViewports) {
  test(`fullscreen voice centers the caption and Room notice ${theme} ${width}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width, height: 800 });
    await page.goto(
      `/tests/browser/voice/voice-visual-styles.html?theme=${theme}&global&choice-ack-lost`,
    );
    await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
    const panel = page.locator("section[data-voice-state]");
    await panel.getByRole("button", { name: "Full screen", exact: true }).click();
    await panel.getByRole("button", { name: "Start voice", exact: true }).click();
    const scope = panel.getByRole("radio", { name: "Global", exact: true });
    const disconnect = panel.getByRole("button", { name: "Disconnect voice", exact: true });
    await expect(disconnect).toBeVisible();
    const controlsBefore = await disconnect.boundingBox();
    await page.evaluate(() => {
      (window as Window & { fixtureVoice?: FixtureVoice }).fixtureVoice!.speech("show choices");
    });
    const notice = panel.getByRole("status").filter({
      hasText: "Saving this question is unconfirmed. Retry to verify the original card.",
    });
    const caption = panel.getByText("show choices", { exact: true });
    await expect(notice).toBeVisible();
    await expect(caption).toBeVisible();
    await mkdir(captures, { recursive: true });
    await panel.screenshot({
      path: join(captures, `${theme}-${width}-fullscreen-room-notice.png`),
    });
    await expect(scope).toBeVisible();
    expect(await disconnect.boundingBox()).toEqual(controlsBefore);
    const bounds = (await panel.boundingBox())!;
    const center = bounds.x + bounds.width / 2;
    for (const line of [caption, notice]) {
      const textCenter = await line.evaluate((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        return rect.x + rect.width / 2;
      });
      expect(Math.abs(textCenter - center)).toBeLessThan(2);
    }
    const answer = panel.getByRole("button", { name: "Send answer", exact: true });
    await expect(answer).toHaveCount(0);
    const retry = panel.getByRole("button", { name: "Retry", exact: true });
    await retry.scrollIntoViewIfNeeded();
    await expect(retry).toBeInViewport({ ratio: 1 });
    await retry.click();
    await answer.scrollIntoViewIfNeeded();
    await expect(answer).toBeInViewport({ ratio: 1 });
  });
}

test("fullscreen voice questions stay accessible with Chat open on a narrow window", async ({
  page,
}) => {
  await page.setViewportSize({ width: 560, height: 800 });
  await page.goto("/tests/browser/voice/voice-visual-styles.html?global");
  await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
  const panel = page.locator("section[data-voice-state]");
  await panel.getByRole("button", { name: "Full screen", exact: true }).click();
  await panel.getByRole("button", { name: "Start voice", exact: true }).click();
  const chat = panel.getByRole("region", { name: "Conversation" });
  await panel.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(chat).toBeVisible();
  await page.evaluate(() => {
    (window as Window & { fixtureVoice?: FixtureVoice }).fixtureVoice!.speech("show choices");
  });
  await expect(panel.getByRole("group", { name: "Which project should I follow?" })).toBeVisible();
  await panel.getByRole("radio", { name: /Clinic/ }).click();
  await panel.getByRole("button", { name: "Send answer", exact: true }).click();
  await expect(chat.getByText("Your project choice has been recorded.")).toBeVisible();
});

for (const [theme, width] of workViewports)
  test(`call particles and light follow voice ${theme} ${width}`, async ({ page }) => {
    await mkdir(captures, { recursive: true });
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/tests/browser/voice/voice-visual-styles.html?theme=${theme}&global`);
    await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
    const panel = page.locator("section[data-voice-state]");
    await panel.getByRole("button", { name: "Full screen", exact: true }).click();
    const orb = panel.locator('canvas[data-call-art="orb"]');
    const light = panel.locator('canvas[data-call-art="backdrop"]');
    const pixels = (part: typeof orb) =>
      part.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
    const capture = (state: string) =>
      panel.screenshot({ path: join(captures, `${theme}-${width}-call-${state}.png`) });
    const check = async (state: string, animated: boolean) => {
      await expect(orb).toHaveAttribute("data-state", state);
      await expect(light).toHaveAttribute("data-state", state);
      await expect(orb).toHaveAttribute("data-animating", String(animated));
      await expect(light).toHaveAttribute("data-animating", String(animated));
      const before = [await pixels(orb), await pixels(light)];
      if (animated) {
        await expect.poll(() => pixels(orb)).not.toBe(before[0]);
        await expect.poll(() => pixels(light)).not.toBe(before[1]);
      }
      await capture(state === "assistant" && !animated ? "assistant-reduced" : state);
      return before;
    };
    await check("off", false);
    await panel.getByRole("button", { name: "Start voice", exact: true }).click();
    const listening = await check("listening", true);
    await page.evaluate(() => {
      const voice = (window as any).fixtureVoice;
      voice.audioLevel.current = 0.9;
      voice.callbacks.state("speaking");
    });
    await check("user", true);
    await page.evaluate(() => (window as any).fixtureVoice.callbacks.state("transcribing"));
    await check("transcribing", true);
    await page.evaluate(() => (window as any).fixtureVoice.callbacks.state("replying"));
    const thinking = await check("thinking", true);
    expect(thinking[1]).not.toBe(listening[1]);
    await page.evaluate(() => (window as any).fixtureVoice.callbacks.playback(true));
    const reply = await check("assistant", true);
    expect(reply[1]).not.toBe(thinking[1]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const still = await check("assistant", false);
    expect(await pixels(orb)).toBe(still[0]);
    expect(await pixels(light)).toBe(still[1]);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await panel.getByRole("button", { name: "Stop speaking", exact: true }).click();
    await page.evaluate(() => (window as any).fixtureVoice.callbacks.state("listening"));
    await expect(panel).not.toHaveAttribute("data-voice-state", "assistant");
    await panel.getByRole("button", { name: "Mute microphone", exact: true }).click();
    await expect(panel.getByText("Connected · Microphone off", { exact: true })).toBeVisible();
    await check("connected", true);
    await page.evaluate(() => (window as any).fixtureVoice.callbacks.playback(true));
    await expect(panel.getByText("Assistant speaking", { exact: true })).toBeVisible();
    await expect(orb).toHaveAttribute("data-state", "assistant");
    await expect(
      panel.getByRole("button", { name: "Mute microphone", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await panel.getByRole("button", { name: "Disconnect voice", exact: true }).click();
    await check("off", false);
  });
for (const [theme, width] of workViewports)
  test(`short voice panel keeps scope controls reachable ${theme} ${width}`, async ({ page }) => {
    await mkdir(captures, { recursive: true });
    await page.addInitScript(() => {
      localStorage.setItem("bycoda:voice-size", JSON.stringify({ width: 320, height: 260 }));
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/tests/browser/voice/voice-visual-styles.html?theme=${theme}&global&working`);
    await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
    const panel = page.locator("section[data-voice-state]");
    const globalScope = panel.getByRole("radio", { name: "Global", exact: true });
    const projectScope = panel.getByRole("radio", { name: "Project", exact: true });
    const start = panel.getByRole("button", { name: "Start voice", exact: true });
    await start.click();
    await page.evaluate(() => {
      (window as Window & { fixtureVoice?: FixtureVoice }).fixtureVoice!.speech(
        "Keep this voice conversation visible while the project is working. ".repeat(4),
      );
    });
    const assertControls = async (state: string, action: string) => {
      await panel.screenshot({
        path: join(captures, `${theme}-${width}-short-scope-${state}.png`),
      });
      for (const control of [
        globalScope,
        projectScope,
        panel.getByRole("button", { name: action }),
      ])
        await expect(control).toBeInViewport({ ratio: 0.99 });
    };
    await assertControls("live", "Disconnect voice");
    await panel.getByRole("button", { name: "Disconnect voice", exact: true }).click();
    await assertControls("idle", "Start voice");
    await projectScope.click();
    await expect(projectScope).toBeChecked();
    await globalScope.click();
    await expect(globalScope).toBeChecked();
  });

for (const theme of ["light", "dark"])
  for (const [width, height] of [
    [800, 286],
    [1280, 720],
  ])
    test(`call stage fits saved panel ${theme} ${width}`, async ({ page }) => {
      await mkdir(captures, { recursive: true });
      await page.addInitScript((height) => {
        localStorage.setItem("bycoda:voice-size", JSON.stringify({ width: 450, height }));
      }, height);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/voice/voice-visual-styles.html?theme=${theme}&global&state=connecting`,
      );
      await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
      const panel = page.locator("section[data-voice-state]");
      const stage = panel.locator('[data-layout="stage"]');
      const orb = stage.locator('canvas[data-call-art="orb"]');
      await expect(panel).toHaveAttribute("data-sized", "");
      const assertStage = async (action: string) => {
        const button = panel.getByRole("button", { name: action, exact: true });
        await expect(button).toBeVisible();
        await expect(stage).toBeInViewport({ ratio: 0.99 });
        await expect(orb).toBeInViewport({ ratio: 0.99 });
        expect((await orb.boundingBox())!.width).toBeGreaterThanOrEqual(height < 300 ? 84 : 220);
        const stageBounds = (await stage.boundingBox())!;
        const scope = panel.getByRole("radiogroup", { name: "Voice scope" });
        await expect(scope).toBeInViewport({ ratio: 0.99 });
        const scopeBounds = (await scope.boundingBox())!;
        expect(scopeBounds.y - (stageBounds.y + stageBounds.height)).toBeLessThan(32);
        await panel.screenshot({ path: join(captures, `${theme}-${width}-stage-${action}.png`) });
      };
      await assertStage("Start voice");
      await panel.getByRole("button", { name: "Start voice", exact: true }).click();
      await expect(panel).toHaveAttribute("data-voice-state", "connecting");
      await assertStage("Cancel");
      await panel.getByRole("button", { name: "Cancel", exact: true }).click();
      await assertStage("Start voice");
      if (height < 300) {
        await page.goto(`/tests/browser/voice/voice-visual-styles.html?theme=${theme}&global`);
        await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
        await panel.getByRole("button", { name: "Start voice", exact: true }).click();
        await expect(panel).toHaveAttribute("data-voice-state", "listening");
        await expect(stage).toBeInViewport({ ratio: 0.99 });
        await expect(
          panel.getByRole("button", { name: "Disconnect voice", exact: true }),
        ).toBeInViewport({ ratio: 0.99 });
        await panel.screenshot({ path: join(captures, `${theme}-${width}-stage-live-short.png`) });
      }
    });
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
        const orb = page.locator('canvas[data-call-art="orb"]');
        const frame = () => orb.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
        const before = await frame();
        await expect.poll(frame).not.toBe(before);
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
    await panel.getByRole("button", { name: "Mute microphone", exact: true }).click();
  await expect(panel).toHaveAttribute(
    "data-voice-state",
    state === "working" ? "listening" : state === "muted" ? "connected" : state,
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
          // A muted microphone keeps the call connected; the mic button stays selected.
          const actualState =
            state === "working" ? "listening" : state === "muted" ? "connected" : state;
          const artworkState = state === "thinking" ? "transcribing" : actualState;
          await expect(
            panel.locator(`canvas[data-call-art="orb"][data-state="${artworkState}"]`),
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
    name: "Move voice window",
    exact: true,
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
  const core = panel.locator('canvas[data-call-art="orb"]');
  const frame = () => core.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  const still = await frame();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(await frame()).toBe(still);
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
        `/tests/browser/voice/voice-visual-styles.html?setup-wizard&theme=${theme}&lang=en`,
      );
      const setup = page.getByRole("dialog", { name: "Voice setup" });
      const next = setup.getByRole("button", { name: "Next", exact: true });
      await expect(next).toBeDisabled();
      await expect(setup.getByText("Enable dictation")).toHaveCount(0);
      await expect(
        setup.getByText("Start the microphone test, then say one sentence."),
      ).toHaveCount(0);
      await setup.getByRole("radio", { name: "On this computer" }).click();
      await setup.getByRole("button", { name: "Check connection" }).click();
      await expect(next).toBeEnabled();
      await setup.screenshot({ path: join(captures, `${theme}-${width}-setup-provider.png`) });
      await next.click();
      await expect(setup.getByRole("button", { name: "Listen" })).toBeVisible();
      await expect(next).toBeEnabled();
      await setup.screenshot({ path: join(captures, `${theme}-${width}-setup-speaker.png`) });
      await next.click();
      await expect(setup.getByRole("button", { name: "Record test" })).toBeVisible();
      await expect(setup.getByRole("button", { name: "Listen" })).toHaveCount(0);
      await expect(next).toBeEnabled();
      await setup.screenshot({ path: join(captures, `${theme}-${width}-setup-microphone.png`) });
      await next.click();
      await setup.getByRole("button", { name: "Start", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Voice is ready" })).toBeVisible();
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

test("wake phrase status and toggle stay with the assistant avatar", async ({ page }) => {
  await page.goto("/tests/browser/voice/voice-visual-styles.html?wake-quick-settings=pack");
  await expect(page.getByRole("button", { name: "Talk to Arif", exact: true })).toBeVisible();
  const trigger = page.getByRole("button", { name: "Voice settings", exact: true });
  await trigger.click();
  const popup = page.getByRole("dialog", { name: "Voice settings" });
  const toggle = popup.getByRole("switch", { name: "Wake and sleep phrases" });
  const settingsToggle = page
    .locator("main")
    .getByRole("switch", { name: "Wake and sleep phrases" });
  await expect(toggle).toBeFocused();
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(popup.getByText("Wake phrase needs the local voice pack")).toBeVisible();
  await expect(popup.getByRole("button", { name: "Set up voice" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(settingsToggle).toBeChecked();
  await expect(page.getByText("Wake phrase needs the local voice pack")).toHaveCount(0);
  await expect(page.locator('[data-wake-status="pack"][data-tone="warning"]')).toBeVisible();
  await page.reload();
  await trigger.click();
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator("[data-wake-status]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(settingsToggle).not.toBeChecked();
  await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
  await expect(page.getByRole("region", { name: "Voice companion" })).toBeVisible();
  await trigger.click();
  await expect(toggle).not.toBeChecked();
});

for (const theme of ["light", "dark"]) {
  for (const { width, compact } of [
    { width: 1280, compact: false },
    { width: 1280, compact: true },
    { width: 800, compact: true },
  ]) {
    const rail = compact ? "compact" : "expanded";
    test(`wake phrase quick settings ${rail} rail ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 620 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/voice/voice-visual-styles.html?wake-quick-settings=error&theme=${theme}${compact ? "&compact-rail" : ""}`,
      );
      const slot = page.locator("[data-voice-launcher-slot]");
      const launcher = slot.getByRole("button", { name: "Talk to Arif", exact: true });
      const trigger = slot.getByRole("button", { name: "Voice settings", exact: true });
      const popup = page.getByRole("dialog", { name: "Voice settings" });
      const message = "Wake phrase stopped listening. Check the microphone.";
      const group = slot.getByRole("group", { name: "Voice companion" });
      await expect(group).toBeVisible();
      await expect(group.getByRole("button")).toHaveCount(2);
      const primaryBox = (await launcher.boundingBox())!;
      const settingsBox = (await trigger.boundingBox())!;
      if (compact) {
        expect(settingsBox.y).toBeCloseTo(primaryBox.y + primaryBox.height, 0);
        expect(settingsBox.x + settingsBox.width / 2).toBeCloseTo(
          primaryBox.x + primaryBox.width / 2,
          0,
        );
        await expect(trigger.locator("svg.lucide-chevron-down")).toHaveCount(1);
      } else {
        expect(settingsBox.x).toBeCloseTo(primaryBox.x + primaryBox.width, 0);
        expect(settingsBox.y + settingsBox.height / 2).toBeCloseTo(
          primaryBox.y + primaryBox.height / 2,
          0,
        );
      }
      expect(settingsBox.width).toBe(24);
      expect(settingsBox.height).toBe(24);
      await expect(trigger.locator("svg")).toHaveCSS("inline-size", "12px");
      await expect(group).toHaveAttribute("data-surface", "transparent");
      if (compact) expect((await group.boundingBox())!.width).toBeLessThanOrEqual(56);
      await trigger.click();
      await popup.getByRole("switch", { name: "Wake and sleep phrases" }).click();
      await expect(popup.getByText(message)).toBeInViewport({ ratio: 1 });
      await expect(slot.locator('[data-wake-status="error"][data-tone="warning"]')).toBeVisible();
      const directory = join(process.cwd(), "temp/verification/arif-voice-routing/sidebar");
      await mkdir(directory, { recursive: true });
      const clip = { x: 0, y: 440, width: 320, height: 180 };
      await page.screenshot({ path: join(directory, `${rail}-${theme}-${width}-open.png`), clip });
      await page.keyboard.press("Escape");
      await expect(page.getByText(message)).toHaveCount(0);
      await page.mouse.move(width / 2, 600);
      await page.screenshot({
        path: join(directory, `${rail}-${theme}-${width}-closed.png`),
        clip,
      });

      if (compact) {
        await page
          .locator("html")
          .evaluate((html) => (html.dataset.controlDensity = "comfortable"));
        expect((await group.boundingBox())!.width).toBeLessThanOrEqual(56);
        await page.locator("html").evaluate((html) => (html.dataset.controlDensity = "touch"));
        expect((await group.boundingBox())!.width).toBeLessThanOrEqual(56);
        await expect(trigger).toHaveCSS("inline-size", "44px");
        await trigger.click();
        await expect(popup.getByText(message)).toBeInViewport({ ratio: 1 });
      }
    });
  }
}

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
      await expect(button).toHaveAttribute("data-surface-frame", "pane");
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

for (const [theme, width] of workViewports) {
  test(`fullscreen call composes a form whose chosen values drive a real action ${theme} ${width}`, async ({
    page,
  }) => {
    const directory = join(captures, "presented-form");
    await mkdir(directory, { recursive: true });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/tests/browser/voice/voice-visual-styles.html?global&usage&theme=${theme}`);
    await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
    const panel = page.locator("section[data-voice-state]");
    await panel.getByRole("button", { name: "Start voice", exact: true }).click();
    await page.evaluate(() => {
      (window as Window & { fixtureVoice?: FixtureVoice }).fixtureVoice!.speech("show usage form");
    });
    const results = panel.getByRole("region", { name: "Live results", exact: true });
    await expect(results.getByRole("heading", { name: "Usage report", exact: true })).toBeVisible();
    await expect(panel).toHaveAttribute("data-full-screen", "true");
    const read = results.getByRole("button", { name: "Read usage", exact: true });
    await expect(read).toBeEnabled();
    await panel.screenshot({ path: join(directory, `${theme}-${width}-composed.png`) });

    // Choose in a Select, switch a segmented control and type, then press the button.
    await results.getByRole("button", { name: /Period/ }).click();
    await page.getByRole("option", { name: "Last 30 days" }).click();
    await results.getByRole("radio", { name: "Tokens" }).click();
    await results.getByLabel("Note").fill("typed note");
    const originalWidth = (await results.boundingBox())!.width;
    await results.getByRole("button", { name: "Maximize panel" }).click();
    await expect
      .poll(async () => (await results.boundingBox())!.width)
      .toBeGreaterThan(originalWidth + 80);
    await expect(panel.getByRole("button", { name: "Mute microphone" })).toBeVisible();
    await panel.screenshot({ path: join(directory, `${theme}-${width}-expanded.png`) });
    await results.getByRole("button", { name: "Restore panel layout" }).press("Enter");
    await expect
      .poll(async () => (await results.boundingBox())!.width)
      .toBeCloseTo(originalWidth, 0);
    await expect(results.getByLabel("Note")).toHaveValue("typed note");
    await read.click();
    const reads = () =>
      page.evaluate(() =>
        (window as Window & { fixtureVoice?: FixtureVoice }).fixtureVoice!.actions.filter(
          (action) => action.startsWith("usage:"),
        ),
      );
    // The real executor read exactly what the owner chose, not the starting values.
    await expect.poll(reads).toEqual(["usage:last-30-days:tokens"]);
    await expect(results.getByText("Completed", { exact: true })).toBeVisible();
    await expect(results.getByLabel("Note")).toHaveValue("typed note");
    await panel.screenshot({ path: join(directory, `${theme}-${width}-after-press.png`) });
  });
}

for (const [theme, width] of workViewports) {
  test(`fullscreen call draws a nested composition of shared components ${theme} ${width}`, async ({
    page,
  }) => {
    const directory = join(captures, "presented-composition");
    await mkdir(directory, { recursive: true });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/tests/browser/voice/voice-visual-styles.html?global&theme=${theme}`);
    await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
    const panel = page.locator("section[data-voice-state]");
    await panel.getByRole("button", { name: "Start voice", exact: true }).click();
    await page.evaluate(() => {
      (window as Window & { fixtureVoice?: FixtureVoice }).fixtureVoice!.speech(
        "show composed report",
      );
    });
    const results = panel.getByRole("region", { name: "Live results", exact: true });
    await expect(
      results.getByRole("heading", { name: "Release report", exact: true }),
    ).toBeVisible();
    await expect(results.getByText("One check failed", { exact: true })).toBeVisible();
    await expect(results.getByText("Lint failed", { exact: true })).toBeVisible();
    await expect(results.getByText("Not observed in this turn.", { exact: true })).toBeVisible();
    await panel.screenshot({ path: join(directory, `${theme}-${width}-top.png`) });
    for (const name of ["Packages", "Options"]) {
      await results.getByRole("tab", { name, exact: true }).click();
      await results.getByRole("tabpanel").scrollIntoViewIfNeeded();
      await panel.screenshot({
        path: join(directory, `${theme}-${width}-${name.toLowerCase()}.png`),
      });
    }
    await expect(results.getByRole("switch", { name: "Notify me" })).toBeChecked();
  });
}

for (const [theme, width] of workViewports) {
  test(`fullscreen call presents copyable text, updates it in place and runs a button ${theme} ${width}`, async ({
    page,
  }) => {
    const directory = join(captures, "presented-view");
    await mkdir(directory, { recursive: true });
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width, height: 800 });
    await page.goto(
      `/tests/browser/voice/voice-visual-styles.html?navigation&session-outlet&theme=${theme}`,
    );
    await page.getByRole("button", { name: "Talk to Arif", exact: true }).click();
    const panel = page.locator("section[data-voice-state]");
    await panel.getByRole("button", { name: "Start voice", exact: true }).click();
    const say = (text: string) =>
      page.evaluate((value) => {
        (window as Window & { fixtureVoice?: FixtureVoice }).fixtureVoice!.speech(value);
      }, text);
    await say("show copyable draft");
    const results = panel.getByRole("region", { name: "Live results", exact: true });
    await expect(results.getByRole("heading", { name: "Release note", exact: true })).toBeVisible();
    const view = results.locator("[data-voice-presented-version]");
    await expect(view).toHaveAttribute("data-voice-presented-version", "1");
    await expect(panel).toHaveAttribute("data-full-screen", "true");
    const copy = results.getByRole("button", { name: "Copy", exact: true });
    await expect(copy).toBeVisible();
    await copy.click();
    await expect(results.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
    expect(
      (await page.evaluate(() => navigator.clipboard.readText())).replaceAll("\r\n", "\n"),
    ).toBe("Voice results can now show text you copy.\n  Press Copy to take it with you.");
    await panel.screenshot({ path: join(directory, `${theme}-${width}-first.png`) });

    await say("shorten copyable draft");
    await expect(view).toHaveAttribute("data-voice-presented-version", "2");
    await expect(results.getByText("Voice results now show copyable text.")).toBeVisible();
    await results.getByRole("button", { name: "Copy", exact: true }).click();
    expect(
      (await page.evaluate(() => navigator.clipboard.readText())).replaceAll("\r\n", "\n"),
    ).toBe("Voice results now show copyable text.");
    await panel.screenshot({ path: join(directory, `${theme}-${width}-updated.png`) });

    await results.getByRole("button", { name: "Open next session", exact: true }).click();
    await expect(panel).not.toHaveAttribute("data-full-screen");
    expect(
      await page.evaluate(
        () => (window as Window & { fixtureVoice?: FixtureVoice }).fixtureVoice!.connects,
      ),
    ).toBe(1);
  });
}
