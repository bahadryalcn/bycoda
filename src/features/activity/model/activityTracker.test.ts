import { describe, expect, it } from "vitest";
import {
  countMinutes,
  decodeMinutes,
  isMinuteSet,
  mergeMinutes,
  summarize,
  type ActivityDay,
} from "@bycoda/account-contracts/activity";
import { ActivityTracker, IDLE_LIMIT_MS, TICK_MS } from "./activityTracker";

const IST = "Europe/Istanbul";
const T0 = Date.UTC(2026, 10, 8, 9, 0, 0); // 12:00 in Istanbul (UTC+3)
const fg = { foreground: true };

/** Drives ticks like the hook: every TICK_MS of wall and monotonic time. */
function run(tracker: ActivityTracker, fromMs: number, toMs: number, state = fg, tz = IST) {
  for (let at = fromMs; at <= toMs; at += TICK_MS) tracker.tick({ wall: at, mono: at }, state, tz);
}
const total = (tracker: ActivityTracker) =>
  tracker.drain().reduce((sum, r) => sum + countMinutes(decodeMinutes(r.minutes)), 0);

describe("ActivityTracker", () => {
  it("counts foreground minutes while input is recent and stops after five idle minutes", () => {
    const tracker = new ActivityTracker();
    tracker.noteInput(T0);
    run(tracker, T0, T0 + 20 * 60_000);
    const [report] = tracker.drain();
    const map = decodeMinutes(report!.minutes);
    expect(report!.date).toBe("2026-11-08");
    expect(isMinuteSet(map, 12 * 60)).toBe(true);
    expect(isMinuteSet(map, 12 * 60 + 5)).toBe(true);
    expect(isMinuteSet(map, 12 * 60 + 6)).toBe(false);
    expect(IDLE_LIMIT_MS).toBe(300_000);
  });

  it("ignores minutes while in the background", () => {
    const tracker = new ActivityTracker();
    tracker.noteInput(T0);
    run(tracker, T0, T0 + 3 * 60_000, { foreground: false });
    expect(tracker.hasPending()).toBe(false);
  });

  it("does not backfill after sleep or lock, and needs new input", () => {
    const tracker = new ActivityTracker();
    tracker.noteInput(T0);
    run(tracker, T0, T0 + 60_000);
    tracker.drain();
    // The laptop sleeps for 3 minutes: wall time jumps, monotonic time barely moves.
    const wake = T0 + 60_000 + 3 * 60_000;
    tracker.tick({ wall: wake, mono: T0 + 70_000 }, fg, IST);
    expect(tracker.hasPending()).toBe(false);
    tracker.tick({ wall: wake + TICK_MS, mono: T0 + 85_000 }, fg, IST);
    expect(tracker.hasPending()).toBe(false);
    tracker.noteInput(T0 + 90_000);
    tracker.tick({ wall: wake + 2 * TICK_MS, mono: T0 + 100_000 }, fg, IST);
    expect(total(tracker)).toBe(1);
  });

  it("two windows marking the same minutes count once after the Host merge", () => {
    const a = new ActivityTracker();
    const b = new ActivityTracker();
    a.noteInput(T0);
    b.noteInput(T0 + 30_000);
    run(a, T0, T0 + 4 * 60_000);
    run(b, T0 + 15_000, T0 + 4 * 60_000 + 15_000);
    const [ra] = a.drain();
    const [rb] = b.drain();
    const merged = mergeMinutes(decodeMinutes(ra!.minutes), decodeMinutes(rb!.minutes));
    expect(countMinutes(merged)).toBe(5);
    expect(countMinutes(mergeMinutes(merged, merged))).toBe(5);
  });

  it("splits at local midnight, not UTC midnight", () => {
    const tracker = new ActivityTracker();
    const beforeMidnight = Date.UTC(2026, 10, 8, 20, 59, 30); // 23:59:30 Istanbul
    tracker.noteInput(beforeMidnight);
    run(tracker, beforeMidnight, beforeMidnight + 60_000);
    const dates = tracker
      .drain()
      .map((r) => r.date)
      .sort();
    expect(dates).toEqual(["2026-11-08", "2026-11-09"]);
  });

  it("marks the right slot on DST days", () => {
    const tz = "America/New_York";
    const spring = new ActivityTracker();
    const afterJump = Date.UTC(2026, 2, 8, 7, 30, 0); // 03:30 EDT, after the skipped hour
    spring.noteInput(afterJump);
    spring.tick({ wall: afterJump, mono: afterJump }, fg, tz);
    const [s] = spring.drain();
    expect(s!.date).toBe("2026-03-08");
    expect(isMinuteSet(decodeMinutes(s!.minutes), 3 * 60 + 30)).toBe(true);

    // Fall back: 01:30 happens twice and both write the same slot.
    const fall = new ActivityTracker();
    const first = Date.UTC(2026, 10, 1, 5, 30, 0); // 01:30 EDT
    const second = Date.UTC(2026, 10, 1, 6, 30, 0); // 01:30 EST
    fall.noteInput(first);
    fall.tick({ wall: first, mono: first }, fg, tz);
    fall.noteInput(second);
    fall.tick({ wall: second, mono: second }, fg, tz); // an hour gap: input is reset
    fall.noteInput(second);
    fall.tick({ wall: second + TICK_MS, mono: second + TICK_MS }, fg, tz);
    const [f] = fall.drain();
    expect(countMinutes(decodeMinutes(f!.minutes))).toBe(1);
  });

  it("restores a failed send and merges it with newer minutes", () => {
    const tracker = new ActivityTracker();
    tracker.noteInput(T0);
    run(tracker, T0, T0 + 60_000);
    const reports = tracker.drain();
    run(tracker, T0 + 2 * 60_000, T0 + 2 * 60_000);
    tracker.restore(reports);
    expect(total(tracker)).toBe(3);
  });

  it("sums a year of days from several devices without double counting", () => {
    const full = new ActivityTracker();
    full.noteInput(T0);
    run(full, T0, T0 + 9 * 60_000);
    const minutes = full.drain()[0]!.minutes;
    const days: ActivityDay[] = [];
    for (const date of ["2026-01-02", "2026-06-15", "2026-11-08"])
      for (const deviceId of ["a", "b"]) days.push({ date, timeZone: IST, deviceId, minutes });
    days.push({ date: "2025-12-31", timeZone: IST, deviceId: "a", minutes });
    const summary = summarize(days, { today: "2026-11-08", timeZone: IST });
    expect(summary.year).toBe(18);
    expect(summary.today).toBe(6);
  });
});
