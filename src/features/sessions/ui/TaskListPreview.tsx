import { StatusDot } from "../../../shared/ui/StatusDot";
import { ClampText } from "../../../shared/ui/ClampText";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Surface } from "../../../shared/ui/Surface";
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
      variant="quiet"
      padding="none"
      aria-label={t("Task progress")}
      className="mb-2 overflow-hidden"
    >
      <div
        {...surfaceAttributes(
          { frame: "neutral", edge: "bottom" },
          "flex items-start gap-2 px-2.5 py-2",
        )}
      >
        <ListEnd className="mt-0.5 icon-md shrink-0" tone="secondary" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <SectionLabel as="h3">{t("Tasks")}</SectionLabel>
            <Badge variant="count" size="xs" className="shrink-0">
              {taskListProgressLabel(items)}
            </Badge>
          </div>
          {explanation ? (
            <ClampText
              as="p"
              lines={2}
              expandable={false}
              size="micro"
              className="mt-0.5 font-sans"
            >
              {explanation}
            </ClampText>
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
            <Text
              size="secondary"
              tone="secondary"
              className={`min-w-0 flex-1 font-sans ${
                item.status === "completed"
                  ? "line-through decoration-content/25"
                  : item.status === "cancelled"
                    ? "line-through decoration-content/20"
                    : ""
              }`}
            >
              {item.text}
            </Text>
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
        className="mt-0"
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
        className="mt-0"
      />
    );
  }
  return <StatusDot tone="neutral" label={t("Pending")} className="mt-1" />;
}
