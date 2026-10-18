import { describe, expect, it } from "vitest";
import {
  durationSamples,
  bucketStart,
  nextBucket,
  effectiveResolution,
  emptyUsageFilters,
  filterUsage,
  previousUsageWindow,
  sessionUsage,
  usageBreakdown,
  usageBuckets,
  usageCsv,
  usageSamples,
  usageTotals,
  type UsageTurn,
} from "./usageAnalytics";
import type { AccountUsage } from "../../providers/model/providerUsage";
const start = new Date(2026, 9, 18, 14).getTime();
const window = { start, end: start + 3_600_000 };
const pricing = (model: string) =>
  model === "known" ? { input: 1, output: 5, cacheRead: 0.1 } : null;
const groupFor = () => null;
function accounts(): AccountUsage[] {
  return [
    {
      account: { id: "work", provider: "codex", label: "Work", color: "blue", isDefault: false },
      rows: [
        {
          slot: start / 1000,
          model: "known",
          project: "/work/app",
          input: 100,
          output: 20,
          cacheRead: 30,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
        },
        {
          slot: (start + 900_000) / 1000,
          model: "unknown",
          project: "/work/app",
          input: 10,
          output: 5,
          cacheRead: 0,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
        },
        {
          slot: window.end / 1000,
          model: "known",
          project: "/work/other",
          input: 999,
          output: 0,
          cacheRead: 0,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
        },
      ],
    },
  ];
}
const turn: UsageTurn = {
  sessionId: "s",
  title: "Session",
  project: "/work/app",
  provider: "codex",
  accountId: "work",
  model: "known",
  startedAt: start,
  durationMs: 900_000,
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 30,
  cacheWriteTokens: 0,
};

