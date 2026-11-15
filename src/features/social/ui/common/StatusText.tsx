import { t } from "../../../../shared/i18n";
import {
  StatusText as SharedStatusText,
  type StatusTextTone,
} from "../../../../shared/ui/StatusText";

export type StatusTextStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "completed"
  | "failed"
  | "review"
  | "cancelled"
  | "delivery"
  | "needs_human";

function statusWord(status: StatusTextStatus): string {
  switch (status) {
    case "succeeded":
      return t("Sent");
    case "completed":
      return t("Completed");
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

function statusTone(status: StatusTextStatus): StatusTextTone {
  switch (status) {
    case "succeeded":
    case "completed":
      return "done";
    case "running":
      return "running";
    case "failed":
      return "failed";
    case "review":
    case "delivery":
    case "needs_human":
      return "needs-you";
    case "queued":
    case "cancelled":
      return "idle";
  }
}

/** Plain-language status of a job or delivery. Raw status codes are never shown. */
export function StatusText({ status }: { status: StatusTextStatus }) {
  return (
    <SharedStatusText tone={statusTone(status)} data-status={status}>
      {statusWord(status)}
    </SharedStatusText>
  );
}
