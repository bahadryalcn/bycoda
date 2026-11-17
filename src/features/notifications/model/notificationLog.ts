import { t } from "../../../shared/i18n";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import { LOCKED_NOTIFICATION_TEXT } from "./attention";
import type { ToastAnnouncement } from "../../../shared/ui/ToastRegion";
import {
  recordNotificationHistory,
  type NotificationHistoryEntry,
  type NotificationHistoryKind,
} from "./notificationHistory";

/** Recording never blocks or fails the announcement it belongs to. */
function record(entry: NotificationHistoryEntry) {
  void recordNotificationHistory(entry).catch(() => undefined);
}

/** Keep expired and dismissed toast text in the existing capped device-local log. */
export function logToastAnnouncement(entry: ToastAnnouncement) {
  record({
    key: entry.id,
    sessionId: "",
    cwd: "",
    title: truncateGraphemes(entry.title || entry.message, 200),
    label: truncateGraphemes(entry.message, 2000),
    kind: entry.tone === "danger" ? "failed" : "background",
    occurredAt: entry.occurredAt,
  });
}

export type OwnerRequestOutcome =
  | "approved"
  | "denied"
  | "expired"
  | "submitted"
  | "cancelled"
  | "closed";

function ownerOutcomeLabel(outcome: OwnerRequestOutcome): string {
  switch (outcome) {
    case "approved":
      return t("Approved");
    case "denied":
      return t("Denied");
    case "expired":
      return t("Expired");
    case "submitted":
      return t("Submitted");
    case "cancelled":
      return t("Cancelled");
    default:
      return t("Closed");
  }
}

/**
 * Logs how an owner request ended, once. Only the request title and the outcome are kept:
 * never the message, details or a typed secret.
 */
export function logOwnerRequest(entry: {
  id: string;
  title: string;
  outcome: OwnerRequestOutcome;
}) {
  record({
    key: `owner:${entry.id}`,
    sessionId: "",
    cwd: "",
    title: truncateGraphemes(entry.title, 200),
    label: ownerOutcomeLabel(entry.outcome),
    kind: "owner",
    occurredAt: Date.now(),
  });
}

/**
 * Logs one announced event: a conversation (finished, failed, reminder) or a view
 * (`background:*` target). Text in a locked group is replaced by the banner's masked wording.
 */
export function logNotification(entry: {
  kind: Exclude<NotificationHistoryKind, "approval" | "question" | "owner">;
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
