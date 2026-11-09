import { describe, expect, it } from "vitest";
import { usageRate, type AccountUsage, type UsageRow } from "../../providers/public/providerUsage";
import { summarizeUsageOverview } from "../../usage/model/usageOverview";
import type { UsageTurn } from "../../usage/model/usageAnalytics";
import { summarizeToday, todayWindow } from "./todayAggregate";

// Wednesday 2026-11-04, 15:00 local.
const now = new Date(2026, 10, 4, 15).getTime();
const at = (day: number, hour: number) => new Date(2026, 10, day, hour).getTime();
const account = { id: "a", provider: "claude" as const, label: "A" };

const row = (
  time: number,
  project: string,
  output: number,
  model = "claude-sonnet-4-5",
): UsageRow => ({
  slot: time / 1000,
  model,
  project,
  input: 1000,
  output,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
});
const turn = (id: string, project: string, startedAt: number, minutes: number): UsageTurn => ({
  sessionId: id,
  title: `title ${id}`,
  project,
  provider: "claude",
  accountId: "a",
  model: "claude-sonnet-4-5",
  startedAt,
  durationMs: minutes * 60_000,
  inputTokens: 1000,
  outputTokens: 500,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

const usage: AccountUsage[] = [
  {
    account,
    rows: [
      row(at(4, 9), "C:/work/alpha", 4000),
      row(at(4, 11), "C:/work/beta", 2000),
      row(at(3, 10), "C:/work/alpha", 8000),
      row(at(2, 10), "C:/work/gamma", 1000, "unknown-model"),
      row(at(1, 10), "C:/work/alpha", 1000),
    ],
  },
];
const turns = [
  turn("s1", "C:/work/alpha", at(4, 9), 30),
  turn("s2", "C:/work/alpha", at(4, 10), 15),
  turn("s3", "C:/work/beta", at(4, 11), 10),
  turn("s4", "C:/work/alpha", at(3, 10), 20),
  turn("s5", "C:/work/gamma", at(2, 10), 5),
];

describe("today aggregation", () => {
  it("starts the week on Monday and the day at local midnight", () => {
    expect(todayWindow("today", now).start).toBe(at(4, 0));
    expect(todayWindow("week", now).start).toBe(at(2, 0));
    expect(todayWindow("week", at(8, 12)).start).toBe(at(2, 0));
  });

  it("groups one day by project", () => {
    const data = summarizeToday({
      usage,
      turns,
      pricing: usageRate,
      period: "today",
      now,
    });
    expect(data.projects.map((p) => [p.label, p.sessions, p.runMs / 60_000])).toEqual([
      ["alpha", 2, 45],
      ["beta", 1, 10],
    ]);
    expect(data.totals.sessions).toBe(3);
    expect(data.totals.runMs).toBe(55 * 60_000);
    expect(data.days).toHaveLength(1);
  });

  it("groups the week by day and project and adds the days up", () => {
    const data = summarizeToday({
      usage,
      turns,
      pricing: usageRate,
      period: "week",
      now,
    });
    expect(data.days.map((d) => d.key)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
    expect(data.days.map((d) => d.sessions)).toEqual([1, 1, 3]);
    expect(data.projects.find((p) => p.label === "alpha")?.sessions).toBe(3);
    expect(data.days.reduce((sum, d) => sum + d.cost, 0)).toBeCloseTo(data.totals.cost, 10);
    expect(data.days.reduce((sum, d) => sum + d.runMs, 0)).toBe(data.totals.runMs);
    expect(data.projects.find((p) => p.label === "gamma")?.unpricedTokens).toBeGreaterThan(0);
    expect(data.totals.unpricedTokens).toBeGreaterThan(0);
  });

  it("prices exactly like the Usage overview", () => {
    const data = summarizeToday({
      usage,
      turns,
      pricing: usageRate,
      period: "week",
      now,
    });
    const overview = summarizeUsageOverview(
      usage,
      "7d",
      new Date(now),
      "provider",
      () => null,
      usageRate,
      { start: new Date(at(2, 0)), end: new Date(at(4, 0)) },
    );
    expect(data.totals.cost).toBeCloseTo(overview.totals.cost, 10);
    for (const project of overview.projects) {
      expect(data.projects.find((p) => p.key === project.key)?.cost).toBeCloseTo(project.cost, 10);
    }
  });

  it("is empty without activity", () => {
    const data = summarizeToday({
      usage: [],
      turns: [],
      pricing: usageRate,
      period: "today",
      now,
    });
    expect(data.projects).toEqual([]);
    expect(data.totals).toEqual({
      cost: 0,
      runMs: 0,
      sessions: 0,
      unpricedTokens: 0,
    });
  });
});
