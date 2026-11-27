import { t } from "../../../../shared/i18n";
import type { BadgeTone } from "../../../../shared/ui/Badge";
import { SocialStatusDot } from "../common/SocialStatusDot";
import type { StatusTextStatus } from "../common/StatusText";

export type ContentState = Exclude<StatusTextStatus, "completed"> | "draft" | "paused";

const TONES: Record<ContentState, BadgeTone> = {
  succeeded: "success",
  queued: "info",
  running: "accent",
  failed: "danger",
  review: "warning",
  needs_human: "warning",
  delivery: "warning",
  cancelled: "neutral",
  draft: "neutral",
  paused: "warning",
};

export function contentStateTone(state: ContentState): BadgeTone {
  return TONES[state];
}

export function contentStateLabel(state: ContentState): string {
  switch (state) {
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
    case "draft":
      return t("Draft");
    case "paused":
      return t("Paused");
  }
}

/** The state as a named dot for calendar chips; the word is its accessible name. */
export function ContentStateDot({ state }: { state: ContentState }) {
  return <SocialStatusDot tone={contentStateTone(state)} label={contentStateLabel(state)} />;
}
