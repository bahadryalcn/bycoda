import { monotonicNow } from "../../../shared/lib/time/timestamps";

export const WAKE_LIMITS = {
  /** Shortest wait between two recognitions. */
  minGapMs: 300,
  /** More speech bursts than this in one minute count as a noisy room. */
  burstsPerMinute: 20,
  /** How long the room must stay noisy before the listener pauses. */
  noisyMs: 3 * 60_000,
  pauseMs: 5 * 60_000,
  /** A wake phrase is short; longer bursts are conversation. */
  maxBurstMs: 4000,
};

export type WakeVerdict = "run" | "busy" | "gap" | "noisy" | "paused";

/** CPU guard of the wake listener: one recognition at a time, a minimum gap and a noisy-room pause. */
export class WakeGuard {
  private busy = false;
  private lastDoneAt = Number.NEGATIVE_INFINITY;
  private hits: number[] = [];
  private noisySince: number | null = null;
  private pausedUntil = Number.NEGATIVE_INFINITY;
  constructor(private now: () => number = monotonicNow) {}

  /** Decides one speech burst; every burst, dropped or not, counts toward the noise rate. */
  admit(): WakeVerdict {
    const at = this.now();
    if (at < this.pausedUntil) return "paused";
    this.hits = [...this.hits.filter((hit) => at - hit < 60_000), at];
    if (this.hits.length > WAKE_LIMITS.burstsPerMinute) {
      this.noisySince ??= at;
      if (at - this.noisySince >= WAKE_LIMITS.noisyMs) {
        this.pausedUntil = at + WAKE_LIMITS.pauseMs;
        this.hits = [];
        this.noisySince = null;
        return "noisy";
      }
    } else this.noisySince = null;
    if (this.busy) return "busy";
    if (at - this.lastDoneAt < WAKE_LIMITS.minGapMs) return "gap";
    this.busy = true;
    return "run";
  }

  /** The recognition started by a "run" verdict ended. */
  done() {
    this.busy = false;
    this.lastDoneAt = this.now();
  }
}
