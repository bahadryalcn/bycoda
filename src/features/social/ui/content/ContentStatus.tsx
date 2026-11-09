import { t } from "../../../../shared/i18n";
import { Badge, type BadgeTone } from "../../../../shared/ui/Badge";
import { StatusDot } from "../../../../shared/ui/StatusDot";
import type { StatusTextStatus } from "../common/StatusText";

export type ContentState = StatusTextStatus | "draft" | "paused";

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
  paused: "neutral",
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

/** Status of a post as a toned badge; the word always shows, color never carries it alone. */
export function ContentStateBadge({ state }: { state: ContentState }) {
  return (
    <Badge size="sm" tone={contentStateTone(state)}>
      {contentStateLabel(state)}
    </Badge>
  );
}

/** Dot plus word for the narrow calendar chips. */
export function ContentStateDot({ state }: { state: ContentState }) {
  return (
    <span className="content-chip-status">
      <StatusDot tone={contentStateTone(state)} />
      <span>{contentStateLabel(state)}</span>
    </span>
  );
}
