import type { NotificationHistoryEntry, NotificationHistoryTone } from "./notificationHistory";

/**
 * Severity shown as the row's leading icon. Only real errors (failed turns, failed notices) and
 * warnings (a warning notice) carry one; a question, an approval or a reminder is unread, not
 * a warning, so it has no tone and shows the neutral unread dot instead.
 */
export function historyTone(entry: NotificationHistoryEntry): NotificationHistoryTone | undefined {
  if (entry.tone) return entry.tone;
  return entry.kind === "failed" ? "danger" : undefined;
}

/** Unread until the owner marks it read or marks everything read after its latest arrival. */
export function isHistoryUnread(entry: NotificationHistoryEntry, seenAt: number): boolean {
  return !entry.read && entry.occurredAt > seenAt;
}

/** Splits a newest-first list at local midnight; both halves keep their order. */
export function groupHistoryByDay<T>(
  entries: readonly T[],
  timeOf: (item: T) => number,
  now: number,
): { today: T[]; earlier: T[] } {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const cutoff = startOfDay.getTime();
  return {
    today: entries.filter((item) => timeOf(item) >= cutoff),
    earlier: entries.filter((item) => timeOf(item) < cutoff),
  };
}
