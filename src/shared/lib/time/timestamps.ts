/**
 * Time helpers that encode two invariants:
 *
 * 1. Rendering a stored timestamp must never throw. `new Date(x).toISOString()` raises a
 *    RangeError for `NaN`, `undefined` or a malformed string, and a throw inside a component
 *    takes the whole React tree down. `isoTimestamp` returns `undefined` instead.
 * 2. Durations are measured on the monotonic clock. `Date.now()` jumps across system sleep,
 *    NTP corrections and manual clock changes, so a "20 minute run limit" computed from wall
 *    time cancels a run the moment the laptop wakes. `monotonicNow` / `elapsedSince` do not
 *    advance while the process is suspended on most platforms and never go backwards.
 */

export type TimestampInput = number | string | Date | null | undefined;

/** `Date` for a stored timestamp, or `undefined` when it cannot be parsed. */
export function parseTimestamp(value: TimestampInput): Date | undefined {
  if (value == null || value === "") return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** ISO 8601 text for `dateTime=` attributes and logs; `undefined` for invalid input. */
export function isoTimestamp(value: TimestampInput): string | undefined {
  return parseTimestamp(value)?.toISOString();
}

/** UTC calendar day (YYYY-MM-DD) of a timestamp; empty when it cannot be parsed. */
export const utcDay = (at: TimestampInput): string => isoTimestamp(at)?.slice(0, 10) ?? "";

/** Milliseconds on a monotonic clock; only differences between two readings are meaningful. */
export function monotonicNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/** Milliseconds elapsed since a `monotonicNow()` reading; never negative. */
export function elapsedSince(startedAt: number, now = monotonicNow()): number {
  return Math.max(0, now - startedAt);
}

/**
 * How much wall-clock time passed beyond what a periodic tick expected. A large value means
 * the process was suspended (sleep) or the clock jumped; schedulers use it to skip missed
 * occurrences instead of firing them all at once.
 */
export function wallClockGap(previousTickAt: number, now: number, intervalMs: number): number {
  return Math.max(0, now - previousTickAt - intervalMs);
}
