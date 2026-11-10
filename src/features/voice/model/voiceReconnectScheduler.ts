import { elapsedSince, monotonicNow } from "../../../shared/lib/time/timestamps";
import { VOICE_RECONNECT_DELAYS } from "./voiceReconnect";

/** After the fast attempts, retry once a minute until this much time has passed. */
export const VOICE_SLOW_RETRY_MS = 60_000;
export const VOICE_RECONNECT_CAP_MS = 30 * 60_000;

/** Delay before retry number `attempt` (0-based), or undefined once the budget is spent. */
export function voiceReconnectDelay(attempt: number, elapsedMs: number): number | undefined {
  if (attempt < VOICE_RECONNECT_DELAYS.length) return VOICE_RECONNECT_DELAYS[attempt];
  return elapsedMs + VOICE_SLOW_RETRY_MS <= VOICE_RECONNECT_CAP_MS
    ? VOICE_SLOW_RETRY_MS
    : undefined;
}

/**
 * Owns the single pending reconnect. `cancel` (Disconnect, Stop, sleep) drops the timer and the
 * callback together, so neither a late timer nor an `online` event can reopen capture.
 */
export class VoiceReconnectScheduler {
  private attempt = 0;
  private startedAt: number | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: (() => void) | undefined;
  constructor(private now: () => number = monotonicNow) {}

  /** Queue `run`; a rotation is immediate and spends no retry. False means the budget is spent. */
  schedule(run: () => void, rotation = false): boolean {
    this.cancel();
    let delay = 0;
    if (!rotation) {
      this.startedAt ??= this.now();
      const next = voiceReconnectDelay(this.attempt, elapsedSince(this.startedAt, this.now()));
      if (next === undefined) return false;
      this.attempt++;
      delay = next;
    }
    this.pending = run;
    this.timer = setTimeout(() => this.fire(), delay);
    return true;
  }

  /** The browser came back online: run the pending retry now. */
  retryNow(): boolean {
    if (!this.pending) return false;
    this.fire();
    return true;
  }

  cancel() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
  }

  /** A connection that stayed up, or an explicit owner start, restores the full budget. */
  reset() {
    this.cancel();
    this.attempt = 0;
    this.startedAt = undefined;
  }

  private fire() {
    const run = this.pending;
    this.cancel();
    run?.();
  }
}
