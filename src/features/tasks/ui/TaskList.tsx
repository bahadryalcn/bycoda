import { useT } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { bulkTaskKey } from "../model/taskBulkActions";
import type { BoardTask } from "../model/taskClient";
import { taskStatusLine } from "../model/taskStatusLine";
import { ContinuousList } from "../../../shared/ui/ContinuousList";
import { AssistantTaskBadge } from "./AssistantTaskBadge";

export function TaskList({
  tasks,
  selection,
  selected,
  activeKey,
  onToggle,
  onOpen,
  disabled,
  planningLabel,
  stateKey = "task-list",
}: {
  stateKey?: string;
  tasks: readonly BoardTask[];
  selection: boolean;
  selected: ReadonlySet<string>;
  /** The task whose detail panel is open. */
  activeKey?: string | null;
  onToggle: (task: BoardTask, checked: boolean) => void;
  onOpen: (task: BoardTask) => void;
  disabled?: boolean;
  planningLabel?: (task: BoardTask) => string;
}) {
  const t = useT();
  const activeTask = tasks.find((task) => `${task.machineId}:${task.id}` === activeKey);
  return (
    <div className="task-management-list">
      <ContinuousList
        items={tasks}
        itemKey={bulkTaskKey}
        stateKey={stateKey}
        requiredKey={activeTask ? bulkTaskKey(activeTask) : null}
        label={t("Tasks")}
        estimateSize={80}
        renderItem={(task) => {
          const status = taskStatusLine(task);
          return (
            <div
              key={bulkTaskKey(task)}
              className="task-management-row"
              data-selected={selected.has(bulkTaskKey(task)) || undefined}
              data-active={activeKey === `${task.machineId}:${task.id}` || undefined}
            >
              {selection ? (
                <label className="task-row-select">
                  <Checkbox
                    aria-label={t("Select task: {p0}", { p0: task.title })}
                    disabled={disabled}
                    checked={selected.has(bulkTaskKey(task))}
                    onChange={(event) => onToggle(task, event.currentTarget.checked)}
                  />
                </label>
              ) : null}
              <div className="task-management-identity">
                <Button
                  variant="link"
                  layout="text"
                  align="start"
                  className="task-list-open"
                  onClick={() => onOpen(task)}
                >
                  {task.title}
                </Button>
                <span>
                  {task.machineName} · {task.cwd}
                  {task.stale ? ` · ${t("Offline")}` : ""}
                </span>
                {planningLabel?.(task) ? (
                  <span className="task-planning-caption">{planningLabel(task)}</span>
                ) : null}
                <AssistantTaskBadge task={task} />
                {status.detail ? (
                  <p
                    data-task-status-detail
                    title={task.error ?? task.mergeError ?? status.detail}
                    className="task-list-error line-clamp-1"
                    data-tone={status.tone}
                  >
                    {status.detail}
                  </p>
                ) : null}
              </div>
              <Badge
                tone={status.tone}
                icon={
                  status.tone === "accent" ? (
                    <StatusDot tone="accent" label={status.label} />
                  ) : undefined
                }
                data-task-status={status.kind}
                className="task-list-status"
              >
                {status.label}
              </Badge>
            </div>
          );
        }}
      />
    </div>
  );
}
