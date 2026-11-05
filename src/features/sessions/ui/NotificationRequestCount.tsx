import { Badge } from "../../../shared/ui/Badge";

/** Pending owner requests share warning tone; the caller owns trigger placement. */
export function NotificationRequestCount({ id, count }: { id: string; count: number }) {
  return (
    <Badge id={id} variant="count" tone="warning" size="xs" className="notification-trigger-count">
      {count}
    </Badge>
  );
}
