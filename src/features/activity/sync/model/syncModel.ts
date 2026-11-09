import {
  MAX_DAYS_PER_UPLOAD,
  addDays,
  decodeMinutes,
  encodeMinutes,
  mergeMinutes,
  type ActivityDay,
} from "@bycoda/account-contracts/activity";

/** Sync covers the whole local store: the Host keeps 400 local days, so first sign-in uploads all of them (62 per request). */
export const SYNC_HISTORY_DAYS = 400;
export const HOUR_MS = 60 * 60_000;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = HOUR_MS;
/** Wake a few seconds after local midnight so the finished day is sent promptly. */
const DAY_END_GRACE_MS = 5_000;

/** Fingerprint of an uploaded day. Only an optimisation: the server ORs maps, so a miss re-sends. */
export function fingerprint(minutes: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < minutes.length; i++) {
    hash = Math.imul(hash ^ minutes.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

export type Watermark = Record<string, string>;

/** Window of local dates to read and send. `to` allows one day for time zones ahead of UTC. */
export function syncWindow(today: string): { from: string; to: string } {
  return { from: addDays(today, 1 - SYNC_HISTORY_DAYS), to: addDays(today, 1) };
}

/**
 * The days to send: inside the window, re-keyed to the account's device id, one entry per
 * date (duplicates OR-merged), skipping days whose map matches the watermark. Oldest first.
 */
export function pendingDays(
  local: readonly ActivityDay[],
  deviceId: string,
  today: string,
  watermark: Watermark,
): ActivityDay[] {
  const { from, to } = syncWindow(today);
  const byDate = new Map<string, ActivityDay>();
  for (const day of local) {
    if (day.date < from || day.date > to) continue;
    const known = byDate.get(day.date);
    byDate.set(
      day.date,
      known
        ? {
            ...known,
            minutes: encodeMinutes(
              mergeMinutes(decodeMinutes(known.minutes), decodeMinutes(day.minutes)),
            ),
          }
        : { ...day, deviceId },
    );
  }
  return [...byDate.values()]
    .filter((day) => watermark[day.date] !== fingerprint(day.minutes))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function chunkDays(days: readonly ActivityDay[]): ActivityDay[][] {
  const chunks: ActivityDay[][] = [];
  for (let i = 0; i < days.length; i += MAX_DAYS_PER_UPLOAD) {
    chunks.push(days.slice(i, i + MAX_DAYS_PER_UPLOAD));
  }
  return chunks;
}

/** Exponential delay with +-20% jitter; `random` is in [0, 1). */
export function backoffDelay(failures: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1));
  return Math.round(base * (0.8 + 0.4 * random()));
}

/** Milliseconds from `now` to the next local midnight. */
export function msUntilLocalMidnight(now: number): number {
  const at = new Date(now);
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1).getTime() - now;
}

/** Hourly, but never past the end of the local day; a failing run backs off instead. */
export function nextWakeDelay(now: number, failures: number, random?: () => number): number {
  if (failures > 0) return backoffDelay(failures, random);
  return Math.min(HOUR_MS, msUntilLocalMidnight(now) + DAY_END_GRACE_MS);
}

export type FailureKind = "retry" | "stop";

/**
 * `device_revoked`, `account_deactivated` and an unknown device (404) cannot succeed, so
 * sync stops until the identity changes (the account screen handles the sign-out). Everything else is retried later.
 */
export function classifyFailure(error: unknown): FailureKind {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code: unknown }).code
      : null;
  return code === "device_revoked" || code === "account_deactivated" || code === "not_found"
    ? "stop"
    : "retry";
}
