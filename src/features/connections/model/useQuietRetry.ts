import { useEffect, useRef, useState } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { classifyRemoteError } from "./remoteFailure";

/** Waits between automatic retries of a busy machine: 2, 4, 8, 16 s. */
export const QUIET_RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000] as const;

/**
 * Retries a read that failed only because the machine was busy (its Host
 * refused the read for capacity, or the request timed out), without showing
 * that failure. Returns true while such a retry is pending, so the caller hides
 * its error. After the last retry the failure is reported normally. Any other
 * failure, or a success, resets the count; a retry still in flight (`loading`, or
 * a returned promise not yet settled) keeps it, so the ladder escalates.
 *
 * One retry per read at a time: while the previous one is in flight no timer is
 * armed, and the next delay starts only after it settled, so a slow busy read
 * is never stacked with more reads against the same overloaded Host. A caller
 * whose `retry` starts the read without returning it must report it through
 * `loading`. Only for reads: nothing is resent that could have taken effect.
 */
export function useQuietRetry(
  error: unknown,
  retry: (() => void | Promise<unknown>) | undefined,
  loading = false,
): boolean {
  const transient = !!error && !!retry && classifyRemoteError(error).kind === "temporary";
  const [attempts, setAttempts] = useState(0);
  // The retry this hook started that has not settled yet.
  const [running, setRunning] = useState(false);
  const retryLatest = useStableCallback(retry);
  const alive = useRef(true);
  // Reason: a retry that settles after unmount must not update state.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // Reset the count only once a read settled without a busy failure; a retry in flight is neither.
  // Reason: arms one retry timer for the current attempt, or waits while a retry is in flight.
  useEffect(() => {
    if (loading || running) return;
    if (!transient) {
      const reset = setTimeout(() => setAttempts(0), 0);
      return () => clearTimeout(reset);
    }
    if (attempts >= QUIET_RETRY_DELAYS_MS.length) return;
    const timer = setTimeout(() => {
      setAttempts((count) => count + 1);
      const started = retryLatest?.();
      if (!(started instanceof Promise)) return;
      setRunning(true);
      const settle = () => {
        if (alive.current) setRunning(false);
      };
      started.then(settle, settle);
    }, QUIET_RETRY_DELAYS_MS[attempts]);
    return () => clearTimeout(timer);
  }, [transient, loading, running, attempts, error, retryLatest]);
  return transient && attempts < QUIET_RETRY_DELAYS_MS.length;
}
