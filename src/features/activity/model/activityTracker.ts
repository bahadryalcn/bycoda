import { dateTimeFormat } from "../../../shared/lib/intl";
import {
  decodeMinutes,
  emptyMinutes,
  encodeMinutes,
  localDateFor,
  mergeMinutes,
  minuteIndexFor,
  setMinute,
} from "@bycoda/account-contracts/activity";
import { elapsedSince, wallClockGap } from "../../../shared/lib/time/timestamps";

/** A minute counts while the last input is at most this old. */
export const IDLE_LIMIT_MS = 5 * 60_000;
/** Nominal spacing of `tick` calls. */
export const TICK_MS = 15_000;
/** Wall-clock time beyond `TICK_MS` between two ticks that means sleep, lock or a clock jump. */
export const MAX_TICK_GAP_MS = 2 * 60_000;

export type ActivityReport = {
  date: string;
  timeZone: string;
  minutes: string;
};
export type Clock = { wall: number; mono: number };
export type TrackerState = { foreground: boolean };

type Pending = { timeZone: string; map: Uint8Array };

/**
 * Collects active minutes for this window. A minute is marked only at the moment a tick sees
 * the window in the foreground with input in the last five minutes, so a gap is never filled
 * in afterwards. Several windows mark the same minute; the Host ORs them into one.
 */
export class ActivityTracker {
  private lastInput: number | null = null;
  private lastTickWall: number | null = null;
  private pending = new Map<string, Pending>();

  /** Keyboard, pointer or touch input inside the app. */
  noteInput(mono: number): void {
    this.lastInput = mono;
  }

  tick(
    clock: Clock,
    state: TrackerState,
    timeZone = dateTimeFormat().resolvedOptions().timeZone,
  ): void {
    const previous = this.lastTickWall;
    this.lastTickWall = clock.wall;
    if (previous !== null && wallClockGap(previous, clock.wall, TICK_MS) > MAX_TICK_GAP_MS) {
      // Slept, locked or the clock jumped: wait for fresh input instead of backfilling.
      this.lastInput = null;
      return;
    }
    if (!state.foreground || this.lastInput === null) return;
    if (elapsedSince(this.lastInput, clock.mono) > IDLE_LIMIT_MS) return;
    const at = new Date(clock.wall);
    const date = localDateFor(at, timeZone);
    const entry = this.pending.get(date) ?? { timeZone, map: emptyMinutes() };
    setMinute(entry.map, minuteIndexFor(at, timeZone));
    this.pending.set(date, entry);
  }

  hasPending(): boolean {
    return this.pending.size > 0;
  }

  /** Takes everything collected so far; call `restore` when sending fails. */
  drain(): ActivityReport[] {
    const reports = [...this.pending].map(([date, { timeZone, map }]) => ({
      date,
      timeZone,
      minutes: encodeMinutes(map),
    }));
    this.pending = new Map();
    return reports;
  }

  /** Puts drained reports back after a failed send; merging keeps newer minutes. */
  restore(reports: ActivityReport[]): void {
    for (const report of reports) {
      const existing = this.pending.get(report.date);
      const restored = decodeMinutes(report.minutes);
      this.pending.set(report.date, {
        timeZone: existing?.timeZone ?? report.timeZone,
        map: existing ? mergeMinutes(existing.map, restored) : restored,
      });
    }
  }
}
