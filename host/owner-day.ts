/**
 * The owner's calendar day as a `YYYY-MM-DD` key.
 *
 * The Host has no stored owner time zone for the assistant and social day
 * limits, so the default zone is the Host process's local zone (the owner's
 * machine). Pass an IANA `timeZone` to key by another zone.
 *
 * Migration note: rows written before this helper used the UTC day
 * (`toISOString().slice(0, 10)`). The key format is unchanged, but for an owner
 * whose zone is not UTC the key now rolls over at local midnight. Readers that
 * must find a pre-existing row on the transition day should also try
 * `legacyUtcDayKey(at)`.
 */

import { isoTimestamp } from "../src/shared/lib/time/timestamps";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string | undefined): Intl.DateTimeFormat {
  const cacheKey = timeZone ?? "";
  let result = formatters.get(cacheKey);
  if (!result) {
    result = new Intl.DateTimeFormat("en-US", {
      ...(timeZone ? { timeZone } : {}),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(cacheKey, result);
  }
  return result;
}

/** The calendar day of `at` (epoch ms) in the owner's time zone, `YYYY-MM-DD`. */
export function ownerDayKey(at: number, timeZone?: string): string {
  const parts = formatter(timeZone).formatToParts(new Date(at));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
}

/** The UTC day key older rows were written under. */
export function legacyUtcDayKey(at: number): string {
  return isoTimestamp(at)?.slice(0, 10) ?? "";
}
