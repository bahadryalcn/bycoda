import { expect, it } from "vitest";
import { QUOTA_PLOT_COLUMNS, quotaPlotPoints } from "./quotaPlotPoints";
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
