import type { ReactNode } from "react";
import { Badge } from "../../../shared/ui/Badge";
import { CheckCircle, CircleX, MessageSquare } from "../../../shared/ui/icons";

/** Review state keeps the same tone in comments and timeline marks. */
export function InboxReviewBadge({
  state,
  resolved,
  children,
}: {
  state?: string;
  resolved?: boolean;
  children?: ReactNode;
}) {
  const tone =
    state === "APPROVED" || resolved
      ? "success"
      : state === "CHANGES_REQUESTED"
        ? "danger"
        : "neutral";
  const Icon =
    state === "APPROVED" ? CheckCircle : state === "CHANGES_REQUESTED" ? CircleX : MessageSquare;
  return (
    <Badge
      size="xs"
      appearance="subtle"
      tone={tone}
      icon={children ? undefined : <Icon strokeWidth={1.75} />}
      aria-hidden={children ? undefined : true}
    >
      {children}
    </Badge>
  );
}
