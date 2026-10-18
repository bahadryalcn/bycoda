// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import { recordRateLimitHistory } from "./rateLimitHistory";
import { idleRateLimits } from "./rateLimits";
const key = "bycoda.quotaHistory.v1";
beforeEach(() => localStorage.clear());
it("records only successful readings, deduplicates and preserves actual reset boundaries", () => {
  const at = Date.now();
  const limits = {
    ...idleRateLimits("codex"),
    status: "ok" as const,
    updatedAt: at,
    session: { usedPercent: 40, windowMinutes: 300, resetsAt: at + 3_600_000 },
  };
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
  recordRateLimitHistory("codex:work", {
    ...idleRateLimits("codex"),
    status: "ok",
    updatedAt: Date.now(),
    session: { usedPercent: 1, windowMinutes: 300, resetsAt: null },
  });
  expect(JSON.parse(localStorage.getItem(key)!)).toHaveLength(1);
});
