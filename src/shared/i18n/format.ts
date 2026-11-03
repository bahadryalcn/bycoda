/**
 * Locale-aware formatters for values every surface shows: relative time, byte sizes and
 * durations. Features used to carry their own copies (three `formatRelativeTime`s, two byte
 * formatters, about ten duration helpers), each with a different rounding and most of them
 * English-only. These follow the app language like `formatDate` / `formatNumber` in core.ts.
 *
 * Components that must re-render on language change read the locale through `useLocale()`
 * and pass it in; module-level callers may omit it.
 */
import { relativeTimeFormat } from "../lib/intl";
import { getLocale, t } from "./core";
import type { Locale } from "./languages";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30.44 * DAY;
const YEAR = 365.25 * DAY;

export type RelativeTimeOptions = {
  locale?: Locale;
  /** `"long"` → "3 minutes ago"; `"short"` → "3 min. ago"; `"narrow"` → "3m ago". */
  style?: Intl.RelativeTimeFormatStyle;
  /** Reference instant; defaults to the current wall clock. */
  now?: number;
};

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", YEAR],
  ["month", MONTH],
  ["week", WEEK],
  ["day", DAY],
  ["hour", HOUR],
  ["minute", MINUTE],
];

/**
 * "2 hours ago", "in 3 days", "yesterday" for a stored instant. Values within a minute read
 * as "now" so live lists do not flicker through "1 second ago".
 */
export function formatRelativeTime(
  value: number | Date,
  { locale = getLocale(), style = "long", now = Date.now() }: RelativeTimeOptions = {},
): string {
  const at = value instanceof Date ? value.getTime() : value;
  if (!Number.isFinite(at)) return "";
  const delta = at - now;
  const magnitude = Math.abs(delta);
  if (magnitude < MINUTE) return t("now");
  const format = relativeTimeFormat(locale, { numeric: "auto", style });
  for (const [unit, size] of RELATIVE_UNITS)
    if (magnitude >= size) return format.format(Math.round(delta / size), unit);
  return format.format(Math.round(delta / MINUTE), "minute");
}

export type ByteFormatOptions = {
  locale?: Locale;
  /** Binary (1024, default) or decimal (1000) steps. */
  base?: 1024 | 1000;
};

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
const numberFormats = new Map<string, Intl.NumberFormat>();
function numberFormat(locale: Locale, digits: number): Intl.NumberFormat {
  const key = `${locale}:${digits}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, {
      maximumFractionDigits: digits,
      minimumFractionDigits: 0,
    });
    numberFormats.set(key, format);
  }
  return format;
}

/** "512 B", "1.5 MB", "12 GB": one decimal below 10 units, whole numbers above. */
export function formatBytes(
  bytes: number,
  { locale = getLocale(), base = 1024 }: ByteFormatOptions = {},
): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  let value = bytes;
  let index = 0;
  while (value >= base && index < BYTE_UNITS.length - 1) {
    value /= base;
    index++;
  }
  const digits = index === 0 ? 0 : value < 10 ? 1 : 0;
  return `${numberFormat(locale, digits).format(value)} ${BYTE_UNITS[index]}`;
}

export type DurationFormatOptions = {
  /** `"compact"` → "1h 05m", "42s"; `"clock"` → "1:05:09", "0:42". */
  style?: "compact" | "clock";
};

/** Elapsed or remaining time for labels, from milliseconds. Negative input reads as zero. */
export function formatDuration(
  ms: number,
  { style = "compact" }: DurationFormatOptions = {},
): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / SECOND));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  const two = (value: number) => String(value).padStart(2, "0");
  if (style === "clock")
    return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
  if (hours > 0) return t("{p0}h {p1}m", { p0: hours, p1: two(minutes) });
  if (minutes > 0) return t("{p0}m {p1}s", { p0: minutes, p1: two(seconds) });
  return t("{p0}s", { p0: seconds });
}
