import { useEffect, useRef, useState } from "react";
export { formatElapsed } from "../../../shared/i18n/format";
import { usePresentationVisible } from "./presentationVisibility";
import { wallClockGap } from "../../../shared/lib/time/timestamps";

const TICK_MS = 1000;
/** A tick arriving this late past its slot means the machine slept; that span is not run time. */
const SUSPEND_GAP_MS = 5000;

/**
 * How long a turn has been running, ticking once a second. Time spent paused
 * (waiting on the user) and time the machine was asleep mid-turn are left out, the
 * latter matching the Host's run-limit accounting. Shared by the transcript's status
 * line and the composer's activity dock so the two read the same number.
 */
export function useElapsedFrom(startedAt: number | undefined, paused: boolean): number | null {
  const visible = usePresentationVisible();
  const fallback = useRef<number | null>(null);
  const pausedMs = useRef(0);
  const suspendedMs = useRef(0);
  const pauseStarted = useRef<number | null>(null);
  const seenStartedAt = useRef(startedAt);

  if (seenStartedAt.current !== startedAt) {
    seenStartedAt.current = startedAt;
    fallback.current = null;
    pausedMs.current = 0;
    suspendedMs.current = 0;
    pauseStarted.current = paused ? Date.now() : null;
  }

  const origin = startedAt ?? (fallback.current ??= Date.now());
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - origin));

  useEffect(() => {
    const start = startedAt ?? (fallback.current ??= Date.now());
    if (paused) {
      if (pauseStarted.current == null) pauseStarted.current = Date.now();
      return;
    }
    if (pauseStarted.current != null) {
      pausedMs.current += Date.now() - pauseStarted.current;
      pauseStarted.current = null;
    }
    if (!visible) return;
    // Parked time is counted from the wall clock on resume; only a gap observed between
    // two ticks of a live timer is treated as sleep and subtracted.
    let lastTick = Date.now();
    const tick = () => {
      const now = Date.now();
      const gap = wallClockGap(lastTick, now, TICK_MS);
      if (gap > SUSPEND_GAP_MS) suspendedMs.current += gap;
      lastTick = now;
      setElapsedMs(Math.max(0, now - start - pausedMs.current - suspendedMs.current));
    };
    tick();
    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, [startedAt, paused, visible]);

  return elapsedMs;
}
