// Cadence of background update probes. Consecutive failed checks double the wait up
// to a ceiling; a successful check or an explicit one restores the base interval.
// Explicit checks never consult this state: they always reach the feed.
import { elapsedSince, monotonicNow } from "../../shared/lib/time/timestamps";

const BASE_DELAY_MS = 30 * 60 * 1000;
const MAX_DELAY_MS = 8 * 60 * 60 * 1000;

/** Wait before the next background probe after `failures` consecutive failed checks. */
export function updateProbeDelayMs(failures: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** failures, MAX_DELAY_MS);
}

let failures = 0;
let failedAt = 0;
const listeners = new Set<() => void>();

/** Runs after every settled feed check, whichever entry point asked for it. */
export function subscribeUpdateProbeBackoff(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Records one settled feed check. Only a failed background check lengthens the wait. */
export function settleUpdateCheck(failed: boolean, explicit: boolean, now = monotonicNow()): void {
  failures = failed && !explicit ? failures + 1 : 0;
  failedAt = now;
  listeners.forEach((listener) => listener());
}

/** Wait from a settled check, or from a probe that settled none, to the next probe. */
export function nextUpdateProbeDelayMs(): number {
  return updateProbeDelayMs(failures);
}

/** What is left of a failure wait; zero while checks succeed. */
export function pendingUpdateProbeWaitMs(now = monotonicNow()): number {
  return failures ? Math.max(0, updateProbeDelayMs(failures) - elapsedSince(failedAt, now)) : 0;
}
