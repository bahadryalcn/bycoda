import type { QuotaSample } from "../../providers/public/rateLimitHistory";
import type { UsageWindow } from "./usageAnalytics";

/** Matches the 180-bucket DOM bound `effectiveResolution` applies to usage charts. */
export const QUOTA_PLOT_COLUMNS = 180;

/**
 * The plot's time axis: from the first reading in the period (never earlier than the period
 * start) to the period end. History only exists since collection started, so the empty
 * stretch before the first reading is not drawn and no point is invented for it.
 */
export function quotaPlotDomain(
  samples: readonly Pick<QuotaSample, "at">[],
  window: UsageWindow,
): UsageWindow {
  let first = Infinity;
  for (const sample of samples) if (sample.at < first) first = sample.at;
  if (!Number.isFinite(first)) return window;
  const start = Math.min(Math.max(window.start, first), window.end);
  return { start, end: window.end };
}

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

/**
 * Longest stretch between two readings that the line may still bridge. Limits refresh
 * on the order of minutes, so a larger hole means collection was off and the real course
 * is unknown; the line breaks there rather than implying a value.
 */
export const QUOTA_LINE_MAX_GAP_MS = 6 * 3_600_000;
/** Reset times reported for one window drift by seconds; a larger change is a new window. */
const RESET_TOLERANCE_MS = 5 * 60_000;

/**
 * Splits readings into runs of consecutive observations of one account that may be joined
 * by a line. A run ends at a quota reset (the window's reset time changes or the used
 * value falls back) and across gaps over `maxGap`. Only original samples are returned;
 * runs of one reading are dropped because a lone dot has nothing to connect.
 */
export function quotaLineSegments(
  samples: readonly QuotaSample[],
  maxGap = QUOTA_LINE_MAX_GAP_MS,
): QuotaSample[][] {
  const byAccount = new Map<string, QuotaSample[]>();
  for (const sample of samples) {
    const list = byAccount.get(sample.account);
    if (list) list.push(sample);
    else byAccount.set(sample.account, [sample]);
  }
  const segments: QuotaSample[][] = [];
  for (const list of byAccount.values()) {
    list.sort((a, b) => a.at - b.at);
    let run: QuotaSample[] = [];
    for (const sample of list) {
      const prev = run[run.length - 1];
      const reset =
        prev !== undefined &&
        (sample.used < prev.used ||
          (prev.resetsAt != null &&
            sample.resetsAt != null &&
            Math.abs(sample.resetsAt - prev.resetsAt) > RESET_TOLERANCE_MS));
      if (prev !== undefined && (reset || sample.at - prev.at > maxGap)) {
        if (run.length > 1) segments.push(run);
        run = [];
      }
      run.push(sample);
    }
    if (run.length > 1) segments.push(run);
  }
  return segments;
}
