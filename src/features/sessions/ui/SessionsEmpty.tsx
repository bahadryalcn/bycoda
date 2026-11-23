import { EmptyState } from "../../../shared/ui/EmptyState";

/** A quiet empty state for a workspace with no sessions yet. */
export function SessionsEmpty({ message }: { message: string }) {
  return <EmptyState context="list" size="inline" kind="empty" description={message} />;
}
