import { useEffect, useRef, useState } from "react";
import { STOPPING_TIMEOUT_MS } from "../model/backgroundStop";

/**
 * Stop requests in flight, by key (a tool call id, or `STOP_ALL`). A stop is
 * only a request: the row settles when the harness reports it ended, so the
 * button reads "Stopping…" until then, and comes back if nothing happened.
 */
export const STOP_ALL = "all";
type StopAttempt = { timer: number };

function dispatchStop(run: () => Promise<void>, failed: () => void) {
  try {
    void run().catch(failed);
  } catch {
    failed();
  }
}

export function useStopRequests() {
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const attempts = useRef(new Map<string, StopAttempt>());

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Own Stop timeout handles and invalidate late outcomes when the requesting surface unmounts.
  useEffect(() => {
    const pending = attempts.current;
    return () => {
      pending.forEach((attempt) => window.clearTimeout(attempt.timer));
      pending.clear();
    };
  }, []);

  const settle = (key: string, attempt: StopAttempt) => {
    if (attempts.current.get(key) !== attempt) return false;
    window.clearTimeout(attempt.timer);
    attempts.current.delete(key);
    setStopping((current) => without(current, key));
    return true;
  };

  const request = (key: string, run: () => Promise<void>) => {
    if (attempts.current.has(key)) return;
    const attempt = { timer: 0 };
    attempts.current.set(key, attempt);
    setFailed((current) => without(current, key));
    setStopping((current) => new Set(current).add(key));
    attempt.timer = window.setTimeout(() => settle(key, attempt), STOPPING_TIMEOUT_MS);
    dispatchStop(run, () => {
      if (settle(key, attempt)) setFailed((current) => new Set(current).add(key));
    });
  };

  return { stopping, failed, request };
}

function without(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  if (!set.has(key)) return set;
  const next = new Set(set);
  next.delete(key);
  return next;
}
