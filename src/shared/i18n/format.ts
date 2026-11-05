/**
 * Locale-aware formatters for values every surface shows: relative time, byte sizes and
 * durations. Features used to carry their own copies (three `formatRelativeTime`s, two byte
 * formatters, about ten duration helpers), each with a different rounding and most of them
 * English-only. The general helpers follow the app language like `formatDate` /
 * `formatNumber` in core.ts. Compatibility helpers retain each surface's existing
 * locale, rounding, units and invalid-input contract.
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

/** Compact elapsed label with the historic one-second minimum. */
export function formatElapsed(elapsedMs: number | null): string | null {
  if (elapsedMs == null) return null;
  const totalSec = Math.max(1, Math.round(elapsedMs / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

/** Compact count using the requested locale, or the runtime default when omitted. */
export function formatCompactCount(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(Math.max(0, Math.round(value)));
}

/** Import history keeps the runtime's invalid-date label and the selected app locale. */
export function formatImportDate(at: number): string {
  if (!at) return "unknown date";
  return new Date(at).toLocaleDateString(getLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Archived records retain the runtime locale and an empty label for invalid dates. */
export function formatArchiveDate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

export function formatResetDuration(ms: number): string {
  if (ms <= 0) return "now";
  const totalMins = Math.floor(ms / 60_000);
  if (totalMins < 60) return `${totalMins}m`;
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  }
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export function formatUsageTokens(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

export function formatGithubRelativeTime(iso: string, now = Date.now(), locale?: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const delta = Math.round((then - now) / 1000);
  const abs = Math.abs(delta);
  const divisions: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.34524, "week"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ];
  let value = delta;
  let unit: Intl.RelativeTimeFormatUnit = "second";
  let amount = abs;
  for (const [step, next] of divisions) {
    unit = next;
    if (amount < step) break;
    value = Math.round(value / step);
    amount = Math.abs(value);
  }
  try {
    return relativeTimeFormat(locale, { numeric: "auto" }).format(value, unit);
  } catch {
    return "";
  }
}

export function formatImportBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatAttachmentSize(size: number): string | null {
  if (!Number.isFinite(size) || size <= 0) return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTokens(count: number): string {
  if (!Number.isFinite(count) || count < 0) return "0";
  if (count < 1000) return String(Math.round(count));
  if (count < 1_000_000) {
    const thousands = count / 1000;
    return `${thousands < 10 ? thousands.toFixed(1).replace(/\.0$/, "") : Math.round(thousands)}K`;
  }
  const millions = count / 1_000_000;
  return `${millions < 10 ? millions.toFixed(1).replace(/\.0$/, "") : Math.round(millions)}M`;
}

export function formatLiveElapsed(startedAt: number, now: number): string {
  const seconds = Math.max(1, Math.round((now - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const minRest = minutes % 60;
  return minRest ? `${hours}h ${minRest}m` : `${hours}h`;
}

export function formatRecentRelative(value: number, now: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const seconds = Math.max(0, Math.round((now - value) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

export function formatChatDate(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function formatMinutes(minutes: number): string {
  return minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60}-hour` : `${minutes}-minute`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size < 10 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`;
}

export function formatMediaDuration(duration: number | undefined): string | null {
  if (duration === undefined || !Number.isFinite(duration) || duration <= 0) return null;
  const seconds = Math.floor(duration);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const remainder = String(seconds % 60).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}`
    : `${minutes}:${remainder}`;
}

export function formatGitGraphRelativeTime(timestampSeconds: number, nowMs: number): string {
  const age = Math.max(0, Math.floor(nowMs / 1000 - timestampSeconds));
  const minute = 60;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (age < minute) return "now";
  if (age < hour) return `${Math.floor(age / minute)}m`;
  if (age < day) return `${Math.floor(age / hour)}h`;
  const days = Math.floor(age / day);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.max(1, Math.floor(days / 30.44))}mo`;
  return `${Math.floor(days / 365)}y`;
}

export function formatGitGraphAbsoluteTime(
  timestampSeconds: number,
  locale?: string,
  timeZone?: string,
): string {
  return new Date(timestampSeconds * 1000).toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
}

export function formatCooldown(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
