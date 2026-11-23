import { useT } from "../../../shared/i18n";
import { CollectionRow } from "../../../shared/ui/CollectionRow";
import { StatusText, type StatusTextTone } from "../../../shared/ui/StatusText";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { InlineTextAction } from "../../../shared/ui/ActionHost";
import { Text } from "../../../shared/ui/Text";
import { canTakeOverBlockedTask, taskRequiresInstructions } from "../model/taskRules";
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

function sameDay(a: number, b: number): boolean {
  const first = new Date(a);
  const second = new Date(b);
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

export function TaskList({
  tasks,
  selection,
  selected,
  activeKey,
  onToggle,
  onOpen,
  onRetry,
  disabled,
  planningLabel,
  stateKey = "task-list",
}: {
  stateKey?: string;
  /** Re-queues a blocked task from its row; rows that need instructions or a takeover only open. */
  onRetry?: (task: BoardTask) => void;
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
  // The machine name only tells rows apart when the list spans several machines.
  const showMachine = new Set(tasks.map((task) => task.machineId)).size > 1;
  const activeTask = tasks.find((task) => `${task.machineId}:${task.id}` === activeKey);
  // Failures lead the list in one group so the ones that need a decision are not scattered.
  const failed = tasks.filter((task) => taskStatusLine(task).tone === "danger");
  const ordered = failed.length
    ? [...failed, ...tasks.filter((task) => !failed.includes(task))]
    : tasks;
  return (
    <div className="grid content-start">
      <ContinuousList
        items={ordered}
        itemKey={bulkTaskKey}
        stateKey={stateKey}
        requiredKey={activeTask ? bulkTaskKey(activeTask) : null}
        label={t("Tasks")}
        estimateSize={36}
        renderItem={(task, index) => {
          const status = taskStatusLine(task);
          // Only the failed group is named; everything else is simply the rest of the list.
          const groupHeading =
            failed.length > 0 && index === 0 ? t("Failed · {p0}", { p0: failed.length }) : null;
          const previousAt = index > 0 ? taskListUpdatedAt(ordered[index - 1]) : null;
          const retry =
            onRetry &&
            task.status === "blocked" &&
            !taskRequiresInstructions(task) &&
            !canTakeOverBlockedTask(task);
          const description = taskListDescription(
            task.prompt,
            Boolean(task.crewRunId || task.crewDefinitionId),
          );
          // Status already shows the delivery state; keep it out of the secondary line.
          const planning = planningLabel?.(task)
            .split(" · ")
            .filter((part) => part !== status.label)
            .join(" · ");
          const updatedAt = taskListUpdatedAt(task);
          const key = bulkTaskKey(task);
          const isActive = activeKey === `${task.machineId}:${task.id}`;
          // A failure's reason belongs on the row, not only in the hover hint.
          const failure = status.tone === "danger" ? status.detail : "";
          const detail = [
            failure,
            projectDisplayName(task.cwd),
            showMachine ? task.machineName : "",
            task.stale && !task.pendingRefresh ? t("Offline") : "",
            planning,
            description,
          ]
            .filter(Boolean)
            .join(" · ");
          // The state sits next to the title; the reason follows it on the same line.
          // The hover hint carries the full error only when it adds text the row does not show.
          const fullError = task.error ?? task.mergeError ?? "";
          const statusText = (
            <StatusText tone={statusTextTone(status)} data-task-status={status.kind}>
              {status.label}
            </StatusText>
          );
          const secondary = (
            <>
              {fullError && fullError !== failure ? (
                <Tooltip label={fullError}>{statusText}</Tooltip>
              ) : (
                statusText
              )}
              {detail ? ` · ${detail}` : ""}
            </>
          );
          return (
            <>
              {groupHeading ? (
                <Text
                  as="div"
                  size="caption"
                  tone="muted"
                  weight="medium"
                  className="px-2 pt-2 pb-1"
                  data-task-group="failed"
                >
                  {groupHeading}
                </Text>
              ) : null}
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
                        <span className="sr-only">
                          {t("Select task: {p0}", { p0: task.title })}
                        </span>
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
                secondary={secondary}
                trailing={
                  <>
                    <AssistantTaskBadge task={task} />
                    {updatedAt ? (
                      <Timestamp
                        value={updatedAt}
                        // Rows of one day share the date; only the first of a day names it.
                        format={previousAt && sameDay(previousAt, updatedAt) ? "time" : "auto"}
                        size="micro"
                        tone="muted"
                      />
                    ) : null}
                  </>
                }
                action={
                  retry ? (
                    <InlineTextAction onClick={() => onRetry(task)} disabled={disabled}>
                      {t("Retry")}
                    </InlineTextAction>
                  ) : undefined
                }
                primary={{
                  "aria-current": isActive ? "true" : undefined,
                  "aria-label": task.title,
                }}
                onOpen={() => onOpen(task)}
              />
            </>
          );
        }}
      />
    </div>
  );
}