describe("usage analysis contracts", () => {
  it("filters exact same-day intervals with an exclusive end and preserves unpriced tokens", () => {
    const samples = filterUsage(
      usageSamples(accounts(), pricing, groupFor),
      emptyUsageFilters(),
      window,
    );
    expect(samples).toHaveLength(2);
    expect(usageTotals(samples)).toMatchObject({
      tokens: 165,
      input: 110,
      output: 25,
      cacheRead: 30,
    });
    expect(samples[1].priced).toBe(false);
    expect(
      usageTotals(
        usageBuckets(
          usageSamples(accounts(), pricing, groupFor),
          window,
          "day",
          "provider",
          "tokens",
        ).buckets,
      ).tokens,
    ).toBe(165);
    expect(
      sessionUsage(
        [{ ...turn, startedAt: start - 1000, durationMs: 1000 }],
        window,
        emptyUsageFilters(),
        pricing,
        groupFor,
      ),
    ).toHaveLength(0);
    expect(usageBreakdown(samples, "project", "tokens")[0].unpricedTokens).toBe(15);
    const filters = { ...emptyUsageFilters(), account: ["codex:personal"] };
    expect(filterUsage(samples, filters, window)).toHaveLength(0);
  });
  it("reconciles buckets, ranked series, categories and totals, including other models", () => {
    const usage = accounts();
    usage[0].rows.push(
      ...Array.from({ length: 8 }, (_, n) => ({ ...usage[0].rows[0], model: `model-${n}` })),
    );
    const samples = filterUsage(
      usageSamples(usage, pricing, groupFor),
      emptyUsageFilters(),
      window,
    );
    const chart = usageBuckets(samples, window, "15m", "model", "tokens");
    expect(chart.buckets).toHaveLength(4);
    expect(chart.series).toHaveLength(6);
    expect(usageTotals(chart.buckets)).toEqual(usageTotals(samples));
    for (const bucket of chart.buckets)
      expect(usageTotals(Object.values(bucket.series))).toMatchObject({
        tokens: bucket.tokens,
        cost: bucket.cost,
      });
  });
  it("clips runtime across quarter-hour boundaries without losing overlapping agent time", () => {
    const turns = [
      { ...turn, startedAt: start - 1000, durationMs: 901_001 },
      { ...turn, sessionId: "parallel", durationMs: 1000 },
      { ...turn, sessionId: "live", durationMs: null },
    ];
    const samples = durationSamples(turns, window, emptyUsageFilters(), groupFor);
    expect(usageTotals(samples).duration).toBe(901_001);
    expect(samples.every((s) => s.at >= window.start && s.at < window.end)).toBe(true);
    expect(
      usageTotals(usageBuckets(samples, window, "15m", "provider", "duration").buckets).duration,
    ).toBe(901_001);
  });
  it("normalizes Codex inclusive cached input, keeps session totals separate and excludes partial turns", () => {
    const rows = sessionUsage([turn], window, emptyUsageFilters(), pricing, groupFor);
    expect(rows[0]).toMatchObject({
      input: 70,
      cacheRead: 30,
      output: 20,
      tokens: 120,
      timedTurns: 1,
      meteredTurns: 1,
    });
    expect(
      sessionUsage(
        [{ ...turn, provider: "claude" }],
        window,
        emptyUsageFilters(),
        pricing,
        groupFor,
      )[0].tokens,
    ).toBe(150);
    expect(
      sessionUsage(
        [{ ...turn, startedAt: start - 1000 }],
        window,
        emptyUsageFilters(),
        pricing,
        groupFor,
      )[0],
    ).toMatchObject({ duration: 899_000, meteredTurns: 0 });
    expect(
      sessionUsage(
        [{ ...turn, durationMs: null }],
        window,
        emptyUsageFilters(),
        pricing,
        groupFor,
      )[0],
    ).toMatchObject({ timedTurns: 0, meteredTurns: 0 });
  });
  it("bounds chronological chart density without changing the interval and compares equal periods", () => {
    expect(effectiveResolution(window, "15m")).toBe("15m");
    expect(effectiveResolution({ start, end: start + 90 * 86_400_000 }, "15m")).toBe("day");
    expect(previousUsageWindow(window)).toEqual({ start: start - 3_600_000, end: start });
  });
  it("keeps repeated daylight-saving hours separate and advances calendar days correctly", () => {
    const original = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const first = Date.parse("2026-11-01T05:15:00Z");
      const repeated = Date.parse("2026-11-01T06:15:00Z");
      expect(bucketStart(repeated, "hour") - bucketStart(first, "hour")).toBe(3_600_000);
      const day = new Date(2026, 2, 8).getTime();
      expect(nextBucket(day, "day") - day).toBe(23 * 3_600_000);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
  it("combines long chart histories without dropping values and distinguishes missing token sources", () => {
    const broad = { start: new Date(2010, 0, 1).getTime(), end: window.end };
    const logs = filterUsage(
      usageSamples(accounts(), pricing, groupFor),
      emptyUsageFilters(),
      window,
    );
    const runtime = durationSamples([turn], window, emptyUsageFilters(), groupFor);
    const chart = usageBuckets([...logs, ...runtime], broad, "week", "provider", "cost");
    expect(chart.buckets.length).toBeLessThanOrEqual(181);
    expect(usageTotals(chart.buckets)).toEqual(usageTotals([...logs, ...runtime]));
    expect(usageBreakdown(runtime, "provider", "duration")[0]).toMatchObject({
      logSamples: 0,
      timedSamples: 1,
    });
    expect(
      sessionUsage(
        [{ ...turn, provider: "claude", cacheWriteTokens: 20 }],
        window,
        emptyUsageFilters(),
        pricing,
        groupFor,
      )[0],
    ).toMatchObject({ unpricedTurns: 1, cacheWrite: 20 });
  });
  it.each([
    ["America/New_York", 2026, 2, 8, 23],
    ["America/New_York", 2026, 10, 1, 25],
    ["Australia/Lord_Howe", 2026, 9, 4, 23.5],
    ["Australia/Lord_Howe", 2026, 3, 5, 24.5],
  ] as const)(
    "conserves every sample across %s %s/%s/%s (%s hours)",
    (zone, year, month, day, hours) => {
      const original = process.env.TZ;
      process.env.TZ = zone;
      try {
        const window = {
          start: new Date(year, month, day).getTime(),
          end: new Date(year, month, day + 1).getTime(),
        };
        expect(window.end - window.start).toBe(hours * 3_600_000);
        const template = { ...usageSamples(accounts(), pricing, groupFor)[0], cost: 1 };
        const samples = Array.from({ length: hours * 60 }, (_, n) => ({
          ...template,
          at: window.start + n * 60_000 + 123,
        }));
        const { buckets } = usageBuckets(samples, window, "hour", "provider", "tokens");
        expect(usageTotals(buckets)).toEqual(usageTotals(samples));
        expect(buckets[0].start).toBe(window.start);
        expect(buckets.at(-1)?.end).toBe(window.end);
        for (const [index, bucket] of buckets.entries()) {
          expect(bucket.end).toBeGreaterThan(bucket.start);
          if (index) expect(bucket.start).toBe(buckets[index - 1].end);
          expect(usageTotals(Object.values(bucket.series))).toEqual(usageTotals([bucket]));
          const contained = samples.filter((s) => s.at >= bucket.start && s.at < bucket.end);
          expect(usageTotals(contained)).toEqual(usageTotals([bucket]));
          expect(contained.every((s) => bucketStart(s.at, "hour") === bucket.start)).toBe(true);
        }
      } finally {
        if (original === undefined) delete process.env.TZ;
        else process.env.TZ = original;
      }
    },
  );
  it("retains the reported 123-token Lord Howe sample in a partial chart window", () => {
    const original = process.env.TZ;
    process.env.TZ = "Australia/Lord_Howe";
    try {
      const window = {
        start: Date.parse("2026-04-04T13:00:00Z"),
        end: Date.parse("2026-04-04T18:00:00Z"),
      };
      const sample = {
        ...usageSamples(accounts(), pricing, groupFor)[0],
        at: Date.parse("2026-04-04T15:15:00Z"),
        tokens: 123,
      };
      const chart = usageBuckets([sample], window, "hour", "provider", "tokens");
      expect(usageTotals(chart.buckets).tokens).toBe(123);
      const row = chart.buckets.find((bucket) => bucket.tokens > 0)!;
      expect(row.start).toBe(Date.parse("2026-04-04T15:00:00Z"));
      expect(row.end).toBe(Date.parse("2026-04-04T15:30:00Z"));
      expect(usageTotals(chart.series).tokens).toBe(123);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
  it("quotes CSV names and prevents spreadsheet formula evaluation", () => {
    const rows = usageBreakdown(usageSamples(accounts(), pricing, groupFor), "model", "tokens");
    rows[0].label = '=HYPERLINK("private")';
    expect(usageCsv(rows)).toContain('"\'=HYPERLINK(""private"")"');
  });
});
