/**
 * Active-time clock for unattended runs.
 *
 * A run's time limit must count only the time the Host was actually awake. The
 * persisted `startedAt` stays wall-clock, but a laptop that slept for an hour
 * must not wake to "time limit reached". Every observation (a settle tick)
 * adds the gap since the previous one; a gap longer than twice the tick
 * interval is a pause (sleep, a frozen event loop) and credits at most one
 * tick instead of the whole gap.
 *
 * The first observation of a run in this process (a fresh start or a Host
 * restart) falls back to the wall-clock elapsed time: nothing is known about
 * the earlier interval, and the previous behaviour was wall-clock.
 */

/** The settle tick interval the pause threshold is derived from. */
export const RUN_CLOCK_TICK_MS = 30_000;
/** A gap between two observations beyond this is treated as a pause. */
export const RUN_CLOCK_PAUSE_GAP_MS = 2 * RUN_CLOCK_TICK_MS;
const MAX_TRACKED_RUNS = 2_000;

type Entry = { lastSeen: number; activeMs: number };

export class RunClock {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly pauseGapMs = RUN_CLOCK_PAUSE_GAP_MS) {}

  /** Active milliseconds of the run at `now`, recording this observation. */
  activeMs(key: string, startedAt: number, now: number): number {
    const entry = this.entries.get(key);
    if (!entry) {
      const activeMs = Math.max(0, now - startedAt);
      this.entries.set(key, { lastSeen: now, activeMs });
      this.evict();
      return activeMs;
    }
    const gap = now - entry.lastSeen;
    if (gap > 0) {
      entry.activeMs += gap > this.pauseGapMs ? Math.min(gap, RUN_CLOCK_TICK_MS) : gap;
      entry.lastSeen = now;
    }
    return entry.activeMs;
  }

  /** Drops a finished run's entry. */
  forget(key: string): void {
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }

  private evict(): void {
    while (this.entries.size > MAX_TRACKED_RUNS) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      this.entries.delete(oldest);
    }
  }
}

/** The clock shared by every run owner (tasks, automations, stewards, goals). */
export const runClock = new RunClock();

export const runClockKey = (run: {
  runId?: string;
  sessionId?: string;
  startedAt: number;
}): string | undefined => (run.runId ? `${run.runId}@${run.startedAt}` : undefined);
