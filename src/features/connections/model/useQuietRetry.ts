import { useEffect, useRef, useState } from "react";
import { classifyRemoteError } from "./remoteFailure";

/** Waits between automatic retries of a busy machine: 2, 4, 8, 16 s. */
export const QUIET_RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000] as const;

/**
 * Retries a read that failed only because the machine was busy (its Host
 * refused the read for capacity, or the request timed out), without showing
 * that failure. Returns true while such a retry is pending, so the caller hides
 * its error. After the last retry the failure is reported normally. Any other
 * failure, or none, resets the count. Only for reads: nothing is resent that
 * could have taken effect.
 */
export function useQuietRetry(error: unknown, retry: (() => void) | undefined): boolean {
  const transient = !!error && !!retry && classifyRemoteError(error).kind === "temporary";
  const [attempts, setAttempts] = useState(0);
  const retryRef = useRef(retry);
  useEffect(() => {
    retryRef.current = retry;
  });
  useEffect(() => {
    if (!transient) {
      const reset = setTimeout(() => setAttempts(0), 0);
      return () => clearTimeout(reset);
    }
    if (attempts >= QUIET_RETRY_DELAYS_MS.length) return;
    const timer = setTimeout(() => {
      setAttempts((count) => count + 1);
      retryRef.current?.();
    }, QUIET_RETRY_DELAYS_MS[attempts]);
    return () => clearTimeout(timer);
  }, [transient, attempts, error]);
  return transient && attempts < QUIET_RETRY_DELAYS_MS.length;
}
