import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import type { PlanningRecovery } from "./useTaskBoardOperations";

/** Sprint assignments that failed after the task or goal was created, each with a retry. */
export function TasksViewRecovery({
  items,
  retrying,
  onRetry,
}: {
  items: readonly PlanningRecovery[];
  retrying: string | null;
  onRetry: (item: PlanningRecovery) => void;
}) {
  const t = useT();
  if (!items.length) return null;
  return (
    <ul className="task-planning-recovery" aria-label={t("Pending sprint assignments")}>
      {items.map((item) => (
        <li key={item.id}>
          <span>{item.title}</span>
          <Button
            variant="secondary"
            loading={retrying === item.id}
            disabled={retrying !== null && retrying !== item.id}
            onClick={() => onRetry(item)}
          >
            {t("Retry sprint assignment")}
          </Button>
        </li>
      ))}
    </ul>
  );
}
