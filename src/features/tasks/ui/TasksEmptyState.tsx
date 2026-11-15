import { EmptyState } from "../../../shared/ui/EmptyState";
import { useT } from "../../../shared/i18n";

/** First use keeps one way to start. */
export function TasksEmptyState({
  onCreate,
  disabled,
}: {
  onCreate: () => void;
  disabled: boolean;
}) {
  const t = useT();
  return (
    <EmptyState
      context="page"
      kind="empty"
      title={t("No tasks yet")}
      action={{ label: t("New task"), disabled, onClick: onCreate }}
    />
  );
}
