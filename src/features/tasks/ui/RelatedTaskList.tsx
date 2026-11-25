import { useFormat } from "../../../shared/i18n";
import { CollectionRow } from "../../../shared/ui/CollectionRow";
import { StatusText, type StatusTextTone } from "../../../shared/ui/StatusText";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { HarnessIcon } from "../../sessions/public/HarnessIcon";
import { resolveModel } from "../../sessions/public/models";
import type { BoardTask } from "../model/taskClient";
import { taskStatusLine, type TaskStatusLine } from "../model/taskStatusLine";

/** Maps the task status line to the five shared status roles. */
function statusTextTone(status: TaskStatusLine): StatusTextTone {
  if (status.kind === "running" || status.kind === "verifying" || status.kind === "correcting")
    return "running";
  if (status.tone === "danger") return "failed";
  if (status.tone === "warning") return "needs-you";
  if (status.tone === "success") return "done";
  return "idle";
}

/**
 * The tasks that belong to one piece of work (an epic's plan, a crew's assignments): work, model,
 * status and reported cost per row. A row opens that task's own detail; nothing here is a second
 * list of independent work.
 */
export function RelatedTaskList({
  label,
  tasks,
  onOpen,
}: {
  label: string;
  tasks: readonly BoardTask[];
  onOpen: (task: BoardTask) => void;
}) {
  const format = useFormat();
  if (tasks.length === 0) return null;
  return (
    <ul aria-label={label} className="grid min-w-0">
      {tasks.map((task) => {
        const status = taskStatusLine(task);
        const cost = task.budgetUsage?.reportedCostUsd;
        const secondary = [
          resolveModel(task.harness, task.model).name,
          cost == null || cost <= 0
            ? ""
            : format.formatNumber(cost, { style: "currency", currency: "USD" }),
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <li key={`${task.machineId}:${task.id}`}>
            <CollectionRow
              leading={<HarnessIcon harness={task.harness} className="icon-sm" />}
              title={task.title}
              secondary={secondary}
              trailing={
                <Tooltip label={status.detail ?? undefined}>
                  <StatusText tone={statusTextTone(status)} data-task-status={status.kind}>
                    {status.label}
                  </StatusText>
                </Tooltip>
              }
              primary={{ "aria-label": task.title }}
              onOpen={() => onOpen(task)}
            />
          </li>
        );
      })}
    </ul>
  );
}
