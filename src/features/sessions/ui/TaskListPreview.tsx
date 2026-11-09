import { StatusDot } from "../../../shared/ui/StatusDot";
import { Surface } from "../../../shared/ui/Surface";
import { Badge, StatusBadge } from "../../../shared/ui/Badge";
import { useT } from "../../../shared/i18n";
import { ListEnd, Minus } from "../../../shared/ui/icons";
import type { TaskListItem, TaskListItemStatus } from "../model/session";
import { taskListProgressLabel } from "../model/taskList";

type Props = {
  items: TaskListItem[];
  explanation?: string;
};

export function TaskListPreview({ items, explanation }: Props) {
  const t = useT();
  return (
    <Surface
      as="section"
      variant="quiet"
      padding="none"
      aria-label={t("Task progress")}
      className="mb-2 overflow-hidden"
    >
      <div className="flex items-start gap-2 border-b border-(--ui-tone-neutral-border) px-2.5 py-2">
        <ListEnd
          className="mt-0.5 icon-md shrink-0 text-(--ui-text-secondary)"
          strokeWidth={1.75}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-mono text-ui-caption font-medium text-(--ui-text-secondary)">
              {t("Tasks")}
            </h3>
            <Badge variant="count" size="xs" className="shrink-0">
              {taskListProgressLabel(items)}
            </Badge>
          </div>
          {explanation ? (
            <p className="mt-0.5 line-clamp-2 font-sans text-ui-micro leading-4 text-(--ui-text-secondary)">
              {explanation}
            </p>
          ) : null}
        </div>
      </div>
      <ol className="py-1">
        {items.map((item, index) => (
          <li
            key={item.id ?? `${index}:${item.text}`}
            className="flex min-w-0 items-start gap-2.5 px-2.5 py-1.5"
          >
            <TaskState status={item.status} />
            <span
              className={`min-w-0 flex-1 font-sans text-ui-secondary leading-4.5 ${
                item.status === "completed"
                  ? "text-(--ui-text-secondary) line-through decoration-content/25"
                  : item.status === "cancelled"
                    ? "text-(--ui-text-secondary) line-through decoration-content/20"
                    : item.status === "in_progress"
                      ? "text-(--ui-text-secondary)"
                      : "text-(--ui-text-secondary)"
              }`}
            >
              {item.text}
            </span>
          </li>
        ))}
      </ol>
    </Surface>
  );
}

function TaskState({ status }: { status: TaskListItemStatus }) {
  const t = useT();
  if (status === "completed" || status === "in_progress") {
    return (
      <StatusBadge
        status={status === "completed" ? "done" : "running"}
        iconOnly
        size="xs"
        className="mt-px"
      />
    );
  }
  if (status === "cancelled") {
    return (
      <Badge
        tone="neutral"
        size="xs"
        label={t("Cancelled")}
        role="img"
        icon={<Minus />}
        className="mt-px"
      />
    );
  }
  return <StatusDot tone="neutral" label={t("Pending")} className="mt-1" />;
}
