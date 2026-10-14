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
  } catch {
    // History remains available in this window when storage is unavailable.
  }
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
