/** Provider rate-limit and overload errors say when the next attempt happens. */

const MAX_RETRY_MS = 24 * 60 * 60 * 1000;
const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
};

function unitMs(unit: string): number | undefined {
  const lower = unit.toLowerCase();
  if (lower === "ms" || lower.startsWith("millisecond")) return UNIT_MS.ms;
  if (lower === "s" || lower.startsWith("sec")) return UNIT_MS.s;
  if (lower === "m" || lower.startsWith("min")) return UNIT_MS.m;
  if (lower === "h" || lower.startsWith("hour")) return UNIT_MS.h;
  return undefined;
}

/** `now + delayMs`, or undefined when the delay is not a usable positive number. */
export function retryAtFromDelay(delayMs: unknown, now: number): number | undefined {
  if (typeof delayMs !== "number" || !Number.isFinite(delayMs) || delayMs <= 0) return undefined;
  return now + Math.min(delayMs, MAX_RETRY_MS);
}

/** Spreads into a status event only when a retry time is known. */
export function retryAtField(retryAt: number | undefined): { retryAt?: number } {
  return retryAt ? { retryAt } : {};
}

/** An absolute epoch-ms (or epoch-seconds) timestamp in the future, else undefined. */
export function retryAtFromTimestamp(value: unknown, now: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const ms = value < 1e11 ? value * 1000 : value;
  return ms > now ? Math.min(ms, now + MAX_RETRY_MS) : undefined;
}

/**
 * Reads a relative wait out of provider error text: "retry-after: 30",
 * "try again in 12s", "retrying in 2 minutes", "retry after 500ms".
 */
export function parseRetryAt(text: string, now: number): number | undefined {
  const header = /retry-after["']?\s*[:=]\s*(\d+(?:\.\d+)?)(?!\d)/i.exec(text);
  if (header) return retryAtFromDelay(Number(header[1]) * 1000, now);
  const phrase =
    /(?:retry(?:ing)?|try again|available again|resets?)\s+(?:in|after)\s+(\d+(?:\.\d+)?)\s*(milliseconds?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|h)\b/i.exec(
      text,
    );
  if (!phrase) return undefined;
  const unit = unitMs(phrase[2]);
  return unit ? retryAtFromDelay(Number(phrase[1]) * unit, now) : undefined;
}
