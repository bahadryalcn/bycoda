import type { QuotaSample } from "../../providers/model/rateLimitHistory";
import type { UsageWindow } from "./usageAnalytics";

/** Matches the 180-bucket DOM bound `effectiveResolution` applies to usage charts. */
export const QUOTA_PLOT_COLUMNS = 180;

/**
 * Bounds the limit-history plot to one real reading per account and time column.
 * The latest reading in a column is kept, so the plot never invents or averages
 * values; the review table and legend still use every recorded sample.
 */
export function quotaPlotPoints(
  samples: readonly QuotaSample[],
  window: UsageWindow,
  columns = QUOTA_PLOT_COLUMNS,
): QuotaSample[] {
  const width = window.end - window.start;
  if (samples.length <= columns || width <= 0) return [...samples];
  const picked = new Map<string, QuotaSample>();
  for (const sample of samples) {
    const column = Math.min(
      columns - 1,
      Math.floor(((sample.at - window.start) / width) * columns),
    );
    const key = `${sample.account}:${column}`;
    if (sample.at >= (picked.get(key)?.at ?? -Infinity)) picked.set(key, sample);
  }
  return [...picked.values()].sort((a, b) => a.at - b.at);
}
