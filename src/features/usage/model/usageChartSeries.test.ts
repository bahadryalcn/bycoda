import { expect, it } from "vitest";
import type { UsageBucket } from "./usageAnalytics";
import { trendSeriesValues } from "./usageChartSeries";

const bucket = (cost: number, a: number, b: number): UsageBucket =>
  ({
    key: String(cost),
    start: 0,
    end: 1,
    tokens: 0,
    cost,
    series: { a: { tokens: 0, cost: a }, b: { tokens: 0, cost: b } },
  }) as unknown as UsageBucket;
const buckets = [bucket(3, 1, 2), bucket(4, 4, 0), bucket(0, 0, 0)];

it("keeps exact per-bucket values for the plain chart", () => {
  expect(
    trendSeriesValues(buckets, ["a", "b"], "cost", { percent: false, cumulative: false }),
  ).toEqual([
    { a: 1, b: 2 },
    { a: 4, b: 0 },
    { a: 0, b: 0 },
  ]);
});

it("accumulates each series across buckets and never decreases", () => {
  expect(
    trendSeriesValues(buckets, ["a", "b"], "cost", { percent: false, cumulative: true }),
  ).toEqual([
    { a: 1, b: 2 },
    { a: 5, b: 2 },
    { a: 5, b: 2 },
  ]);
});

it("shows percent shares of the bucket, or of the running total when cumulative", () => {
  const plain = trendSeriesValues(buckets, ["a", "b"], "cost", {
    percent: true,
    cumulative: false,
  });
  expect(plain[0]!.a).toBeCloseTo(33.33, 1);
  expect(plain[2]).toEqual({ a: 0, b: 0 });
  const running = trendSeriesValues(buckets, ["a", "b"], "cost", {
    percent: true,
    cumulative: true,
  });
  expect(running[1]!.a).toBeCloseTo((5 / 7) * 100, 5);
  expect(running[1]!.b).toBeCloseTo((2 / 7) * 100, 5);
});
