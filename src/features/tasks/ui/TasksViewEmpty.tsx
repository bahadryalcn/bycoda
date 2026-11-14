import { FailureState } from "../../../shared/ui/FailureState";
import { useT } from "../../../shared/i18n";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Button } from "../../../shared/ui/Button";
import { TasksEmptyState } from "./TasksEmptyState";

/** One answer for "no task is visible": unreadable board, filters hiding tasks, all planned, or none. */
export function TasksViewEmpty({
  unreadable,
  retrying,
  hasVisibleTasks,
  narrowed,
  onboarding,
  createDisabled,
  onRetry,
  onReset,
  onCreate,
  emptySprint = false,
  onBacklog,
}: {
  unreadable: string | null;
  retrying: boolean;
  hasVisibleTasks: boolean;
  narrowed: boolean;
  onboarding: boolean;
  createDisabled: boolean;
  onRetry: () => void;
  onReset: () => void;
  onCreate: () => void;
  emptySprint?: boolean;
  onBacklog?: () => void;
}) {
  const t = useT();
  if (unreadable)
    return (
      <FailureState
        context="panel"

        title={t("Tasks unavailable")}
        description={unreadable}
        onRetry={onRetry}
        retrying={retrying}
      />
    );
  if (emptySprint)
    return (
      <EmptyState
        context="panel"
        title={t("No tasks in this sprint")}
        description={t("Add tasks from Backlog.")}
        action={
          <Button variant="secondary" onClick={onBacklog}>
            {t("Backlog")}
          </Button>
        }
      />
    );
  if (hasVisibleTasks && narrowed)
    return (
      <EmptyState
        context="panel"
        kind="filtered"
        icon={null}
        description={t("No tasks match your search or filters.")}
        onReset={onReset}
      />
    );
  if (hasVisibleTasks)
    return (
      <EmptyState
        context="panel"
        kind="empty"
        icon={null}
        description={t("Every task is planned in a sprint.")}
      />
    );
  // The one New task action lives here; the toolbar leaves it out while there is nothing else.
  if (onboarding) return <TasksEmptyState onCreate={onCreate} disabled={createDisabled} />;
  return (
    <EmptyState
      context="panel"
      kind="empty"
      title={t("No tasks yet")}
      description={t("Use New task to give an agent something to work on.")}
    />
  );
}
