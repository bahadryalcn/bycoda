/**
 * Active-minute bitmap helpers. Pure, dependency-free (Intl only), no Buffer or btoa, so they
 * run in browsers, Tauri webviews, Node and React Native.
 *
 * DST: a day always has 1440 slots indexed by local wall-clock minute (hour*60+minute).
 * On a 23h day the skipped hour's slots stay empty; on a 25h day the repeated hour writes
 * into the same slots (OR), so a day can never exceed 1440 minutes. Merging is a bitwise OR,
 * which is idempotent and commutative: re-uploading or merging devices never double counts.
 */
import {
  MINUTES_BASE64_LENGTH,
  MINUTES_BYTES,
  MINUTES_PER_DAY,
  type ActivityDay,
  type ActivitySummary,
  type ActivityTotals,
} from "./activity-schema.ts";

export * from "./activity-schema.ts";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET[i] as string] = i;

export function emptyMinutes(): Uint8Array {
  return new Uint8Array(MINUTES_BYTES);
}

function assertMap(map: Uint8Array): void {
  if (map.length !== MINUTES_BYTES) {
    throw new RangeError(`Minute map must be ${MINUTES_BYTES} bytes, got ${map.length}`);
  }
}

function assertIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= MINUTES_PER_DAY) {
    throw new RangeError(`Minute index out of range: ${index}`);
  }
}

export function encodeMinutes(bits: Uint8Array): string {
  assertMap(bits);
  let out = "";
  for (let i = 0; i < bits.length; i += 3) {
    const n = (bits[i]! << 16) | (bits[i + 1]! << 8) | bits[i + 2]!;
    out +=
      ALPHABET[(n >> 18) & 63]! +
      ALPHABET[(n >> 12) & 63]! +
      ALPHABET[(n >> 6) & 63]! +
      ALPHABET[n & 63]!;
  }
  return out;
}

export function decodeMinutes(base64: string): Uint8Array {
  if (base64.length !== MINUTES_BASE64_LENGTH) {
    throw new RangeError(`Minute map must be ${MINUTES_BASE64_LENGTH} base64 characters`);
  }
  const out = new Uint8Array(MINUTES_BYTES);
  for (let i = 0, o = 0; i < base64.length; i += 4, o += 3) {
    let n = 0;
    for (let j = 0; j < 4; j++) {
      const value = LOOKUP[base64[i + j] as string];
      if (value === undefined) throw new RangeError("Invalid base64 character in minute map");
      n = (n << 6) | value;
    }
    out[o] = (n >> 16) & 255;
    out[o + 1] = (n >> 8) & 255;
    out[o + 2] = n & 255;
  }
  return out;
}

/** Marks a minute active. Mutates and returns `map`. */
export function setMinute(map: Uint8Array, index: number): Uint8Array {
  assertMap(map);
  assertIndex(index);
  map[index >> 3]! |= 1 << (index & 7);
  return map;
}

export function isMinuteSet(map: Uint8Array, index: number): boolean {
  assertMap(map);
  assertIndex(index);
  return (map[index >> 3]! & (1 << (index & 7))) !== 0;
}

export function countMinutes(map: Uint8Array): number {
  assertMap(map);
  let total = 0;
  for (let byte of map) {
    while (byte) {
      byte &= byte - 1;
      total++;
    }
  }
  return total;
}

