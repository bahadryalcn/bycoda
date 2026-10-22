import { Badge } from "../../../shared/ui/Badge";
import { t, useLocale } from "../../../shared/i18n";
import { Check, ListEnd, Loader, Minus } from "../../../shared/ui/icons";
import type { TaskListItem, TaskListItemStatus } from "../model/session";
import { taskListProgressLabel } from "../model/taskList";

type Props = {
  items: TaskListItem[];
  explanation?: string;
};

export function TaskListPreview({ items, explanation }: Props) {
  useLocale();
  return (
    <section
      aria-label={t("Task progress")}
      className="mb-2 overflow-hidden rounded-[10px] border border-(--ui-tone-neutral-border) bg-(--ui-tone-neutral-solid)/[0.035]"
    >
      <div className="flex items-start gap-2 border-b border-(--ui-tone-neutral-border) px-2.5 py-2">
        <ListEnd className="mt-0.5 size-4 shrink-0 text-(--ui-text-secondary)" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-mono text-[12px] font-medium text-(--ui-text-secondary)">
              {t("Tasks")}
            </h3>
            <Badge tone="neutral" className="shrink-0">
              {taskListProgressLabel(items)}
            </Badge>
          </div>
          {explanation ? (
            <p className="mt-0.5 line-clamp-2 font-sans text-[11.5px] leading-4 text-(--ui-text-secondary)">
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
              className={`min-w-0 flex-1 font-sans text-[12.5px] leading-4.5 ${
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
    </section>
  );
}

function TaskState({ status }: { status: TaskListItemStatus }) {
  useLocale();
  if (status === "completed") {
    return (
      <span
        aria-label={t("Completed")}
        className="mt-px grid size-4 shrink-0 place-items-center rounded-full bg-(--ui-tone-success-subtle) text-on-solid"
      >
        <Check className="size-2.5" strokeWidth={3} />
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span
        aria-label={t("In progress")}
        className="mt-px grid size-4 shrink-0 place-items-center text-(--ui-tone-info-fg)"
      >
        <Loader className="size-4 motion-safe:animate-spin" strokeWidth={2} />
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span
        aria-label={t("Cancelled")}
        className="mt-px grid size-4 shrink-0 place-items-center rounded-full bg-(--ui-surface-raised) text-(--ui-text-secondary)"
      >
        <Minus className="size-2.5" strokeWidth={2} />
      </span>
    );
  }
  return (
    <span
      aria-label={t("Pending")}
      className="mt-px size-4 shrink-0 rounded-full border border-(--ui-tone-neutral-border) bg-(--ui-tone-neutral-solid)/[0.02]"
    />
  );
}
