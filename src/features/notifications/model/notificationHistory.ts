import type { PendingApprovalNotice } from "./approvalToast";
import type { Session } from "../../sessions/model/session";

export const NOTIFICATION_HISTORY_KEY = "bycoda.notifications.history.v1";
export const MAX_NOTIFICATION_HISTORY = 100;
export type NotificationHistoryEntry = {
  key: string;
  sessionId: string;
  cwd: string;
  title: string;
  label: string;
  kind: PendingApprovalNotice["kind"];
  occurredAt: number;
};
export const notificationKey = (notice: PendingApprovalNotice) =>
  `${notice.sessionId}:${notice.kind}:${notice.requestId}`;

export function readNotificationHistory(): NotificationHistoryEntry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(NOTIFICATION_HISTORY_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is NotificationHistoryEntry =>
          item != null &&
          typeof item === "object" &&
          [item.key, item.sessionId, item.cwd, item.title, item.label].every(
            (field) => typeof field === "string",
          ) &&
          (item.kind === "approval" || item.kind === "question") &&
          Number.isFinite(item.occurredAt) &&
          item.occurredAt >= 0 &&
          item.occurredAt <= 8_640_000_000_000_000,
      )
      .slice(0, MAX_NOTIFICATION_HISTORY);
  } catch {
    return [];
  }
}

export function writeNotificationHistory(entries: NotificationHistoryEntry[]) {
  try {
    localStorage.setItem(
      NOTIFICATION_HISTORY_KEY,
      JSON.stringify(entries.slice(0, MAX_NOTIFICATION_HISTORY)),
    );
    return true;
  } catch {
    // History remains available in this window when storage is unavailable.
    return false;
  }
}

/** Arrivals merge at write time, rather than replacing another window's newer
 * list with component-local state. Explicit clear continues to replace it. */
function withHistoryLock<T>(mutate: () => T): T | Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks) return mutate();
  let entered = false;
  return navigator.locks
    .request(NOTIFICATION_HISTORY_KEY, () => {
      entered = true;
      return mutate();
    })
    .catch((error: unknown) => {
      // Unsupported/denied Web Locks retain the existing storage fallback. Never
      // replay a mutation when a callback itself failed after entering the lock.
      if (entered) throw error;
      return mutate();
    });
}

export function mergeNotificationHistory(
  arrivals: NotificationHistoryEntry[],
  existing: NotificationHistoryEntry[],
): NotificationHistoryEntry[] {
  // Request IDs may be reused after resolution: retain distinct arrivals.
  return [...arrivals, ...existing]
    .sort((a, b) => b.occurredAt - a.occurredAt)
    .slice(0, MAX_NOTIFICATION_HISTORY);
}

export function appendNotificationHistory(
  arrivals: NotificationHistoryEntry[],
  local: NotificationHistoryEntry[] = [],
): NotificationHistoryEntry[] | Promise<NotificationHistoryEntry[]> {
  return withHistoryLock(() => {
    const next = mergeNotificationHistory(arrivals, readNotificationHistory());
    return writeNotificationHistory(next) ? next : mergeNotificationHistory(arrivals, local);
  });
}

export function clearNotificationHistory(): boolean | Promise<boolean> {
  return withHistoryLock(() => writeNotificationHistory([]));
}

export function historyEntry(
  notice: PendingApprovalNotice & { session: Session },
): NotificationHistoryEntry {
  return {
    key: notificationKey(notice),
    sessionId: notice.sessionId,
    cwd: notice.session.cwd,
    title: notice.session.title,
    label: notice.label.slice(0, 2000),
    kind: notice.kind,
    occurredAt: Date.now(),
  };
}
