import type { UsageBucket, UsageMetric } from "./usageAnalytics";

/**
 * One value per series for every bucket, as drawn by the trend chart.
 * Plain: the bucket's own amount (or its share of the bucket in percent mode).
 * Cumulative: the running total up to and including the bucket (or the share of the running total in percent mode).
 */
export function trendSeriesValues(
  buckets: readonly UsageBucket[],
  keys: readonly string[],
  metric: UsageMetric,
  options: { percent: boolean; cumulative: boolean },
): Record<string, number>[] {
  const running = new Map<string, number>(keys.map((key) => [key, 0]));
  let runningTotal = 0;
  return buckets.map((bucket) => {
    runningTotal += bucket[metric];
    return Object.fromEntries(
      keys.map((key) => {
        const own = bucket.series[key]?.[metric] ?? 0;
        const amount = options.cumulative ? (running.get(key) ?? 0) + own : own;
        running.set(key, amount);
        const whole = options.cumulative ? runningTotal : bucket[metric];
        return [key, options.percent ? (whole ? (amount / whole) * 100 : 0) : amount];
      }),
    );
  });
}
