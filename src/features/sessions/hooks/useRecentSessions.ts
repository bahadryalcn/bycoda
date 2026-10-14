import { useCallback, useEffect, useState } from "react";
import { listRecentSessions, type SessionSummary } from "../data/sessionStore";
import { RECENT_SESSION_FETCH_LIMIT, type LiveSessionInfo } from "../model/recentSessions";

const REFETCH_DELAY_MS = 300;

/**
 * The newest stored sessions across every project. There is no store event to
 * subscribe to, so it refetches (debounced) when the current project's list
 * changes, when a session's title or status changes, and on `refresh()`.
 */
export function useRecentSessions(
  history: readonly SessionSummary[],
  live: readonly LiveSessionInfo[],
  enabled: boolean,
): { rows: SessionSummary[]; refresh: () => void } {
  const [rows, setRows] = useState<SessionSummary[]>([]);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      listRecentSessions(RECENT_SESSION_FETCH_LIMIT)
        .then((next) => {
          if (!cancelled) setRows(next);
        })
        .catch(() => {
          // Keep what is shown; the next change tries again.
        });
    }, REFETCH_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, history, live, tick]);

  return { rows, refresh };
}
