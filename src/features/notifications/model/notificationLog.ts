import { t } from "../../../shared/i18n";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import { LOCKED_NOTIFICATION_TEXT } from "./attention";
import type { ToastAnnouncement } from "../../../shared/ui/ToastRegion";
import {
  recordNotificationHistory,
  type NotificationHistoryEntry,
  type NotificationHistoryKind,
} from "./notificationHistory";

/** A card never shows the same sentence as its title and its description. */
function distinctLabel(title: string, label: string): string {
  return title.trim() === label.trim() ? "" : label;
}

/** Recording never blocks or fails the announcement it belongs to. */
function record(entry: NotificationHistoryEntry) {
  void recordNotificationHistory(entry).catch(() => undefined);
}

/**
 * A toast announcement as the log reads it. `persist` (a notice that asks to be kept) and
 * `hasAction` (it carries an action) are optional extras of the announcing region.
 */
export type LoggedToastAnnouncement = ToastAnnouncement & { persist?: boolean; hasAction?: boolean };

/**
 * Keeps a toast in the capped device-local log only when it is a warning, an error, or asks to be
 * kept (`persist`, or an action). A transient "Saved" or "Copied" never reaches the center.
 */
export function logToastAnnouncement(entry: LoggedToastAnnouncement) {
  const tone = entry.tone === "danger" || entry.tone === "warning" ? entry.tone : undefined;
  if (!tone && !entry.persist && !entry.hasAction) return;
  record({
    key: entry.id,
    sessionId: "",
    cwd: "",
    title: truncateGraphemes(entry.title || entry.message, 200),
    label: truncateGraphemes(entry.title ? distinctLabel(entry.title, entry.message) : "", 2000),
    kind: tone === "danger" ? "failed" : "notice",
    ...(tone ? { tone } : {}),
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
  /** When the event happened (a turn end). */
  occurredAt: number;
  /** When it was announced, if later than `occurredAt`. */
  announcedAt?: number;
  locked?: boolean;
}) {
  record({
    key: entry.key,
    sessionId: entry.session?.id ?? "",
    cwd: entry.session?.cwd ?? "",
    ...(entry.target ? { target: entry.target } : {}),
    ...(entry.session?.harness ? { harness: entry.session.harness } : {}),
    title: entry.locked ? "" : entry.title,
    label: entry.locked
      ? t(LOCKED_NOTIFICATION_TEXT)
      : distinctLabel(entry.title, entry.label).slice(0, 2000),
    kind: entry.kind,
    occurredAt: entry.occurredAt,
    ...(entry.announcedAt !== undefined && entry.announcedAt > entry.occurredAt
      ? { announcedAt: entry.announcedAt }
      : {}),
  });
}
