import { z } from "zod";

/** ISO-8601 UTC timestamp, for example `2026-11-08T10:00:00.000Z`. */
export const IsoDateTime = z.iso.datetime();

/** Calendar day `YYYY-MM-DD` that is a real date. */
export const LocalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [y, m, d] = value.split("-").map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, "not a real calendar date");

/** Wall-clock time `HH:MM` (24 hour). */
export const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** IANA time zone name such as `Europe/Istanbul`. */
export const IanaTimeZone = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "unknown time zone");

export const EntityId = z.string().min(1).max(128);
