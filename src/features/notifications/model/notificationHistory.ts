import type { PendingApprovalNotice } from "./approvalToast";
import type { HarnessId, Session } from "../../sessions/model/session";

export const NOTIFICATION_HISTORY_KEY = "bycoda.notifications.history.v1";
export const MAX_NOTIFICATION_HISTORY = 100;
/**
 * What the log records: the questions and approvals waiting on the owner, and
 * the other things the app announced (finished/failed turns, reminders,
 * assistant, background work, account items).
 */
export const NOTIFICATION_HISTORY_KINDS = [
  "approval",
  "question",
  "finished",
  "failed",
  "reminder",
  "assistant",
  "background",
  "account",
] as const;
export type NotificationHistoryKind = (typeof NOTIFICATION_HISTORY_KINDS)[number];

/** Window event after this window recorded an entry; other windows get `storage`. */
export const NOTIFICATION_HISTORY_EVENT = "bycoda:notification-history-change";

export type NotificationHistoryEntry = {
  key: string;
  /** The conversation a click opens; empty for entries with a background `target`. */
  sessionId: string;
  /** Project of the conversation; empty for entries with a background `target`. */
  cwd: string;
  /** `background:tasks|automations|summary|account|assistant`; absent for conversations. */
  target?: string;
  title: string;
  /** Absent in entries stored before the provider was recorded. */
  harness?: HarnessId;
  label: string;
  kind: NotificationHistoryKind;
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
          NOTIFICATION_HISTORY_KINDS.includes(item.kind) &&
          (item.target === undefined || typeof item.target === "string") &&
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

const sameOccurrence = (a: NotificationHistoryEntry, b: NotificationHistoryEntry) =>
  a.key === b.key && a.occurredAt === b.occurredAt;

/**
 * Removes one recorded arrival and returns the stored list, or `null` when the
 * store could not be read or written (nothing was removed). Other windows'
 * newer arrivals are kept: the removal applies to the stored list, not `local`.
 */
export function removeNotificationHistoryEntry(
  target: NotificationHistoryEntry,
): NotificationHistoryEntry[] | null | Promise<NotificationHistoryEntry[] | null> {
  return withHistoryLock(() => {
    const read = readNotificationHistoryStatus();
    if (read.state !== "ready") return null;
    const index = read.entries.findIndex((entry) => sameOccurrence(entry, target));
    if (index < 0) return read.entries;
    const next = read.entries.filter((_, at) => at !== index);
    return writeNotificationHistory(next) ? next : null;
  });
}

/**
 * Records one announced event under the same lock as every other write. An
 * entry with the same key and time is already there (another window or a
 * repeated delivery) and is not added twice. Resolves with whether the list
 * changed; recording is best effort and never throws.
 */
export async function recordNotificationHistory(entry: NotificationHistoryEntry): Promise<boolean> {
  try {
    const recorded = await withHistoryLock(() => {
      const read = readNotificationHistoryStatus();
      if (read.state !== "ready" || read.entries.some((item) => sameOccurrence(item, entry))) {
        return false;
      }
      return writeNotificationHistory(mergeNotificationHistory([entry], read.entries));
    });
    if (recorded && typeof window !== "undefined") {
      window.dispatchEvent(new Event(NOTIFICATION_HISTORY_EVENT));
    }
    return recorded;
  } catch {
    return false;
  }
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
