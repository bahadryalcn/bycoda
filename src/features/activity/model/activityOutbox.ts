import { decodeMinutes } from "@bycoda/account-contracts/activity";
import { ActivityTracker, type ActivityReport } from "./activityTracker";

const KEY = "bycoda.activity.outbox.v1";
/** Newest days kept per Host, so a Host that never comes back cannot grow the entry forever. */
const MAX_DAYS_PER_HOST = 14;

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Unsent minute maps by the Host they were collected for; nothing else is stored. */
type Stored = Record<string, ActivityReport[]>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function validReport(value: unknown): value is ActivityReport {
  if (typeof value !== "object" || value === null) return false;
  const { date, timeZone, minutes } = value as Partial<ActivityReport>;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  if (typeof timeZone !== "string" || typeof minutes !== "string") return false;
  try {
    decodeMinutes(minutes);
    return true;
  } catch {
    return false;
  }
}

function readAll(storage: StorageLike | null): Stored {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Stored = {};
    for (const [machineId, reports] of Object.entries(parsed)) {
      if (Array.isArray(reports)) out[machineId] = reports.filter(validReport);
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(stored: Stored, storage: StorageLike | null): void {
  try {
    const entries = Object.entries(stored).filter(([, reports]) => reports.length > 0);
    if (entries.length === 0) storage?.removeItem(KEY);
    else storage?.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Storage is best effort: a failed write costs the minutes it would have kept, nothing else.
  }
}

/**
 * Keeps reports that could not reach `machineId` before their tracker went away (unmount or Host
 * change). They are keyed by that Host so they are only ever sent back to it. Merging is the
 * tracker's own bitwise OR, so a minute stored twice, or sent after being stored, still counts once.
 */
export function saveOutbox(
  machineId: string,
  reports: ActivityReport[],
  storage: StorageLike | null = defaultStorage(),
): void {
  if (reports.length === 0) return;
  const stored = readAll(storage);
  const merger = new ActivityTracker();
  merger.restore(stored[machineId] ?? []);
  merger.restore(reports.filter(validReport));
  stored[machineId] = merger
    .drain()
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_DAYS_PER_HOST);
  writeAll(stored, storage);
}

/** Removes and returns what was kept for `machineId`; other Hosts' reports stay untouched. */
export function takeOutbox(
  machineId: string,
  storage: StorageLike | null = defaultStorage(),
): ActivityReport[] {
  const stored = readAll(storage);
  const reports = stored[machineId] ?? [];
  if (reports.length === 0) return [];
  delete stored[machineId];
  writeAll(stored, storage);
  return reports;
}
