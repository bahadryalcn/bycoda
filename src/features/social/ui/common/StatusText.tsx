import { t } from "../../../../shared/i18n";
import { Badge, type BadgeTone } from "../../../../shared/ui/Badge";

export type StatusTextStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "review"
  | "cancelled"
  | "delivery"
  | "needs_human";

function statusWord(status: StatusTextStatus): string {
  switch (status) {
    case "succeeded":
      return t("Sent");
    case "queued":
      return t("Scheduled");
    case "running":
      return t("Sending");
    case "failed":
      return t("Failed");
    case "review":
      return t("Needs review");
    case "cancelled":
      return t("Cancelled");
    case "delivery":
    case "needs_human":
      return t("Waiting for you");
  }
}

function statusTone(status: StatusTextStatus): BadgeTone {
  switch (status) {
    case "succeeded":
      return "success";
    case "queued":
      return "info";
    case "running":
      return "accent";
    case "failed":
      return "danger";
    case "review":
    case "delivery":
    case "needs_human":
      return "warning";
    case "cancelled":
      return "neutral";
  }
}

/** Plain-language status of a job or delivery. Raw status codes are never shown. */
export function StatusText({ status }: { status: StatusTextStatus }) {
  return (
    <Badge tone={statusTone(status)} size="sm" className="social-status-text" data-status={status}>
      {statusWord(status)}
    </Badge>
  );
}
