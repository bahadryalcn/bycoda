import { previousUsageWindow, type UsageWindow } from "./usageAnalytics";

/**
 * The last usage read that finished, with the lower bound it was read for. Returning to the
 * Usage page shows it at once (marked as refreshing) instead of an empty page and a loader; the
 * page still re-reads. It is used only when the new view asks for the same lower bound, so a
 * different interval never shows another interval's numbers.
 */
let last: { since: number; load: { queryKey: string; refreshedAt: number } } | null = null;

const sinceOf = (interval: UsageWindow) => Math.max(0, previousUsageWindow(interval).start);

/** Remembers a finished read; loads that never completed are ignored. */
export function rememberUsageLoad<T extends { queryKey: string; refreshedAt: number }>(load: T) {
  const since = Number(load.queryKey.split(":")[0]);
  if (load.refreshedAt > 0 && Number.isFinite(since)) last = { since, load };
}

/** The remembered read for `interval`'s lower bound, else `fallback`. */
export function recallUsageLoad<T extends { queryKey: string; refreshedAt: number }>(
  interval: UsageWindow,
  fallback: T,
): T {
  return last && last.since === sinceOf(interval) ? (last.load as T) : fallback;
}

export function clearUsageLoadCache() {
  last = null;
}
