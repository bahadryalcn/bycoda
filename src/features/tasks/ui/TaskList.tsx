import { useT } from "../../../shared/i18n";
import { CollectionRow } from "../../../shared/ui/CollectionRow";
import { StatusText, type StatusTextTone } from "../../../shared/ui/StatusText";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { bulkTaskKey } from "../model/taskBulkActions";
import type { BoardTask } from "../model/taskClient";
import { taskInstructionsSummary } from "../model/taskInstructions";
import { taskStatusLine, type TaskStatusKind, type TaskStatusLine } from "../model/taskStatusLine";
import { HarnessIcon } from "../../sessions/public/HarnessIcon";
import { ContinuousList } from "../../../shared/ui/ContinuousList";
import { projectDisplayName } from "../../projects/public/projectNames";
import { AssistantTaskBadge } from "./AssistantTaskBadge";

const RUNNING_KINDS: ReadonlySet<TaskStatusKind> = new Set(["running", "verifying", "correcting"]);

/** Maps the task status line to the five shared status roles. */
function statusTextTone(status: TaskStatusLine): StatusTextTone {
  if (RUNNING_KINDS.has(status.kind)) return "running";
  if (status.tone === "danger") return "failed";
  if (status.tone === "warning") return "needs-you";
  if (status.tone === "success") return "done";
  return "idle";
}

/** First non-empty line of the task prompt, shown as the one-line description caption. */
export function taskListDescription(prompt: string | undefined, crewAssignment = false): string {
  for (const line of taskInstructionsSummary(prompt ?? "", { crewAssignment }).split(/\r?\n/)) {
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
    <div className="grid content-start">
      <ContinuousList
        items={tasks}
        itemKey={bulkTaskKey}
        stateKey={stateKey}
        requiredKey={activeTask ? bulkTaskKey(activeTask) : null}
        label={t("Tasks")}
        estimateSize={36}
        renderItem={(task) => {
          const status = taskStatusLine(task);
          const description = taskListDescription(
            task.prompt,
            Boolean(task.crewRunId || task.crewDefinitionId),
          );
          const planning = planningLabel?.(task);
          const updatedAt = taskListUpdatedAt(task);
          const key = bulkTaskKey(task);
          const isActive = activeKey === `${task.machineId}:${task.id}`;
          const secondary = [
            projectDisplayName(task.cwd),
            task.machineName,
            task.stale ? t("Offline") : "",
            planning,
            description,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <CollectionRow
              key={key}
              className="task-management-row"
              selected={selected.has(key) || isActive}
              data-selected={selected.has(key) || undefined}
              data-active={isActive || undefined}
              before={
                selection ? (
                  <Checkbox
                    className="task-row-select"
                    label={
                      <span className="sr-only">{t("Select task: {p0}", { p0: task.title })}</span>
                    }
                    disabled={disabled}
                    checked={selected.has(key)}
                    onChange={(event) => onToggle(task, event.currentTarget.checked)}
                  />
                ) : undefined
              }
              leading={
                task.harness ? (
                  <HarnessIcon harness={task.harness} className="icon-sm" />
                ) : undefined
              }
              title={task.title}
              secondary={secondary || undefined}
              trailing={
                <>
                  <AssistantTaskBadge task={task} />
                  <Tooltip label={task.error ?? task.mergeError ?? status.detail ?? status.label}>
                    <StatusText tone={statusTextTone(status)} data-task-status={status.kind}>
                      {status.label}
                    </StatusText>
                  </Tooltip>
                  {updatedAt ? <Timestamp value={updatedAt} size="micro" tone="muted" /> : null}
                </>
              }
              primary={{ "aria-current": isActive ? "true" : undefined, "aria-label": task.title }}
              onOpen={() => onOpen(task)}
            />
          );
        }}
      />
    </div>
  );
}
