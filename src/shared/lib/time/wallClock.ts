/**
 * Current wall-clock time in epoch milliseconds, for labels that show "N minutes ago".
 * Durations still use `monotonicNow`. Render code calls this instead of `Date.now()` so the
 * impurity lives in one named place.
 */
export function wallClockNow(): number {
  return Date.now();
}
