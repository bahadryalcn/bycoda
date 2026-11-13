import { test, expect, type Browser } from "@playwright/test";
import { readFileSync } from "node:fs";
import { scenarios, settle, resetMeter } from "./scenarios";
import type { SessionGoal } from "../../../src/features/sessions/model/providerGoal";

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

test("composer keeps committed authority and restores the latest draft after remount", async ({
  page,
}) => {
  await page.goto("/tests/browser/render-budget/shell.html");
  const box = page.locator("textarea").first();
  const draft = "Korunan taslak 👩🏽‍💻 — مسودة محفوظة";
  await box.fill(draft);
  const authority = () => page.evaluate(() => window.__shell.draftAuthority());
  await expect.poll(authority).toEqual({
    draft,
    committedDraft: draft,
    composerText: draft,
    cachedDraft: draft,
    current: true,
  });
  const previousBox = await box.elementHandle();
  expect(previousBox).not.toBeNull();
  await page.evaluate(() => window.__shell.remountPane());
  // The restored value is identical on both mounts: wait for real DOM retirement
  // before editing, rather than accidentally filling the pane being removed.
  await expect.poll(() => previousBox!.evaluate((element) => element.isConnected)).toBe(false);
  await previousBox!.dispose();
  await expect(box).toHaveValue(draft);
  await box.fill(`${draft}\nNext edit`);
  await expect.poll(authority).toMatchObject({
    draft: `${draft}\nNext edit`,
    committedDraft: `${draft}\nNext edit`,
    composerText: `${draft}\nNext edit`,
    cachedDraft: `${draft}\nNext edit`,
    current: true,
  });
});

test("native Goal states preserve drafts and long objectives remain readable", async ({
  page,
  browser,
}, testInfo) => {
  await page.goto("/tests/browser/render-budget/shell.html?provider=codex&turns=2&visual=1");
  await page.waitForFunction(() => "__shell" in window);
  const box = page.locator("textarea").first();
  const draft = "Uzun hedef değişirken korunan taslak 👩🏽‍💻 مسودة";
  await box.fill(draft);
  const goal = page.locator("[data-provider-goal]");
  const objective = "Hesabı, seçili modeli ve sonucu doğrula 👨‍👩‍👧‍👦 مرحبا ".repeat(160);
  const setGoal = (status: SessionGoal["status"], ownerId = "native-goal-owner") =>
    page.evaluate(
      ({ status, objective, ownerId }) =>
        window.__shell.providerGoal(
          {
            provider: "codex",
            providerSessionId: "native-goal-owner",
            status,
            objective,
          },
          ownerId,
        ),
      { status, objective, ownerId },
    );
  for (const status of [
    "active",
    "paused",
    "blocked",
    "usageLimited",
    "budgetLimited",
    "complete",
  ] as const) {
    await setGoal(status);
    await expect(goal).toHaveAttribute("data-provider-goal", status);
    await expect(box).toHaveValue(draft);
    await expect(goal).toContainText(objective);
  }
  await setGoal("active", "different-native-owner");
  await expect(goal).toHaveCount(0);
  await expect(box).toHaveValue(draft);
  await setGoal("blocked");
  const expand = goal.getByRole("button", { name: "Show more", exact: true });
  await expand.focus();
  await expand.press("Enter");
  await expect(goal.getByRole("button", { name: "Show less", exact: true })).toBeFocused();
  await expect(goal.getByRole("button", { name: "Show less", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(box).toHaveValue(draft);
  await goal.getByRole("button", { name: "Show less", exact: true }).press("Enter");

  for (const width of [1280, 800])
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 800 });
      await page.evaluate(({ theme }) => window.__shell.appearance(theme, "tr", false), { theme });
      await expect(box).toHaveValue(draft);
      const headerBox = await goal.boundingBox();
      const paneBox = await page.locator("[data-session-body]").boundingBox();
      expect(headerBox).not.toBeNull();
      expect(paneBox).not.toBeNull();
      expect(headerBox!.y + headerBox!.height).toBeLessThanOrEqual(paneBox!.y + 1);
      await page.screenshot({ path: testInfo.outputPath(`native-goal-${theme}-${width}.png`) });
    }
  await page.evaluate(() => window.__shell.appearance("dark", "tr", true));
  await expect(box).toHaveValue(draft);
  await page.screenshot({ path: testInfo.outputPath("native-goal-dark-800-rtl.png") });
  // 800 physical pixels at 200%: 400 CSS pixels and two physical pixels per CSS pixel.
  // This is viewport/DPR emulation, not a claim about an installed app's browser zoom.
  const zoomContext = await browser.newContext({
    viewport: { width: 400, height: 400 },
    deviceScaleFactor: 2,
  });
  try {
    const zoomPage = await zoomContext.newPage();
    await zoomPage.goto("/tests/browser/render-budget/shell.html?provider=codex&turns=2&visual=1");
    await zoomPage.waitForFunction(() => "__shell" in window);
    await zoomPage.evaluate(
      async ({ objective }) => {
        await window.__shell.appearance("dark", "tr", true);
        window.__shell.providerGoal(
          {
            provider: "codex",
            providerSessionId: "native-goal-owner",
            status: "blocked",
            objective,
          },
          "native-goal-owner",
        );
      },
      { objective },
    );
    expect(await zoomPage.evaluate(() => ({ width: innerWidth, scale: devicePixelRatio }))).toEqual(
      { width: 400, scale: 2 },
    );
    const zoomBox = zoomPage.locator("textarea").first();
    await zoomBox.fill(draft);
    const zoomGoal = zoomPage.locator("[data-provider-goal]");
    await zoomGoal.getByRole("button").focus();
    await zoomGoal.getByRole("button").press("Enter");
    await expect(zoomGoal.getByRole("button")).toHaveAttribute("aria-expanded", "true");
    await zoomGoal.getByRole("button").press("Enter");
    await expect(zoomBox).toHaveValue(draft);
    const send = zoomPage.getByRole("button", { name: /^Gönder/ });
    await send.focus();
    await expect(send).toBeFocused();
    const sendBounds = await send.boundingBox();
    expect(sendBounds).not.toBeNull();
    expect(sendBounds!.y).toBeGreaterThanOrEqual(0);
    expect(sendBounds!.y + sendBounds!.height).toBeLessThanOrEqual(401);
    expect(
      await zoomPage.locator("[data-session-composer]").evaluate((node) => node.scrollTop),
    ).toBeGreaterThan(0);
    expect(await zoomPage.locator("[data-session-body]").evaluate((node) => node.scrollTop)).toBe(
      0,
    );
    await expect(zoomPage.locator("[data-provider-goal]")).toBeInViewport();
    await zoomPage.screenshot({
      path: testInfo.outputPath("native-goal-dark-800-rtl-200pct-equivalent.png"),
      scale: "device",
    });
  } finally {
    await zoomContext.close();
  }
});
