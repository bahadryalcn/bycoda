import { EmptyState } from "../../../shared/ui/EmptyState";
import { useT } from "../../../shared/i18n";
import { TaskCreationSplit } from "./TaskToolbar";

/** First use keeps one way to start. */
export function TasksEmptyState({
  onCreate,
  disabled,
  epicDisabled,
  onCreateEpic,
}: {
  onCreate: () => void;
  disabled: boolean;
  epicDisabled: boolean;
  onCreateEpic: () => void;
}) {
  const t = useT();
  return (
    <EmptyState
      context="page"
      kind="empty"
      title={t("No tasks yet")}
      extra={
        <TaskCreationSplit
          create={{ visible: true, disabled, onCreate }}
          epic={{ disabled: epicDisabled, onCreate: onCreateEpic }}
        />
      }
    />
  );
}
