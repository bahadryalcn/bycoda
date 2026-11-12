import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  finalizeRecentSessionPages,
  listRecentSessionsSincePage,
  type RecentSessionCursor,
  type SessionSummary,
} from "../data/sessionStore";
import type { Session } from "../model/session";
import { buildGlobalRecentSessions, GLOBAL_RECENT_WINDOW_MS } from "../model/globalRecentSessions";
import { isRemoteProjectPath } from "../../projects/public/recents";
import { t } from "../../../shared/i18n";
import { useStableValue } from "../../../shared/hooks/useStableValue";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";

// Summaries contain only small wire metadata, never transcript bodies. Compare
// nested metadata too: updatedAt alone does not cover pin or provider changes.
function sameRecentValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => sameRecentValue(value, b[index]))
    );
  }
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) && sameRecentValue(left[key], right[key]),
    )
  );
}

function sameRecentRows(previous: SessionSummary[], next: SessionSummary[]): boolean {
  return (
    previous.length === next.length &&
    previous.every((row, index) => sameRecentValue(row, next[index]))
  );
}

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
  const [clock, setClock] = useState(() => Date.now());
  const loaded = useRef(false);
  const running = useRef<Promise<void> | null>(null);
  const refreshRun = useRef<(() => void) | null>(null);
  const refresh = useCallback(() => refreshRun.current?.(), []);
  const projectedRows = useMemo(
    () => buildGlobalRecentSessions(stored, history, sessions, allowedProjectKeys, clock),
    [stored, history, sessions, allowedProjectKeys, clock],
  );
  const rows = useStableValue(projectedRows, sameRecentRows);
  const updateClock = useStableCallback(() => {
    const now = Date.now();
    if (
      !sameRecentRows(
        rows,
        buildGlobalRecentSessions(stored, history, sessions, allowedProjectKeys, now),
      )
    ) {
      setClock(now);
    }
  });
  const publishStored = useStableCallback((next: SessionSummary[]) => {
    if (!sameRecentRows(stored, next)) setStored(next);
  });
  const publishError = useStableCallback((next: string | null) => {
    if (error !== next) setError(next);
  });
  const publishLoading = useStableCallback((next: boolean) => {
    if (loading !== next) setLoading(next);
  });
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
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Sync the recent cutoff and refresh with the minute timer and window visibility.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) updateClock();
    });
    const tickNow = () => {
      updateClock();
      refresh();
    };
    const timer = window.setInterval(() => {
      if (!document.hidden) tickNow();
    }, 60_000);
    const onVisible = () => {
      if (!document.hidden) tickNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, refresh, updateClock]);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Own the debounced native page stream and cancel superseded requests until physical completion.
  useEffect(() => {
    if (!enabled) return;
    let cancelRun = () => {};
    const schedule = () => {
      cancelRun();
      let cancelled = false;
      if (!loaded.current)
        queueMicrotask(() => {
          if (!cancelled) publishLoading(true);
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
                  publishStored(finalizeRecentSessionPages(collected, since));
                  publishError(null);
                  loaded.current = true;
                }
                return;
              } catch (reason) {
                if (cancelled) return;
                if (String(reason).includes("RECENT_SESSIONS_CHANGED")) {
                  if (attempt < 2) continue;
                  publishError(t("Recent sessions changed while loading. Retry shortly."));
                } else publishError(String(reason));
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
          if (!cancelled) publishLoading(false);
        };
        void start().catch((reason: unknown) => {
          if (!cancelled) {
            publishError(String(reason));
            publishLoading(false);
          }
        });
      }, 300);
      cancelRun = () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    };
    refreshRun.current = schedule;
    schedule();
    return () => {
      cancelRun();
      refreshRun.current = null;
    };
  }, [enabled, historyKey, publishStored, publishError, publishLoading]);
  const remoteHistoryLimited = useMemo(
    () => [...allowedProjectKeys].some(isRemoteProjectPath),
    [allowedProjectKeys],
  );
  const visibleLoading = enabled && loading;
  return useMemo(
    () => ({ rows, loading: visibleLoading, error, remoteHistoryLimited, refresh }),
    [rows, visibleLoading, error, remoteHistoryLimited, refresh],
  );
}
