import { ProjectMascot } from "../../projects/public/ProjectMascot";
import { EmptyState } from "../../../shared/ui/EmptyState";

/** A quiet empty state for a workspace with no sessions yet. */
export function SessionsEmpty({ message }: { message: string }) {
  return (
    <EmptyState
      context="panel"
      kind="empty"
      icon={<ProjectMascot project="workspace" name="bridge" tone="secondary" className="size-8" />}
      description={message}
    />
  );
}
