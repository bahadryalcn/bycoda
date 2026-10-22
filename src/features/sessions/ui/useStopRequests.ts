import { useCallback, useEffect, useRef, useState } from "react";
import { STOPPING_TIMEOUT_MS } from "../model/backgroundStop";

/**
 * Stop requests in flight, by key (a tool call id, or `STOP_ALL`). A stop is
 * only a request: the row settles when the harness reports it ended, so the
 * button reads "Stopping…" until then, and comes back if nothing happened.
 */
export const STOP_ALL = "all";

export function useStopRequests() {
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const settle = useCallback((key: string) => {
    window.clearTimeout(timers.current.get(key));
    timers.current.delete(key);
    setStopping((current) => without(current, key));
  }, []);

  const request = useCallback(
    (key: string, run: () => Promise<void>) => {
      settle(key);
      setFailed((current) => without(current, key));
      setStopping((current) => new Set(current).add(key));
      timers.current.set(
        key,
        window.setTimeout(() => settle(key), STOPPING_TIMEOUT_MS),
      );
      run().catch(() => {
        settle(key);
        setFailed((current) => new Set(current).add(key));
      });
    },
    [settle],
  );

  return { stopping, failed, request };
}

function without(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  if (!set.has(key)) return set;
  const next = new Set(set);
  next.delete(key);
  return next;
}
