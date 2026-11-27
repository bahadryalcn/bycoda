import { describe, expect, it } from "vitest";
import {
  QUOTA_PLOT_COLUMNS,
  quotaLineSegments,
  quotaPlotDomain,
  quotaPlotPoints,
} from "./quotaPlotPoints";
import type { QuotaSample } from "../../providers/model/rateLimitHistory";

const sample = (account: string, at: number, used = 1): QuotaSample => ({
  account,
  at,
  kind: "session",
  used,
  minutes: 300,
  resetsAt: null,
});

it("keeps every sample when the plot is already small", () => {
  const rows = [sample("a", 10), sample("a", 11), sample("b", 12)];
  expect(quotaPlotPoints(rows, { start: 0, end: 100 })).toEqual(rows);
});

it("bounds thousands of samples to one latest reading per account and column", () => {
  const rows = Array.from({ length: 6000 }, (_, i) => sample(i % 2 ? "a" : "b", i, i % 100));
  const points = quotaPlotPoints(rows, { start: 0, end: 6000 });
  expect(points.length).toBeLessThanOrEqual(2 * QUOTA_PLOT_COLUMNS);
  expect(points.length).toBeGreaterThan(QUOTA_PLOT_COLUMNS);
  // Real readings only: every plotted point is an original sample object.
  expect(points.every((p) => rows.includes(p))).toBe(true);
  // The newest reading of each account stays on the plot.
  expect(points).toContain(rows[5999]);
  expect(points).toContain(rows[5998]);
  expect(points.map((p) => p.at)).toEqual(points.map((p) => p.at).sort((x, y) => x - y));
});

it("never drops an account whose samples fall in the same column", () => {
  const rows = [
    ...Array.from({ length: 400 }, (_, i) => sample("a", i)),
    sample("b", 5),
    sample("b", 399),
  ];
  const points = quotaPlotPoints(rows, { start: 0, end: 400 });
  expect(points.filter((p) => p.account === "b").map((p) => p.at)).toEqual([5, 399]);
});

it("starts the plot domain at the first reading, never before the period or after its end", () => {
  const window = { start: 0, end: 1000 };
  expect(quotaPlotDomain([sample("a", 700), sample("b", 400)], window)).toEqual({
    start: 400,
    end: 1000,
  });
  // A reading older than the period start does not widen the axis.
  expect(quotaPlotDomain([sample("a", -50)], window)).toEqual(window);
  // No readings: the period itself, nothing invented.
  expect(quotaPlotDomain([], window)).toEqual(window);
});

describe("quotaLineSegments", () => {
  const H = 3_600_000;
  const at = (a: string, t: number, used: number, resetsAt: number | null = null) => ({
    ...sample(a, t, used),
    resetsAt,
  });

  it("joins consecutive readings per account", () => {
    const rows = [at("a", 0, 1), at("b", 1, 5), at("a", H, 2), at("b", 2 * H, 6)];
    const segments = quotaLineSegments(rows);
    expect(segments).toHaveLength(2);
    expect(segments.map((s) => s.map((p) => p.account))).toEqual([
      ["a", "a"],
      ["b", "b"],
    ]);
  });

  it("breaks when the reset time changes or the value falls back", () => {
    const resetBreak = quotaLineSegments([
      at("a", 0, 10, 1000),
      at("a", H, 20, 1000 + 1000),
      at("a", 2 * H, 30, 10 * H),
      at("a", 3 * H, 40, 10 * H),
    ]);
    expect(resetBreak.map((s) => s.length)).toEqual([2, 2]);
    const dropBreak = quotaLineSegments([
      at("a", 0, 50),
      at("a", H, 60),
      at("a", 2 * H, 5),
      at("a", 3 * H, 8),
    ]);
    expect(dropBreak.map((s) => s.length)).toEqual([2, 2]);
  });

  it("breaks across gaps over the limit and drops lone readings", () => {
    const segments = quotaLineSegments([
      at("a", 0, 1),
      at("a", H, 2),
      at("a", 20 * H, 3),
      at("a", 40 * H, 4),
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.map((p) => p.at)).toEqual([0, H]);
  });

  it("returns only original sample objects", () => {
    const rows = [at("a", 0, 1), at("a", H, 2)];
    expect(quotaLineSegments(rows)[0]!.every((p) => rows.includes(p))).toBe(true);
  });
});
