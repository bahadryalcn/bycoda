import type { NotificationHistoryEntry, NotificationHistoryTone } from "./notificationHistory";

/**
 * Severity shown as the row's leading icon. Failed turns and failed notices are errors; a
 * question, an approval, a reminder or a warning notice is a warning; everything else is calm.
 */
export function historyTone(entry: NotificationHistoryEntry): NotificationHistoryTone | undefined {
  if (entry.tone) return entry.tone;
  switch (entry.kind) {
    case "failed":
      return "danger";
    case "question":
    case "approval":
    case "reminder":
      return "warning";
    default:
      return undefined;
  }
}

/** Unread until the owner marks it read or marks everything read after its latest arrival. */
export function isHistoryUnread(entry: NotificationHistoryEntry, seenAt: number): boolean {
  return !entry.read && entry.occurredAt > seenAt;
}

/** Splits a newest-first list at local midnight; both halves keep their order. */
export function groupHistoryByDay<T>(
  entries: readonly T[],
  timeOf: (item: T) => number,
  now: number = Date.now(),
): { today: T[]; earlier: T[] } {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const cutoff = startOfDay.getTime();
  return {
    today: entries.filter((item) => timeOf(item) >= cutoff),
    earlier: entries.filter((item) => timeOf(item) < cutoff),
  };
}
