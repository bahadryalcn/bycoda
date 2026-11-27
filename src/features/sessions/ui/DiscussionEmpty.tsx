import { EmptyState } from "../../../shared/ui/EmptyState";

/** A quiet empty state for a workspace with no discussion yet. */
export function DiscussionEmpty({ message }: { message: string }) {
  return (
    <EmptyState
      context="panel"
      kind="empty"
      illustration="chat-empty"
      className="min-h-full"
      description={message}
    />
  );
}
