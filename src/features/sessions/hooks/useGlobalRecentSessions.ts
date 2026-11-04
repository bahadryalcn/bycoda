import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  finalizeRecentSessionPages,
  listRecentSessionsSincePage,
  type RecentSessionCursor,
  type SessionSummary,
} from "../data/sessionStore";
import type { Session } from "../model/session";
import { buildGlobalRecentSessions, GLOBAL_RECENT_WINDOW_MS } from "../model/globalRecentSessions";
import { isRemoteProjectPath } from "../../projects/model/recents";
import { t } from "../../../shared/i18n";

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
  const loaded = useRef(false);
  const running = useRef<Promise<void> | null>(null);
  const refresh = useCallback(() => setTick((value) => value + 1), []);
  // Referential churn alone must not restart a seven-day scan. The active
  // history projection still invalidates it when membership or data changes.
  const historyKey = useMemo(
    () =>
      enabled
        ? JSON.stringify(
            history
              .map((row) => [
                row.cwd,
                row.id,
                row.lastActivityAt ?? row.updatedAt,
                row.pinned,
                row.archived,
              ])
              .sort(
                (a, b) =>
                  String(a[0]).localeCompare(String(b[0])) ||
                  String(a[1]).localeCompare(String(b[1])),
              ),
          )
        : "",
    [enabled, history],
  );
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
    if (!loaded.current)
      queueMicrotask(() => {
        if (!cancelled) setLoading(true);
      });
    const timer = window.setTimeout(() => {
      const start = async () => {
        // One native page stream at a time; superseded runs stop at the next
        // response and the latest request waits for that physical completion.
        const previous = running.current;
        if (previous) await previous;
        if (cancelled) return;
        const work = (async () => {
          const since = Date.now() - GLOBAL_RECENT_WINDOW_MS;
          for (let attempt = 0; attempt < 3; attempt++) {
            const collected: SessionSummary[] = [];
            let cursor: RecentSessionCursor | null = null;
            const cursors = new Set<string>();
            try {
              do {
                const page = await listRecentSessionsSincePage(since, cursor);
                if (cancelled) return;
                collected.push(...page.rows);
                cursor = page.nextCursor;
                if (cursor) {
                  const key = JSON.stringify(cursor);
                  if (cursors.has(key)) throw new Error("Recent-session cursor did not advance.");
                  cursors.add(key);
                }
              } while (cursor);
              if (!cancelled) {
                setStored(finalizeRecentSessionPages(collected, since));
                setError(null);
                loaded.current = true;
              }
              return;
            } catch (reason) {
              if (cancelled) return;
              if (String(reason).includes("RECENT_SESSIONS_CHANGED")) {
                if (attempt < 2) continue;
                setError(t("Recent sessions changed while loading. Retry shortly."));
              } else setError(String(reason));
              return;
            }
          }
        })();
        running.current = work;
        try {
          await work;
        } finally {
          if (running.current === work) running.current = null;
        }
        if (!cancelled) setLoading(false);
      };
      void start().catch((reason: unknown) => {
        if (!cancelled) {
          setError(String(reason));
          setLoading(false);
        }
      });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, tick, historyKey]);
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
