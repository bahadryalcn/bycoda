import { FailureState } from "../../../shared/ui/FailureState";
import { useT } from "../../../shared/i18n";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { TasksEmptyState } from "./TasksEmptyState";

/** One answer for "no task is visible": unreadable board, filters hiding tasks, all planned, or none. */
export function TasksViewEmpty({
  unreadable,
  retrying,
  hasVisibleTasks,
  narrowed,
  onboarding,
  createDisabled,
  epicDisabled,
  onRetry,
  onReset,
  onCreate,
  onCreateEpic,
  emptySprint = false,
  onBacklog,
  onSprints,
}: {
  unreadable: string | null;
  retrying: boolean;
  hasVisibleTasks: boolean;
  narrowed: boolean;
  onboarding: boolean;
  createDisabled: boolean;
  epicDisabled: boolean;
  onRetry: () => void;
  onReset: () => void;
  onCreate: () => void;
  onCreateEpic: () => void;
  emptySprint?: boolean;
  onBacklog?: () => void;
  onSprints: () => void;
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
        action={onBacklog ? { label: t("Browse tasks"), onClick: onBacklog } : undefined}
      />
    );
  if (narrowed)
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
        action={{ label: t("Sprints"), onClick: onSprints }}
      />
    );
  // The one New task action lives here; the toolbar leaves it out while there is nothing else.
  if (onboarding)
    return (
      <TasksEmptyState
        onCreate={onCreate}
        disabled={createDisabled}
        epicDisabled={epicDisabled}
        onCreateEpic={onCreateEpic}
      />
    );
  return <EmptyState context="panel" kind="empty" title={t("No tasks yet")} />;
}
