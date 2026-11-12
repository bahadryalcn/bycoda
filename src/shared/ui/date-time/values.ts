export type DateTimeMode = "date" | "time" | "datetime";
export type DateRange = { start: Date; end: Date };
const pad = (part: number) => String(part).padStart(2, "0");

export function toLocalDateTime(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export const dateKey = (date: Date) => toLocalDateTime(date).slice(0, 10);

export function parseLocalDateTime(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && toLocalDateTime(date) === value ? date : null;
}
export function parseLocalDate(value: string): Date | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseLocalDateTime(`${value}T12:00`) : null;
}
export function parseLocalTime(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}
export const timeKey = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
export function isLocalDateTimeValue(value: string, mode: DateTimeMode): boolean {
  return mode === "date"
    ? !!parseLocalDate(value)
    : mode === "time"
      ? parseLocalTime(value) !== null
      : !!parseLocalDateTime(value);
}
export function clampValue(value: string, mode: DateTimeMode, min?: string, max?: string): string {
  if (!isLocalDateTimeValue(value, mode)) return value;
  if (mode === "datetime") {
    if (min?.length === 10) min += "T00:00";
    if (max?.length === 10) max += "T23:59";
  }
  if (min && isLocalDateTimeValue(min, mode) && value < min) return min;
  if (max && isLocalDateTimeValue(max, mode) && value > max) return max;
  return value;
}
export function shiftMonth(date: Date, amount: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth() + amount,
    Math.min(
      date.getDate(),
      new Date(date.getFullYear(), date.getMonth() + amount + 1, 0).getDate(),
    ),
    12,
  );
}
export function addDays(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount, 12);
}
export function gridDestination(date: Date, key: string, weekStart: number): Date | null {
  const offset = (date.getDay() - weekStart + 7) % 7;
  const offsets: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -7,
    ArrowDown: 7,
    Home: -offset,
    End: 6 - offset,
  };
  if (key === "PageUp" || key === "PageDown") return shiftMonth(date, key === "PageUp" ? -1 : 1);
  return key in offsets ? addDays(date, offsets[key]) : null;
}
export function orderedRange(start: Date, end: Date): DateRange {
  return start <= end ? { start, end } : { start: end, end: start };
}
export function formatValue(
  value: string,
  mode: DateTimeMode,
  format: (date: Date, options: Intl.DateTimeFormatOptions) => string,
): string {
  const date =
    mode === "time"
      ? parseLocalDateTime(`2000-01-01T${value}`)
      : mode === "date"
        ? parseLocalDate(value)
        : parseLocalDateTime(value);
  if (!date) return value;
  return format(
    date,
    mode === "time"
      ? { timeStyle: "short" }
      : mode === "date"
        ? { dateStyle: "medium" }
        : { dateStyle: "medium", timeStyle: "short" },
  );
}
export function hour24(hour: number, period: "am" | "pm"): number {
  return (hour % 12) + (period === "pm" ? 12 : 0);
}
export function parseTimeEntry(value: string): string | null {
  if (parseLocalTime(value) !== null) return value;
  const match = /^(1[0-2]|0?[1-9]):([0-5]\d)\s*(am|pm)$/i.exec(value.trim());
  return match
    ? `${pad(hour24(Number(match[1]), match[3].toLowerCase() as "am" | "pm"))}:${match[2]}`
    : null;
}
export function minuteOptions(step = 1, selected = 0): number[] {
  const interval = Number.isFinite(step) ? Math.min(60, Math.max(1, Math.floor(step))) : 1;
  return [
    ...new Set([
      ...Array.from({ length: Math.ceil(60 / interval) }, (_, i) => i * interval),
      selected,
    ]),
  ].sort((a, b) => a - b);
}

/** One part of a locale's numeric date, as `Intl.DateTimeFormat.formatToParts` reports it. */
export type EntryPart = { type: string; value: string };
const entryFields = ["day", "month", "year"];

/** A stored value as the text a person types: the locale's numeric date, then 24-hour time. */
export function formatEntry(value: string, mode: DateTimeMode, parts: EntryPart[]): string {
  if (mode === "time" || !isLocalDateTimeValue(value, mode)) return value;
  const [year, month, day] = value.slice(0, 10).split("-");
  const fields: Record<string, string> = { year, month, day };
  const date = parts
    .map((part) => fields[part.type] ?? (part.type === "literal" ? part.value : ""))
    .join("");
  return mode === "date" ? date : `${date} ${value.slice(11)}`;
}

/**
 * Typed text as a stored value, or null. The date follows the locale's field order with any
 * separator; a leading four-digit year always reads as year, month, day.
 */
export function parseEntry(text: string, mode: DateTimeMode, parts: EntryPart[]): string | null {
  const trimmed = text.trim();
  if (mode === "time") return parseTimeEntry(trimmed);
  const groups = trimmed.match(/\d+/g) ?? [];
  if (groups.length !== (mode === "date" ? 3 : 5)) return null;
  const order =
    groups[0].length === 4
      ? ["year", "month", "day"]
      : parts.filter((part) => entryFields.includes(part.type)).map((part) => part.type);
  const fields: Record<string, string> = {};
  order.forEach((type, index) => {
    fields[type] = groups[index];
  });
  if (fields.year?.length !== 4 || !fields.month || !fields.day) return null;
  const date = `${fields.year}-${fields.month.padStart(2, "0")}-${fields.day.padStart(2, "0")}`;
  if (mode === "date") return date;
  const period = /(am|pm)$/i.exec(trimmed)?.[1];
  const time = parseTimeEntry(
    period
      ? `${Number(groups[3])}:${groups[4]} ${period}`
      : `${groups[3].padStart(2, "0")}:${groups[4]}`,
  );
  return time ? `${date}T${time}` : null;
}
