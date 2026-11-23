import { describe, expect, it } from "vitest";
import type { AccountUsage, UsageRow } from "../../providers/model/providerUsage";
import {
  emptyUsageFilters,
  filterUsage,
  usageSamples,
  usageTotals,
  type UsageTurnReport,
} from "./usageAnalytics";
import {
  buildUsageReport,
  type UsageReport,
  type UsageReportFailure,
  type UsageReportInput,
  type UsageReportRequest,
} from "./usageReport";
import { usageIntentFor } from "./usageViewIntent";
import { usagePresetWindow } from "./usageWindows";

const now = new Date(2026, 10, 23, 12, 7).getTime();
const slot = (...at: [number, number, number, number?, number?]) =>
  new Date(at[0], at[1], at[2], at[3] ?? 0, at[4] ?? 0).getTime() / 1000;
const pricing = (model: string) =>
  model.startsWith("known") ? { input: 1, output: 5, cacheRead: 0.1 } : null;
const row = (at: number, model: string, project: string, input = 100, output = 20): UsageRow => ({
  slot: at,
  model,
  project,
  input,
  output,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
});
const account = (provider: "codex" | "claude", id: string, rows: UsageRow[]): AccountUsage => ({
  account: { id, provider, label: id, color: "blue", isDefault: false },
  rows,
});
const usage = (): AccountUsage[] => [
  account("codex", "work", [
    row(slot(2026, 10, 3, 9), "known-a", "/work/app"),
    row(slot(2026, 10, 4, 9), "unknown-b", "/work/app", 10, 5),
    row(slot(2026, 10, 5, 9), "known-a", "/work/other"),
    row(slot(2026, 9, 31, 23, 45), "known-a", "/work/app", 1000, 0),
    row(slot(2026, 10, 1, 0, 0), "known-a", "/work/app", 7, 0),
    row(slot(2026, 9, 28, 9), "known-a", "/secret/vault", 5000, 0),
  ]),
  account("claude", "main", [row(slot(2026, 10, 6, 9), "known-a", "/work/app", 40, 10)]),
];
const turns: UsageTurnReport = {
  truncated: false,
  turns: [
    {
      sessionId: "s",
      title: "Session",
      project: "/work/app",
      provider: "codex",
      accountId: "work",
      model: "known-a",
      startedAt: new Date(2026, 10, 3, 9).getTime(),
      durationMs: 600_000,
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  ],
};

function build(
  request: Partial<UsageReportRequest> & Pick<UsageReportRequest, "period">,
  override: Partial<UsageReportInput> = {},
) {
  return buildUsageReport({
    usage: usage(),
    turns,
    pricing,
    groupFor: () => null,
    isLocked: (path) => path.startsWith("/secret"),
    accountsFailed: 0,
    now,
    request: { metric: "tokens", ...request },
    ...override,
  });
}
const ok = (value: UsageReport | UsageReportFailure): UsageReport => {
  if ("error" in value) throw new Error(value.error);
  return value;
};

describe("usage report", () => {
  it("matches the dashboard pipeline for totals, providers and models", () => {
    const report = ok(build({ period: "last-30-days" }));
    const window = usagePresetWindow("30d", now);
    const dashboard = filterUsage(
      usageSamples(
        usage().map(({ account: item, rows }) => ({
          account: item,
          rows: rows.filter((entry) => !entry.project.startsWith("/secret")),
        })),
        pricing,
        () => null,
      ),
      emptyUsageFilters(),
      window,
    );
    const expected = usageTotals(dashboard);
    expect(report.window.startMs).toBe(window.start);
    expect(report.window.endMs).toBe(window.end);
    expect(report.totals).toMatchObject({
      tokens: expected.tokens,
      cost: expected.cost,
      input: expected.input,
      output: expected.output,
      durationMs: 600_000,
      unpricedTokens: 15,
    });
    // 1000 (Oct 31 23:45) and 7 (Nov 1) and 120, 15, 120, 50 in the window; the locked vault is absent.
    expect(report.totals.tokens).toBe(1000 + 7 + 120 + 15 + 120 + 50);
    expect(report.providers.map((item) => [item.key, item.tokens])).toEqual([
      ["codex", 1262],
      ["claude", 50],
    ]);
    expect(report.providers.reduce((sum, item) => sum + item.tokens, 0)).toBe(report.totals.tokens);
    expect(report.models.map((item) => item.key)).toEqual(["known-a", "unknown-b"]);
    expect(JSON.stringify(report)).not.toContain("vault");
  });

  it("starts month-to-date at local midnight of the first and excludes the previous month", () => {
    const report = ok(build({ period: "month-to-date" }));
    expect(report.window.startMs).toBe(new Date(2026, 10, 1).getTime());
    // The Oct 31 23:45 row is out; the Nov 1 00:00 row is in.
    expect(report.totals.tokens).toBe(7 + 120 + 15 + 120 + 50);
    expect(report.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("reports calendar months whose totals add up to the whole span", () => {
    const report = ok(build({ period: "monthly-history", months: 2 }));
    expect(report.months?.map((month) => month.key)).toEqual(["2026-10", "2026-11"]);
    expect(report.months?.[0]).toMatchObject({ partial: false, tokens: 1000 });
    expect(report.months?.[1]).toMatchObject({ partial: true, tokens: 7 + 120 + 15 + 120 + 50 });
    expect(report.months?.[0].endMs).toBe(report.months?.[1].startMs);
    expect(report.months?.reduce((sum, month) => sum + month.tokens, 0)).toBe(report.totals.tokens);
  });

  it("keeps locked and restricted projects out, even when asked for by path", () => {
    const only = ok(build({ period: "last-30-days", projectPath: "/work/other" }));
    expect(only.totals.tokens).toBe(120);
    expect(only.filters.project).toBeTruthy();
    expect(only.coverage.notes).toContain("project-restricted");
    const locked = ok(build({ period: "last-30-days", projectPath: "/secret/vault" }));
    expect(locked.totals.tokens).toBe(0);
    expect(locked.coverage.notes).toContain("no-data");
  });

  it("resolves provider and model filters like the dashboard and rejects unknown ones", () => {
    const report = ok(build({ period: "last-30-days", provider: "CLAUDE", model: "known-a" }));
    expect(report.totals.tokens).toBe(50);
    expect(report.filters).toEqual({ provider: "claude", model: "known-a" });
    expect(build({ period: "last-30-days", provider: "grok" })).toMatchObject({
      error: "unknown-filter",
      dimension: "provider",
      available: ["claude", "codex"],
    });
  });

  it("merges one model used through several accounts and bounds the tail with exact sums", () => {
    const wide = [
      account(
        "codex",
        "work",
        Array.from({ length: 15 }, (_, n) =>
          row(slot(2026, 10, 3, 9), `known-m${n}`, "/work/app", n + 1, 0),
        ),
      ),
      account("claude", "main", [row(slot(2026, 10, 3, 9), "known-m0", "/work/app", 100, 0)]),
    ];
    const report = ok(build({ period: "month-to-date" }, { usage: wide, turns: null }));
    expect(report.models).toHaveLength(12);
    const other = report.models[11];
    expect(other).toMatchObject({ key: "other", grouped: 4 });
    expect(report.models.reduce((sum, item) => sum + item.tokens, 0)).toBe(report.totals.tokens);
    expect(report.models.find((item) => item.key === "known-m0")?.tokens).toBe(101);
    expect(report.coverage.notes).toContain("other-grouped");
  });

  it("discloses unreadable accounts, missing or truncated turns and an empty window", () => {
    const partial = ok(build({ period: "last-30-days" }, { accountsFailed: 1, turns: null }));
    expect(partial.coverage).toMatchObject({
      partial: true,
      accounts: { read: 1, failed: 1 },
      sessionTurns: "unavailable",
    });
    expect(partial.coverage.notes).toEqual(
      expect.arrayContaining([
        "accounts-unreadable",
        "session-turns-unavailable",
        "unpriced-tokens",
      ]),
    );
    expect(
      ok(build({ period: "last-30-days" }, { turns: { turns: [], truncated: true } })).coverage
        .sessionTurns,
    ).toBe("truncated");
    const empty = ok(
      build({ period: "last-30-days" }, { usage: [], turns: { turns: [], truncated: false } }),
    );
    expect(empty.coverage).toMatchObject({ partial: false, notes: ["no-data"] });
    expect(empty.providers).toEqual([]);
  });

  it("builds a dashboard intent with the same window, filters, metric and granularity", () => {
    const report = ok(
      build({ period: "monthly-history", months: 2, provider: "codex", metric: "cost" }),
    );
    expect(usageIntentFor(report)).toEqual({
      preset: "custom",
      window: { start: report.window.startMs, end: report.window.endMs },
      filters: { ...emptyUsageFilters(), provider: ["codex"] },
      metric: "cost",
      resolution: "week",
    });
    const recent = usageIntentFor(ok(build({ period: "last-30-days" })));
    expect(recent).toMatchObject({ preset: "30d", resolution: "day", metric: "tokens" });
  });
});
