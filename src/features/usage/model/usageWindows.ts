import type { UsageWindow } from "./usageAnalytics";

/** Relative ranges the dashboard offers; a custom range carries its own window. */
export type UsageRangePreset = "today" | "yesterday" | "7d" | "30d" | "90d" | "all";

const QUARTER_HOUR_MS = 900_000;
const ceilToQuarterHour = (now: number) => Math.ceil(now / QUARTER_HOUR_MS) * QUARTER_HOUR_MS;

/** Local calendar window of a dashboard preset, as of `now`. */
export function usagePresetWindow(preset: UsageRangePreset, now: number): UsageWindow {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (preset === "yesterday") {
    const end = start.getTime();
    start.setDate(start.getDate() - 1);
    return { start: start.getTime(), end };
  }
  if (preset === "7d" || preset === "30d" || preset === "90d")
    start.setDate(start.getDate() - Number(preset.slice(0, -1)) + 1);
  return { start: preset === "all" ? 0 : start.getTime(), end: ceilToQuarterHour(now) };
}

/** From local midnight of the first of this month to now, in the dashboard's end rounding. */
export function usageMonthToDateWindow(now: number): UsageWindow {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(1);
  return { start: start.getTime(), end: ceilToQuarterHour(now) };
}

export type UsageMonthWindow = {
  /** Local calendar month as `YYYY-MM`. */
  key: string;
  window: UsageWindow;
  /** The current month ends at `now`, not at its calendar end. */
  partial: boolean;
};

/** The last `count` local calendar months, oldest first; the current month is partial. */
export function usageMonthWindows(now: number, count: number): UsageMonthWindow[] {
  const current = new Date(now);
  const months: UsageMonthWindow[] = [];
  for (let back = count - 1; back >= 0; back--) {
    const start = new Date(current.getFullYear(), current.getMonth() - back, 1);
    const next = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    const partial = back === 0;
    months.push({
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
      window: { start: start.getTime(), end: partial ? ceilToQuarterHour(now) : next.getTime() },
      partial,
    });
  }
  return months;
}