/** Bitwise OR into a new map. Idempotent, commutative, associative. */
export function mergeMinutes(a: Uint8Array, b: Uint8Array): Uint8Array {
  assertMap(a);
  assertMap(b);
  const out = new Uint8Array(MINUTES_BYTES);
  for (let i = 0; i < MINUTES_BYTES; i++) out[i] = a[i]! | b[i]!;
  return out;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFor(date: Date, timeZone: string): Record<string, number> {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    formatters.set(timeZone, format);
  }
  const parts: Record<string, number> = {};
  for (const part of format.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return parts;
}

/** Local wall-clock minute of day (0..1439) for an instant in the given IANA time zone. */
export function minuteIndexFor(date: Date, timeZone: string): number {
  const parts = partsFor(date, timeZone);
  return (parts.hour! % 24) * 60 + parts.minute!;
}

/** Local calendar date `YYYY-MM-DD` for an instant in the given IANA time zone. */
export function localDateFor(date: Date, timeZone: string): string {
  const { year, month, day } = partsFor(date, timeZone);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const DAY_MS = 86_400_000;

function toUtcMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Calendar arithmetic on `YYYY-MM-DD` strings (no time zone involved). */
export function addDays(date: string, days: number): string {
  return fromUtcMs(toUtcMs(date) + days * DAY_MS);
}

/** Monday of the ISO week containing `date`. */
export function isoWeekStart(date: string): string {
  const weekday = (new Date(toUtcMs(date)).getUTCDay() + 6) % 7;
  return addDays(date, -weekday);
}

export interface SummarizeOptions {
  /** The caller's current local date (`YYYY-MM-DD`) or an instant converted with `timeZone`. */
  today: string | Date;
  timeZone: string;
  /** Include a per-device breakdown. */
  perDevice?: boolean;
}

function totalsFor(byDate: Map<string, Uint8Array>, today: string): ActivityTotals {
  const weekStart = isoWeekStart(today);
  const weekEnd = addDays(weekStart, 6);
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  const totals = { today: 0, week: 0, month: 0, year: 0 };
  for (const [date, map] of byDate) {
    const count = countMinutes(map);
    if (date === today) totals.today += count;
    if (date >= weekStart && date <= weekEnd) totals.week += count;
    if (date.startsWith(month)) totals.month += count;
    if (date.startsWith(year)) totals.year += count;
  }
  return totals;
}

function mergeByDate(days: readonly ActivityDay[]): Map<string, Uint8Array> {
  const byDate = new Map<string, Uint8Array>();
  for (const day of days) {
    const decoded = decodeMinutes(day.minutes);
    const existing = byDate.get(day.date);
    byDate.set(day.date, existing ? mergeMinutes(existing, decoded) : decoded);
  }
  return byDate;
}

/**
 * Totals over all given days. Entries for the same date (several devices) are OR-merged
 * first, so two devices open at once count each minute once. A day's `date` is already local,
 * so `timeZone` only converts `today` when it is a Date. Weeks start on Monday (ISO).
 */
export function summarize(
  days: readonly ActivityDay[],
  options: SummarizeOptions,
): ActivitySummary {
  const today =
    typeof options.today === "string"
      ? options.today
      : localDateFor(options.today, options.timeZone);
  const merged = mergeByDate(days);
  const summary: ActivitySummary = {
    ...totalsFor(merged, today),
    last7Days: [],
  };
  for (let offset = 6; offset >= 0; offset--) {
    const date = addDays(today, -offset);
    const map = merged.get(date);
    summary.last7Days.push({ date, minutes: map ? countMinutes(map) : 0 });
  }
  const monthTotals = new Map<string, number>();
  for (const [date, map] of merged) {
    const key = date.slice(0, 7);
    monthTotals.set(key, (monthTotals.get(key) ?? 0) + countMinutes(map));
  }
  summary.last12Months = [];
  const year = Number(today.slice(0, 4));
  const monthIndex = Number(today.slice(5, 7)) - 1;
  for (let offset = 11; offset >= 0; offset--) {
    const total = year * 12 + monthIndex - offset;
    const month = `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`;
    summary.last12Months.push({ month, minutes: monthTotals.get(month) ?? 0 });
  }
  if (options.perDevice) {
    const ids = [...new Set(days.map((day) => day.deviceId))].sort();
    summary.perDevice = ids.map((deviceId) => ({
      deviceId,
      ...totalsFor(mergeByDate(days.filter((day) => day.deviceId === deviceId)), today),
    }));
  }
  return summary;
}
