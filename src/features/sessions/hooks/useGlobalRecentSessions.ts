import { useCallback, useEffect, useMemo, useState } from "react";
import { listRecentSessionsSince, type SessionSummary } from "../data/sessionStore";
import type { Session } from "../model/session";
import { buildGlobalRecentSessions, GLOBAL_RECENT_WINDOW_MS } from "../model/globalRecentSessions";
import { isRemoteProjectPath } from "../../projects/model/recents";

export function useGlobalRecentSessions(
  history: readonly SessionSummary[],
  sessions: readonly Session[],
  enabled: boolean,
  allowedProjectKeys: ReadonlySet<string>,
): {
  rows: SessionSummary[];
  loading: boolean;
  error: string | null;
  remoteHistoryLimited: boolean;
  refresh: () => void;
} {
  const [stored, setStored] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const refresh = useCallback(() => setTick((value) => value + 1), []);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setClock(Date.now());
    });
    const timer = window.setInterval(() => {
      setClock(Date.now());
      refresh();
    }, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled, refresh]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true);
        setError(null);
      }
    });
    const timer = window.setTimeout(
      () =>
        listRecentSessionsSince(Date.now() - GLOBAL_RECENT_WINDOW_MS).then(
          (rows) => {
            if (!cancelled) {
              setStored(rows);
              setLoading(false);
            }
          },
          (reason: unknown) => {
            if (!cancelled) {
              setError(String(reason));
              setLoading(false);
            }
          },
        ),
      300,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, tick, history]);
  const rows = useMemo(
    () => buildGlobalRecentSessions(stored, history, sessions, allowedProjectKeys, clock),
    [stored, history, sessions, allowedProjectKeys, clock],
  );
  return {
    rows,
    loading: enabled && loading,
    error,
    remoteHistoryLimited: [...allowedProjectKeys].some(isRemoteProjectPath),
    refresh,
  };
}
