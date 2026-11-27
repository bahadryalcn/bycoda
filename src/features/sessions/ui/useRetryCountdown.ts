import { useEffect, useState } from "react";
import { elapsedSince, monotonicNow } from "../../../shared/lib/time/timestamps";

const TICK_MS = 1000;

/**
 * Milliseconds until the provider's next attempt, ticking once a second; `undefined` when the
 * provider reported no retry time or the time has passed. The wall-clock `retryAt` is turned
 * into a wait once, then measured on the monotonic clock so sleep and clock jumps cannot skew it.
 */
export function useRetryCountdown(retryAt: number | undefined): number | undefined {
  const [remaining, setRemaining] = useState<number | undefined>(undefined);
  // Re-anchor the countdown whenever the provider reports a new retry time.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- keeps an interval timer in step with retryAt while mounted
  useEffect(() => {
    if (retryAt === undefined) {
      setRemaining(undefined);
      return;
    }
    const wait = retryAt - Date.now();
    const startedAt = monotonicNow();
    let id: number | undefined;
    const tick = () => {
      const left = wait - elapsedSince(startedAt);
      setRemaining(left > 0 ? left : undefined);
      if (left <= 0 && id !== undefined) window.clearInterval(id);
    };
    tick();
    id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, [retryAt]);
  return remaining;
}
