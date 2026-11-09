import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendNotificationHistory,
  clearNotificationHistory,
  historyEntry,
  mergeNotificationHistory,
  notificationKey,
  NOTIFICATION_HISTORY_KEY,
  readNotificationHistoryStatus,
  removeNotificationHistoryEntry,
  type NotificationHistoryEntry,
} from "../model/notificationHistory";

type Notice = Parameters<typeof historyEntry>[0];

/**
 * The request center's arrival history: records each new pending request once,
 * follows other windows through storage events, and removes one entry or all of
 * them only after the durable write is confirmed. `remove` and `clear` resolve
 * `false` when nothing was removed.
 */
export function useNotificationHistory(notices: readonly Notice[]) {
  const [history, setHistory] = useState(() => readNotificationHistoryStatus().entries);
  const [unavailable, setUnavailable] = useState(
    () => readNotificationHistoryStatus().state === "unavailable",
  );
  const [clearError, setClearError] = useState(false);
  const [clearing, setClearing] = useState(false);
  const local = useRef(history);
  const mutation = useRef(0);
  const previousRequests = useRef<Set<string> | null>(null);

  useEffect(() => {
    const previous = previousRequests.current;
    const arrivals = notices.filter((notice) =>
      previous
        ? !previous.has(notificationKey(notice))
        : !history.some((entry) => entry.key === notificationKey(notice)),
    );
    previousRequests.current = new Set(notices.map(notificationKey));
    if (!arrivals.length) return;
    const additions = arrivals.map(historyEntry).reverse();
    const current = local.current;
    local.current = mergeNotificationHistory(additions, current);
    setHistory(local.current);
    const started = ++mutation.current;
    // Persistence is an effect, never a React updater: StrictMode may replay
    // updater functions, which would append the same occurrence twice.
    void Promise.resolve(appendNotificationHistory(additions, current))
      .then((next) => {
        if (mutation.current !== started) return;
        local.current = next;
        setHistory(next);
      })
      .catch(() => {
        /* Keep the local history if optional persistence fails. */
      });
  }, [notices, history]);

  // An unreadable store must not look like an empty history, and must not
  // erase what this window still holds.
  const reload = useCallback(() => {
    const read = readNotificationHistoryStatus();
    setUnavailable(read.state === "unavailable");
    if (read.state === "ready") {
      local.current = read.entries;
      setHistory(read.entries);
    }
  }, []);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === NOTIFICATION_HISTORY_KEY || event.key === null) reload();
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [reload]);

  // The list only empties once the durable clear is confirmed.
  const clear = useCallback(async (): Promise<boolean> => {
    mutation.current += 1;
    setClearing(true);
    let cleared = false;
    try {
      cleared = (await clearNotificationHistory()) !== false;
    } catch {
      cleared = false;
    } finally {
      setClearing(false);
    }
    setClearError(!cleared);
    if (!cleared) {
      reload();
      return false;
    }
    setUnavailable(false);
    local.current = [];
    setHistory([]);
    return true;
  }, [reload]);

  // The row only leaves once the durable removal is confirmed.
  const remove = useCallback(
    async (entry: NotificationHistoryEntry): Promise<boolean> => {
      mutation.current += 1;
      let stored: NotificationHistoryEntry[] | null = null;
      try {
        stored = await removeNotificationHistoryEntry(entry);
      } catch {
        stored = null;
      }
      if (!stored) {
        reload();
        return false;
      }
      setUnavailable(false);
      local.current = stored;
      setHistory(stored);
      return true;
    },
    [reload],
  );

  return { history, unavailable, clearError, clearing, reload, clear, remove };
}
