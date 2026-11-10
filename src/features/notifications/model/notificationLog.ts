import { t } from "../../../shared/i18n";
import { LOCKED_NOTIFICATION_TEXT } from "./attention";
import {
  recordNotificationHistory,
  type NotificationHistoryEntry,
  type NotificationHistoryKind,
} from "./notificationHistory";

/** Recording never blocks or fails the announcement it belongs to. */
function record(entry: NotificationHistoryEntry) {
  void recordNotificationHistory(entry).catch(() => undefined);
}

/**
 * Logs one announced event: a conversation (finished, failed, reminder) or a view
 * (`background:*` target). Text in a locked group is replaced by the banner's masked wording.
 */
export function logNotification(entry: {
  kind: Exclude<NotificationHistoryKind, "approval" | "question">;
  key: string;
  title: string;
  label: string;
  /** `background:*` target; reminders carry a conversation instead. */
  target?: string;
  session?: { id: string; cwd: string; harness?: NotificationHistoryEntry["harness"] };
  occurredAt: number;
  locked?: boolean;
}) {
  record({
    key: entry.key,
    sessionId: entry.session?.id ?? "",
    cwd: entry.session?.cwd ?? "",
    ...(entry.target ? { target: entry.target } : {}),
    ...(entry.session?.harness ? { harness: entry.session.harness } : {}),
    title: entry.locked ? "" : entry.title,
    label: entry.locked ? t(LOCKED_NOTIFICATION_TEXT) : entry.label.slice(0, 2000),
    kind: entry.kind,
    occurredAt: entry.occurredAt,
  });
}
