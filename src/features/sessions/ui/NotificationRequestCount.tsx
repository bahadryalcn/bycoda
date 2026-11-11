import { Badge } from "../../../shared/ui/Badge";

/**
 * Count badge on the notification trigger; the caller owns placement. `warning` means owner
 * requests (approvals, questions) are waiting; `accent` means only new log entries. Badge caps at 99+.
 */
export function NotificationRequestCount({
  id,
  count,
  tone = "warning",
}: {
  id: string;
  count: number;
  tone?: "warning" | "accent";
}) {
  return (
    <Badge id={id} variant="count" tone={tone} size="xs" className="notification-trigger-count">
      {count}
    </Badge>
  );
}
