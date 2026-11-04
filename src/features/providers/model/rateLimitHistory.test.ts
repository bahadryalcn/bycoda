// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  RATE_LIMIT_HISTORY_MAX_SAMPLES,
  recordRateLimitHistory,
  useRateLimitHistory,
  type QuotaSample,
} from "./rateLimitHistory";
import { idleRateLimits } from "./rateLimits";
const key = "bycoda.quotaHistory.v1";
beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const okLimits = (updatedAt: number, usedPercent: number, resetsAt: number | null = null) => ({
  ...idleRateLimits("codex"),
  status: "ok" as const,
  updatedAt,
  session: { usedPercent, windowMinutes: 300, resetsAt },
});
const stored = (): QuotaSample[] => JSON.parse(localStorage.getItem(key) ?? "[]");

it("records only successful readings, deduplicates and preserves actual reset boundaries", () => {
  const at = Date.now();
  const limits = okLimits(at, 40, at + 3_600_000);
  recordRateLimitHistory("codex:work", limits);
  recordRateLimitHistory("codex:work", limits);
  recordRateLimitHistory("codex:work", { ...limits, status: "error", updatedAt: at + 1 });
  expect(JSON.parse(localStorage.getItem(key)!)).toHaveLength(1);
  recordRateLimitHistory("codex:work", {
    ...limits,
    updatedAt: at + 1000,
    session: { ...limits.session, usedPercent: 1, resetsAt: at + 18_000_000 },
  });
  recordRateLimitHistory("codex:personal", limits);
  const rows = JSON.parse(localStorage.getItem(key)!);
  expect(rows).toHaveLength(3);
  expect(
    rows
      .filter((s: { account: string }) => s.account === "codex:work")
      .map((s: { used: number }) => s.used),
  ).toEqual([40, 1]);
});
it("bounds history and drops readings older than retention", () => {
  localStorage.setItem(
    key,
    JSON.stringify([
      {
        account: "codex:work",
        at: Date.now() - 91 * 86_400_000,
        kind: "session",
        used: 40,
        minutes: 300,
        resetsAt: null,
      },
    ]),
  );
  recordRateLimitHistory("codex:work", okLimits(Date.now(), 1));
  expect(JSON.parse(localStorage.getItem(key)!)).toHaveLength(1);
});
it("skips a repeated reading from the in-memory snapshot without parsing or writing storage", () => {
  const at = Date.now();
  recordRateLimitHistory("codex:work", okLimits(at, 40));
  const parse = vi.spyOn(JSON, "parse");
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  recordRateLimitHistory("codex:work", okLimits(at + 1000, 40));
  recordRateLimitHistory("codex:work", okLimits(at - 1000, 50));
  expect(parse).not.toHaveBeenCalled();
  expect(setItem).not.toHaveBeenCalled();
  expect(stored()).toHaveLength(1);
});
it("appends chronological readings and sorts only a reading dated before the tail", () => {
  const at = Date.now();
  const sort = vi.spyOn(Array.prototype, "sort");
  recordRateLimitHistory("codex:work", okLimits(at, 10));
  recordRateLimitHistory("codex:work", okLimits(at + 600_000, 20));
  recordRateLimitHistory("codex:work", okLimits(at + 1_200_000, 30));
  expect(sort).not.toHaveBeenCalled();
  recordRateLimitHistory("codex:personal", okLimits(at + 300_000, 5));
  expect(sort).toHaveBeenCalledTimes(1);
  expect(stored().map((s) => s.at)).toEqual([at, at + 300_000, at + 600_000, at + 1_200_000]);
});
it("thins old samples instead of dropping the retention window when the cap is reached", () => {
  const now = Date.now();
  const step = 5 * 60_000;
  const count = RATE_LIMIT_HISTORY_MAX_SAMPLES;
  const oldest = now - count * step; // ~8.7 days of 5-minute readings
  localStorage.setItem(
    key,
    JSON.stringify(
      Array.from({ length: count }, (_, index) => ({
        account: "codex:work",
        at: oldest + index * step,
        kind: "session",
        used: index % 100,
        minutes: 300,
        resetsAt: null,
      })),
    ),
  );
  recordRateLimitHistory("codex:work", okLimits(now, 1));
  const rows = stored();
  expect(rows.length).toBeLessThanOrEqual(RATE_LIMIT_HISTORY_MAX_SAMPLES);
  expect(rows[0]!.at).toBe(oldest); // the oldest reading survives
  expect(rows[rows.length - 1]!.at).toBe(now);
  // The last day keeps full resolution: 287 seeded readings strictly inside it plus the new one.
  expect(rows.filter((s) => now - s.at < 86_400_000)).toHaveLength(287 + 1);
  const weekOld = rows.filter((s) => now - s.at >= 7 * 86_400_000);
  for (let index = 1; index < weekOld.length; index++)
    expect(weekOld[index]!.at - weekOld[index - 1]!.at).toBeGreaterThanOrEqual(2 * 3_600_000);
  expect(JSON.stringify(rows).length).toBeLessThan(350_000);
});
it("shares one storage listener across subscribers and re-reads on another window's write", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  const storageListeners = (spy: typeof add) => spy.mock.calls.filter(([type]) => type === "storage");
  const seen: QuotaSample[][] = [];
  function Probe() {
    seen.push(useRateLimitHistory());
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(createElement("div", null, createElement(Probe), createElement(Probe))),
    );
    expect(storageListeners(add)).toHaveLength(1);
    expect(seen.at(-1)).toEqual([]);
    const at = Date.now();
    localStorage.setItem(
      key,
      JSON.stringify([{ account: "codex:work", at, kind: "session", used: 3, minutes: 300, resetsAt: null }]),
    );
    await act(async () => window.dispatchEvent(new StorageEvent("storage", { key })));
    expect(seen.at(-1)).toEqual([expect.objectContaining({ account: "codex:work", used: 3 })]);
    await act(async () => root.render(createElement("div")));
    expect(storageListeners(remove)).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
