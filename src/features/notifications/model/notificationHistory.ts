import type { PendingApprovalNotice } from "./approvalToast";
import type { HarnessId, Session } from "../../sessions/model/session";

export const NOTIFICATION_HISTORY_KEY = "bycoda.notifications.history.v1";
export const MAX_NOTIFICATION_HISTORY = 100;
export type NotificationHistoryEntry = {
  key: string;
  sessionId: string;
  cwd: string;
  title: string;
  /** Absent in entries stored before the provider was recorded. */
  harness?: HarnessId;
  label: string;
  kind: PendingApprovalNotice["kind"];
  occurredAt: number;
};
export const notificationKey = (notice: PendingApprovalNotice) =>
  `${notice.sessionId}:${notice.kind}:${notice.requestId}`;

/** `unavailable` means storage could not be read, which is not the same as no history. */
export type NotificationHistoryRead = {
  state: "ready" | "unavailable";
  entries: NotificationHistoryEntry[];
};

export function readNotificationHistory(): NotificationHistoryEntry[] {
  return readNotificationHistoryStatus().entries;
}

export function readNotificationHistoryStatus(): NotificationHistoryRead {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(NOTIFICATION_HISTORY_KEY) ?? "[]");
    if (!Array.isArray(value)) return { state: "unavailable", entries: [] };
    const entries = value
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
    return { state: "ready", entries };
  } catch {
    return { state: "unavailable", entries: [] };
  }
}

/**
 * Stable occurrence identity for rendering: a request ID may be reused, so the
 * arrival time joins the key, and only identical pairs get an ordinal. New
 * arrivals prepend without renaming the older rows.
 */
export function historyOccurrenceIds(entries: readonly NotificationHistoryEntry[]): string[] {
  const seen = new Map<string, number>();
  return entries.map((entry) => {
    const base = `${entry.key}:${entry.occurredAt}`;
    const ordinal = seen.get(base) ?? 0;
    seen.set(base, ordinal + 1);
    return ordinal ? `${base}:${ordinal}` : base;
  });
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
    // Unreadable storage is not an empty history: keep what the caller still has.
    const read = readNotificationHistoryStatus();
    const next = mergeNotificationHistory(arrivals, read.state === "ready" ? read.entries : local);
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
    harness: notice.session.harness,
    label: notice.label.slice(0, 2000),
    kind: notice.kind,
    occurredAt: Date.now(),
  };
}
