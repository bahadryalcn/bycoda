/**
 * Autonomy policy per account and action. Levels: "suggest" (AI proposes, owner acts), "approve"
 * (AI queues, owner approves each item) and "autonomous" (AI acts without a per-item approval).
 * Global stop, limits, working hours and suppression apply at every level. React-free.
 */
import { dateTimeFormat } from "../../../shared/lib/intl";

export type AutonomyAction =
  | "publish"
  | "reply"
  | "comment"
  | "message"
  | "email"
  | "outreach"
  | "audience"
  | "contacts";

export type AutonomyLevel = "suggest" | "approve" | "autonomous";

export type AutonomyPolicy = {
  accountId: string;
  version: number;
  levels: Record<AutonomyAction, AutonomyLevel>;
  /** Per day, per account and action. Absent means no limit beyond the default table. */
  limits: Partial<Record<AutonomyAction, number>>;
  workingHours?: {
    timeZone: string;
    /** 0 (Sunday) to 6 (Saturday). */
    days: number[];
    /** "HH:mm". Equal start and end means all day; an end before the start spans midnight. */
    start: string;
    end: string;
  };
  updatedAt: number;
  updatedBy: string;
};

/** One Host action record. The summary never contains secrets or full message content. */
export type AiAction = {
  id: string;
  at: number;
  /** Principal id of the actor (owner, AI program or assistant thread). */
  actor: string;
  accountId?: string;
  /** Social action name, for example "replies.send". */
  action: string;
  summary: string;
  status: "done" | "queued" | "failed" | "blocked" | "undone";
  reason?: string;
  undo?: { action: string; input: Record<string, unknown> };
  planId?: string;
};

export const DEFAULT_AUTONOMY: Omit<AutonomyPolicy, "accountId" | "updatedAt" | "updatedBy"> = {
  version: 1,
  levels: {
    publish: "suggest",
    reply: "suggest",
    comment: "suggest",
    message: "suggest",
    email: "suggest",
    outreach: "suggest",
    audience: "suggest",
    contacts: "suggest",
  },
  limits: {
    publish: 10,
    reply: 100,
    comment: 50,
    message: 50,
    email: 100,
    outreach: 200,
    audience: 2000,
    contacts: 2000,
  },
};

export function autonomyLevel(
  policy: AutonomyPolicy | undefined,
  action: AutonomyAction,
): AutonomyLevel {
  return policy?.levels[action] ?? "suggest";
}

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function zonedParts(instant: number, timeZone: string): LocalParts {
  // dateTimeFormat caches by locale and options (bounded), so no local per-zone cache is kept here.
  const parts = dateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

/** Offset in milliseconds between the wall clock in `timeZone` and UTC at `instant`. */
function offsetAt(instant: number, timeZone: string): number {
  const local = zonedParts(instant, timeZone);
  return (
    Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) -
    Math.floor(instant / 1000) * 1000
  );
}

/** Converts a wall-clock time in `timeZone` to an instant. Two passes settle DST transitions. */
function zonedToInstant(
  year: number,
  month: number,
  day: number,
  minutes: number,
  timeZone: string,
): number {
  const wall = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  const first = wall - offsetAt(wall, timeZone);
  return wall - offsetAt(first, timeZone);
}

function clockMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** True when `now` falls inside the policy's working window. Without a window, always true. */
export function withinWorkingHours(policy: AutonomyPolicy, now: number): boolean {
  const hours = policy.workingHours;
  if (!hours) return true;
  const local = zonedParts(now, hours.timeZone);
  const today = weekdayOf(local.year, local.month, local.day);
  const minute = local.hour * 60 + local.minute;
  const start = clockMinutes(hours.start);
  const end = clockMinutes(hours.end);
  if (start === end) return hours.days.includes(today);
  if (start < end) return hours.days.includes(today) && minute >= start && minute < end;
  // Overnight window: the part after midnight belongs to the day the window started on.
  if (minute >= start) return hours.days.includes(today);
  if (minute < end) return hours.days.includes((today + 6) % 7);
  return false;
}

/**
 * The next instant the working window opens, or `now` when already inside it.
 * Returns Number.POSITIVE_INFINITY when no allowed day exists within the next nine days.
 */
export function nextWorkingStart(policy: AutonomyPolicy, now: number): number {
  if (withinWorkingHours(policy, now)) return now;
  const hours = policy.workingHours;
  if (!hours) return now;
  const local = zonedParts(now, hours.timeZone);
  const start = clockMinutes(hours.start);
  for (let offset = 0; offset <= 8; offset++) {
    const date = new Date(Date.UTC(local.year, local.month - 1, local.day + offset));
    if (!hours.days.includes(date.getUTCDay())) continue;
    const at = zonedToInstant(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      start,
      hours.timeZone,
    );
    if (at > now) return at;
  }
  return Number.POSITIVE_INFINITY;
}
