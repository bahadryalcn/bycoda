import type { SocialAccount, SocialJob, SocialPlatform } from "../../model/social";

export type CalendarView = "week" | "month" | "list";

export type CalendarEntry = {
  id: string;
  campaignId: string;
  at: number;
  status: SocialJob["status"];
  accountId: string;
  platform: SocialPlatform | undefined;
  text: string;
};

/** Local midnight of the day that contains `ms`. */
export function startOfDay(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Local `YYYY-MM-DD`, the key that groups entries by day. */
export function dayKey(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(ms: number, days: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime();
}

/** Seven local day starts, beginning with `weekStart` (0 = Sunday, 1 = Monday) on or before `anchor`. */
export function weekDays(anchor: number, weekStart: 0 | 1 = 1): number[] {
  const day = startOfDay(anchor);
  const offset = (new Date(day).getDay() - weekStart + 7) % 7;
  const first = addDays(day, -offset);
  return Array.from({ length: 7 }, (_, index) => addDays(first, index));
}

/** Six weeks of day starts that cover the month of `anchor`. */
export function monthCells(anchor: number, weekStart: 0 | 1 = 1): number[] {
  const date = new Date(anchor);
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  const start = weekDays(firstOfMonth, weekStart)[0]!;
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

export function shiftWeek(anchor: number, weeks: number): number {
  return addDays(anchor, weeks * 7);
}

export function shiftMonth(anchor: number, months: number): number {
  const date = new Date(anchor);
  const day = date.getDate();
  // Clamp to the last day so 31 January plus one month is 28/29 February, not 3 March.
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, last));
  return target.getTime();
}

/** Publish jobs that belong to a campaign, one entry per variant job. */
export function calendarEntries(jobs: SocialJob[], accounts: SocialAccount[]): CalendarEntry[] {
  return jobs
    .filter((job) => job.kind === "publish" && job.campaignId)
    .map((job) => ({
      id: job.id,
      campaignId: job.campaignId!,
      at: job.scheduledAt,
      status: job.status,
      accountId: job.accountId,
      platform: accounts.find((account) => account.id === job.accountId)?.platform,
      text: job.payload.text,
    }))
    .sort((a, b) => a.at - b.at);
}

/** Entries grouped by local day, each day in time order. */
export function entriesByDay(entries: CalendarEntry[]): Map<string, CalendarEntry[]> {
  const days = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    const key = dayKey(entry.at);
    days.set(key, [...(days.get(key) ?? []), entry]);
  }
  return days;
}

/** True when `day` falls on the same local date as `now`. */
export function isToday(day: number, now: number): boolean {
  return dayKey(day) === dayKey(now);
}

/** The first `max` entries of a month cell and how many more the cell holds. */
export function splitMonthEntries<T>(entries: T[], max: number): { shown: T[]; more: number } {
  return { shown: entries.slice(0, max), more: Math.max(0, entries.length - max) };
}
