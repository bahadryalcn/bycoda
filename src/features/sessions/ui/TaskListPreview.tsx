import { StatusDot } from "../../../shared/ui/StatusDot";
import { ClampText } from "../../../shared/ui/ClampText";
import { Surface } from "../../../shared/ui/Surface";
import { Heading } from "../../../shared/ui/Heading";
import { Text } from "../../../shared/ui/Text";
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
      variant="card"
      padding="none"
      className="mb-2 overflow-hidden font-sans"
      data-task-list
    >
      <div className="px-3.5 pt-2.5 pb-2">
        <div className="flex min-w-0 items-center gap-2.5 text-(--transcript-ink-emphasis)">
          <ListEnd className="icon-md shrink-0 text-(--transcript-ink-chrome)" strokeWidth={1.75} />
          <Heading size="section" tone="inherit" className="min-w-0 flex-1">
            {t("Tasks")}
          </Heading>
          <Badge variant="count" size="xs" className="shrink-0">
            {taskListProgressLabel(items)}
          </Badge>
        </div>
        {explanation ? (
          <ClampText
            as="p"
            lines={2}
            expandable={false}
            size="caption"
            tone="inherit"
            className="mt-1 font-sans text-(--transcript-ink-chrome)"
          >
            {explanation}
          </ClampText>
        ) : null}
        <ol className="mt-2 grid">
          {items.map((item, index) => (
            <li
              key={item.id ?? `${index}:${item.text}`}
              className="grid min-h-7 min-w-0 grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-2.5 py-1"
              data-task-status={item.status}
            >
              <span className="grid h-5 place-items-center">
                <TaskState status={item.status} />
              </span>
              <Text
                size="secondary"
                tone="inherit"
                className={`min-w-0 font-sans ${
                  item.status === "in_progress"
                    ? "text-(--transcript-ink-emphasis)"
                    : item.status === "completed" || item.status === "cancelled"
                      ? "text-(--transcript-ink-faint) line-through decoration-content/30"
                      : "text-(--transcript-ink-body)"
                }`}
              >
                {item.text}
              </Text>
              {item.status === "cancelled" ? (
                <Badge tone="neutral" size="xs">
                  {t("Cancelled")}
                </Badge>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </Surface>
  );
}

function TaskState({ status }: { status: TaskListItemStatus }) {
  const t = useT();
  if (status === "completed" || status === "in_progress") {
    return <StatusBadge status={status === "completed" ? "done" : "running"} iconOnly size="xs" />;
  }
  if (status === "cancelled") {
    return <Minus aria-hidden className="icon-xs text-(--transcript-ink-faint)" strokeWidth={2} />;
  }
  return <StatusDot tone="neutral" label={t("Pending")} />;
}
