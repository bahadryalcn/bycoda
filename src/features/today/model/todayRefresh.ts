import { todayWindow } from "./todayAggregate";

/** Slow poll while the view is visible; a read launches provider log reads per account. */
export const TODAY_REFRESH_MS = 300_000;
/** No automatic read starts within this long of the previous one (focus flapping, ticks). */
export const TODAY_MIN_GAP_MS = 30_000;

/** Whether `a` and `b` fall on the same local calendar day. */
export function sameLocalDay(a: number, b: number): boolean {
  return todayWindow("today", a).start === todayWindow("today", b).start;
}

/**
 * Whether an automatic refresh should start: another local day began since the last read
 * (the Today and This week windows moved), or the last read is at least `minGap` old.
 */
export function isReadDue(readAt: number, now: number, minGap = TODAY_MIN_GAP_MS): boolean {
  return !sameLocalDay(readAt, now) || now - readAt >= minGap;
}

/** Milliseconds to just after the next local midnight (DST-safe), never below one second. */
export function msUntilNextDay(now: number): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return Math.max(1_000, next.getTime() - now + 1_000);
}
