import { test, expect, type Browser } from "@playwright/test";
import { readFileSync } from "node:fs";
import { scenarios, settle, resetMeter } from "./scenarios";

type Budgets = { scenarios: Record<string, Record<string, Record<string, number>>> };
const budgets = JSON.parse(
  readFileSync(new URL("./budgets.json", import.meta.url), "utf8"),
) as Budgets;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

// The dev server transforms the module graph (React Compiler per file) on first load and may
// re-optimize dependencies mid-load; HMR is off, so that page never recovers. Warm every fixture
// page on throwaway contexts first so scenarios start on a warm server.
async function warm(browser: Browser, baseURL: string, path: string) {
  for (let attempt = 1; ; attempt++) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(new URL(path, baseURL).href, { waitUntil: "commit" });
      await page.waitForFunction(() => "__renderMeter" in window, null, { timeout: 180_000 });
      await sleep(3000);
      return;
    } catch (error) {
      if (attempt >= 4) throw error;
    } finally {
      await context.close();
    }
  }
}

test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ browser, baseURL }) => {
  test.setTimeout(900_000);
  for (const path of new Set(Object.values(scenarios).map((scenario) => scenario.url)))
    await warm(browser, baseURL!, path);
});

for (const [name, scenario] of Object.entries(scenarios))
  test(`${name} stays within its render budget`, async ({ browser, baseURL }, testInfo) => {
    const limits = budgets.scenarios[name];
    const roots = [
      ...new Set(Object.values(limits).flatMap((bounds) => Object.keys(bounds))),
    ].filter((metric) => metric !== "renders");
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    try {
      const page = await context.newPage();
      await page.goto(new URL(scenario.url, baseURL).href, { waitUntil: "commit" });
      await page.waitForFunction(() => "__renderMeter" in window, null, { timeout: 240_000 });
      await scenario.prepare(page);
      await settle(page);
      await resetMeter(page);
      const { phases, details } = await scenario.act(page, roots);
      await testInfo.attach("render-counts.json", {
        body: JSON.stringify({ scenario: name, phases, budgets: limits, details }, null, 2),
        contentType: "application/json",
      });
      const failures: string[] = [];
      for (const [phaseName, bounds] of Object.entries(limits))
        for (const [metric, bound] of Object.entries(bounds)) {
          const measured = phases[phaseName]?.[metric];
          if (measured === undefined || measured > bound)
            failures.push(`${name}/${phaseName}: ${metric} measured ${measured} > budget ${bound}`);
        }
      expect(failures, failures.join("\n")).toEqual([]);
    } finally {
      await context.close();
    }
  });
