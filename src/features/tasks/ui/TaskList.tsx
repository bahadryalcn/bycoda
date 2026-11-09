import { useT } from "../../../shared/i18n";
import { ActionHost } from "../../../shared/ui/ActionHost";
import { Badge } from "../../../shared/ui/Badge";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { bulkTaskKey } from "../model/taskBulkActions";
import type { BoardTask } from "../model/taskClient";
import { taskInstructionsSummary } from "../model/taskInstructions";
import { taskStatusLine } from "../model/taskStatusLine";
import { resolveModel } from "../../sessions/public/models";
import { HarnessIcon } from "../../sessions/public/HarnessIcon";
import { ContinuousList } from "../../../shared/ui/ContinuousList";
import { AssistantTaskBadge } from "./AssistantTaskBadge";
import "./task-list.css";

/** First non-empty line of the task prompt, shown as the one-line description caption. */
export function taskListDescription(prompt: string | undefined): string {
  for (const line of taskInstructionsSummary(prompt ?? "").split(/\r?\n/)) {
    const text = line.trim().replace(/^#+\s*/, "");
    if (text) return text;
  }
  return "";
}

/** A timestamp is shown only when it is a real moment; zero or invalid values show nothing. */
export function taskListUpdatedAt(task: Pick<BoardTask, "updatedAt">): number | null {
  const value = task.updatedAt;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

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
        estimateSize={72}
        renderItem={(task) => {
          const status = taskStatusLine(task);
          const description = taskListDescription(task.prompt);
          const planning = planningLabel?.(task);
          const updatedAt = taskListUpdatedAt(task);
          const model = task.harness ? resolveModel(task.harness, task.model) : null;
          return (
            <ActionHost
              key={bulkTaskKey(task)}
              className="task-management-row"
              selected={
                selected.has(bulkTaskKey(task)) || activeKey === `${task.machineId}:${task.id}`
              }
              data-selected={selected.has(bulkTaskKey(task)) || undefined}
              data-active={activeKey === `${task.machineId}:${task.id}` || undefined}
            >
              {selection ? (
                <Checkbox
                  className="task-row-select"
                  label={
                    <span className="sr-only">{t("Select task: {p0}", { p0: task.title })}</span>
                  }
                  disabled={disabled}
                  checked={selected.has(bulkTaskKey(task))}
                  onChange={(event) => onToggle(task, event.currentTarget.checked)}
                />
              ) : null}
              <StatusDot tone={status.tone} className="task-list-dot" />
              <div className="task-management-identity">
                <Button
                  variant="link"
                  layout="text"
                  align="start"
                  className="task-list-open"
                  onClick={() => onOpen(task)}
                >
                  <OverflowTooltip label={task.title}>
                    <span className="task-list-title">{task.title}</span>
                  </OverflowTooltip>
                </Button>
                {description ? (
                  <p className="task-list-caption task-list-description">{description}</p>
                ) : null}
                <p className="task-list-caption">
                  {task.machineName} · {task.cwd}
                  {task.stale ? ` · ${t("Offline")}` : ""}
                </p>
                {planning ? (
                  <p className="task-list-caption task-list-planning">{planning}</p>
                ) : null}
                <AssistantTaskBadge task={task} />
                {status.detail ? (
                  <p
                    data-task-status-detail
                    title={task.error ?? task.mergeError ?? status.detail}
                    className="task-list-error"
                    data-tone={status.tone}
                  >
                    {status.detail}
                  </p>
                ) : null}
              </div>
              {model ? (
                <span className="task-list-agent task-list-secondary">
                  <HarnessIcon harness={task.harness} className="icon-sm shrink-0" />
                  <OverflowTooltip label={model.name}>
                    <span className="task-list-agent-name">{model.name}</span>
                  </OverflowTooltip>
                </span>
              ) : null}
              <span className="task-list-updated task-list-secondary">
                {updatedAt ? <Timestamp value={updatedAt} /> : null}
              </span>
              <Badge tone={status.tone} data-task-status={status.kind} className="task-list-status">
                {status.label}
              </Badge>
            </ActionHost>
          );
        }}
      />
    </div>
  );
}
