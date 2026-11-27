import { wallClockGap } from "./timestamps";

/** How often a started clock samples the wall clock on its own. */
export const AWAKE_TICK_MS = 5_000;
/** A sample this much later than its slot means the process slept, stalled or the clock jumped. */
export const AWAKE_SUSPEND_GAP_MS = 10_000;

/**
 * A wall clock that does not count the time its process was suspended (machine sleep). Liveness
 * windows ("silent for more than N seconds means gone") measured on it only grow while the
 * process could have heard from the other side, so waking up never makes every peer look stale
 * at once. Stamps taken from `now()` stay comparable with each other across a suspension.
 *
 * Suspension is detected while the clock is started, by a sample arriving much later than its
 * slot (`wallClockGap`). Every `now()` samples too, so a reader that runs before the interval
 * after waking still sees the corrected time. A clock that was never started is the plain wall
 * clock: without samples, plain silence cannot be told from sleep.
 */
export class AwakeClock {
  private slept = 0;
  private lastSample: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  declare private readonly wall: () => number;
  declare private readonly tickMs: number;
  declare private readonly gapMs: number;

  constructor(wall: () => number = Date.now, tickMs = AWAKE_TICK_MS, gapMs = AWAKE_SUSPEND_GAP_MS) {
    this.wall = wall;
    this.tickMs = tickMs;
    this.gapMs = gapMs;
    this.lastSample = wall();
  }

  /** Begins watching for suspensions; the timer never keeps the process alive. */
  start(): void {
    if (this.timer) return;
    this.lastSample = this.wall();
    this.timer = setInterval(() => this.sample(), this.tickMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Folds a suspension since the previous sample into the offset. */
  sample(): void {
    if (!this.timer) return;
    const at = this.wall();
    const gap = wallClockGap(this.lastSample, at, this.tickMs);
    if (gap > this.gapMs) this.slept += gap;
    this.lastSample = at;
  }

  /** Wall time minus the time the process spent suspended. */
  now(): number {
    this.sample();
    return this.wall() - this.slept;
  }

  /** Total suspended time folded out of `now()` so far. */
  get sleptMs(): number {
    return this.slept;
  }

  /** The wall-clock instant of an `now()` stamp, for callers that schedule against `Date.now`. */
  toWall(awakeAt: number): number {
    return awakeAt + this.slept;
  }
}
