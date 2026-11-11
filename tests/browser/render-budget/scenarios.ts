import type { Page } from "@playwright/test";

export type Meter = {
  commits: number;
  renders: number;
  byName: Record<string, number>;
};
/** Metrics of one measured phase: total renders plus renders of each root named in budgets.json. */
export type Phase = Record<string, number>;
export type Scenario = {
  url: string;
  prepare: (page: Page) => Promise<void>;
  /** Runs the interaction and returns the measured phases (and proof details to attach). */
  act: (
    page: Page,
    roots: string[],
  ) => Promise<{ phases: Record<string, Phase>; details?: object }>;
};
type MeterWindow = Window & {
  __renderMeter: { reset: () => void; snapshot: () => Meter };
  __shell: {
    stream: (options: { deltas: number; intervalMs: number; toolAt: number[] }) => Promise<number>;
  };
};

const IDLE_SECONDS = 60;
const TASKS_SECONDS = 35;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
export const snapshot = (page: Page) =>
  page.evaluate(() => (window as unknown as MeterWindow).__renderMeter.snapshot());
export const resetMeter = (page: Page) =>
  page.evaluate(() => (window as unknown as MeterWindow).__renderMeter.reset());
const phase = (meter: Meter, roots: string[]): Phase => ({
  renders: meter.renders,
  ...Object.fromEntries(roots.map((name) => [name, meter.byName[name] ?? 0])),
});

/** Waits until react-scan sees no commit for `quietMs`, so the measured window starts at rest. */
export async function settle(page: Page, quietMs = 2000, maxMs = 30_000) {
  const started = Date.now();
  let last = -1;
  let since = Date.now();
  while (Date.now() - started < maxMs) {
    const { commits } = await snapshot(page);
    if (commits !== last) {
      last = commits;
      since = Date.now();
    } else if (Date.now() - since >= quietMs) return;
    await sleep(250);
  }
}

const shellReady = async (page: Page) => {
  await page.waitForSelector("textarea", { timeout: 120_000 });
  await page.waitForFunction(() => "__shell" in window, null, { timeout: 30_000 });
};
const shell = "/tests/browser/render-budget/shell.html";

async function stream(page: Page, roots: string[]) {
  const spec = { deltas: 400, intervalMs: 15, toolAt: [120, 260] };
  // Liveness: the DOM's last "tokenN" index must grow while the stream runs, otherwise the
  // counts would describe a transcript that never rendered the stream.
  const samples: number[] = [];
  let done = false;
  const running = page
    .evaluate((s) => (window as unknown as MeterWindow).__shell.stream(s), spec)
    .finally(() => (done = true));
  while (!done) {
    samples.push(
      await page.evaluate(() => {
        const found = [...document.body.textContent!.matchAll(/token(\d+) /g)];
        return found.length ? Number(found.at(-1)![1]) : -1;
      }),
    );
    await sleep(100);
  }
  await running;
  const distinct = new Set(samples).size;
  const max = Math.max(...samples);
  if (distinct < 10 || max < spec.deltas / 2)
    throw new Error(`Streaming transcript not live in DOM: distinct=${distinct} maxDom=${max}`);
  return {
    phases: { run: phase(await snapshot(page), roots) },
    details: { liveness: { samples: samples.length, distinctDomValues: distinct, maxDom: max } },
  };
}

async function typeInComposer(page: Page, roots: string[]) {
  const box = page.locator("textarea").first();
  await box.click();
  await page.keyboard.type(
    "The quick brown fox jumps over the lazy dog, again and again.".slice(0, 60),
    { delay: 100 },
  );
  return { phases: { run: phase(await snapshot(page), roots) } };
}

async function cycleWindowFocus(page: Page, roots: string[]) {
  // Headless Chromium has no real window focus: dispatch the DOM events a hidden -> visible and
  // blur -> focus cycle produces. Tauri window-focus events are not covered.
  await page.evaluate(async () => {
    const set = (hidden: boolean) => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => (hidden ? "hidden" : "visible"),
      });
    };
    const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
    for (let cycle = 0; cycle < 5; cycle++) {
      set(true);
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("blur"));
      await wait(500);
      set(false);
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      await wait(1000);
    }
  });
  return { phases: { run: phase(await snapshot(page), roots) } };
}

async function tasksBoard(page: Page, roots: string[]) {
  await sleep(TASKS_SECONDS * 1000);
  const boardStay = phase(await snapshot(page), roots);
  await page.getByRole("button", { name: "New task", exact: true }).click();
  const form = page.getByRole("form", { name: "New task", exact: true });
  await form.waitFor({ timeout: 15_000 });
  await sleep(1500);
  await resetMeter(page);
  await form.getByRole("textbox", { name: "Task title", exact: true }).click();
  await page.keyboard.type("Measure keystroke renders", { delay: 150 });
  return { phases: { boardStay, newTaskFormTyping: phase(await snapshot(page), roots) } };
}

export const scenarios: Record<string, Scenario> = {
  idle60: {
    url: shell,
    prepare: shellReady,
    act: async (page, roots) => {
      await sleep(IDLE_SECONDS * 1000);
      return { phases: { run: phase(await snapshot(page), roots) } };
    },
  },
  streaming: { url: shell, prepare: shellReady, act: stream },
  composerTyping: { url: shell, prepare: shellReady, act: typeInComposer },
  windowFocus: { url: shell, prepare: shellReady, act: cycleWindowFocus },
  tasksBoard: {
    url: "/tests/browser/render-budget/tasks.html?sprintSeed",
    prepare: async (page) => {
      // Same navigation tasks.spec.ts uses to reach the populated board.
      await page.getByRole("tab", { name: "Sprints", exact: true }).click({ timeout: 120_000 });
      await page
        .locator("header.task-board-toolbar")
        .getByRole("button", { name: /^Project:/ })
        .click();
      await page.getByRole("option", { name: "All projects", exact: true }).click();
      await page
        .getByRole("button", { name: "New task", exact: true })
        .waitFor({ timeout: 30_000 });
    },
    act: tasksBoard,
  },
};
