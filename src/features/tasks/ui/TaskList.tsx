import { useT } from "../../../shared/i18n";
import { ActionHost, InlineTextAction } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { ContinuousList } from "../../../shared/ui/ContinuousList";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Spinner } from "../../../shared/ui/Spinner";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { Text, type TextTone } from "../../../shared/ui/Text";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { projectDisplayName } from "../../projects/public/projectNames";
import { resolveModel } from "../../sessions/public/models";
import { taskWorkspaceState } from "../../workspaces/public/taskWorkspaceState";
import { bulkTaskKey } from "../model/taskBulkActions";
import { type BoardTask, taskTimeLabel } from "../model/taskClient";
import { TASK_GROUPS, taskGroup, taskGroupLabel } from "../model/taskGroups";
import { canTakeOverBlockedTask, taskRequiresInstructions } from "../model/taskRules";
import {
  QUIET_TASK_STATUS,
  type TaskStatusKind,
  type TaskStatusTone,
} from "../model/taskStatusLine";
import { AssistantTaskBadge } from "./AssistantTaskBadge";
import { TaskActions, type TaskActionHandlers } from "./TaskCardActions";
import { MetaLine, renewedApprovalDetail, taskDisplayStatus } from "./TaskStatusLine";
import "./task-board.css";

const RUNNING_KINDS: ReadonlySet<TaskStatusKind> = new Set(["running", "verifying", "correcting"]);

/** The ink of the state word in a row's meta line. */
const STATE_TONE: Record<TaskStatusTone, TextTone> = {
  neutral: "secondary",
  accent: "info",
  info: "info",
  success: "success",
  warning: "warning",
  danger: "danger",
};

/**
 * The task list: tasks in sections by state (needs you, blocked, running, to do, done), each with
 * a small header and a count. A row names its task, one muted meta line and its next action;
 * everything else is in the row's overflow. Rows keep their `machineId:id` key, so selection,
 * the open detail and the virtual window do not depend on the section a task sits in.
 */
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
  actionsFor,
  now,
  stateKey = "task-list",
}: {
  stateKey?: string;
  /** Re-queues a blocked task from its row when `actionsFor` is not given. */
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
  /** The action handlers of a row. Without them a row offers only Retry through `onRetry`. */
  actionsFor?: (task: BoardTask) => TaskActionHandlers;
  /** The clock for the elapsed time of a row; without it rows show no elapsed time. */
  now?: number;
}) {
  const t = useT();
  // The machine name only tells rows apart when the list spans several machines.
  const showMachine = new Set(tasks.map((task) => task.machineId)).size > 1;
  const activeTask = tasks.find((task) => `${task.machineId}:${task.id}` === activeKey);
  // Sections in display order; a task keeps its place among the tasks of its own section.
  const sections = TASK_GROUPS.map((group) => ({
    group,
    tasks: tasks.filter((task) => taskGroup(task) === group),
  })).filter((section) => section.tasks.length > 0);
  const ordered = sections.flatMap((section) => section.tasks);
  const sectionStarts = new Map(
    sections.map((section) => [bulkTaskKey(section.tasks[0]), section] as const),
  );
  return (
    <div className="grid content-start">
      <ContinuousList
        items={ordered}
        itemKey={bulkTaskKey}
        stateKey={stateKey}
        requiredKey={activeTask ? bulkTaskKey(activeTask) : null}
        label={t("Tasks")}
        estimateSize={52}
        renderItem={(task) => {
          const key = bulkTaskKey(task);
          const section = sectionStarts.get(key);
          const status = taskDisplayStatus(task);
          const isActive = activeKey === `${task.machineId}:${task.id}`;
          const handlers = actionsFor?.(task);
          const retry =
            !handlers &&
            onRetry &&
            task.status === "blocked" &&
            !taskRequiresInstructions(task) &&
            !canTakeOverBlockedTask(task);
          // The section already names plain states; the row names the ones that add information.
          const workspace = taskWorkspaceState(task);
          const showState =
            !QUIET_TASK_STATUS.has(status.kind) ||
            task.status === "queued" ||
            task.status === "review" ||
            workspace.needsRenewedApproval;
          // A failure's or warning's reason belongs on the row, not only in the hover hint.
          const reason =
            showState &&
            (workspace.needsRenewedApproval ||
              status.tone === "danger" ||
              status.tone === "warning")
              ? (status.detail ?? "")
              : "";
          // The hover hint carries the full error only when it adds text the row does not show.
          const fullError = task.error ?? task.mergeError ?? "";
          const stateText = showState ? (
            <Text
              as="span"
              size="inherit"
              tone={STATE_TONE[status.tone]}
              data-task-status={status.kind}
            >
              {status.label}
            </Text>
          ) : null;
          // Delivery state is in the status line; keep it out of the planning part.
          const planning = (planningLabel?.(task) ?? "")
            .split(" · ")
            .filter((part) => part && part !== status.label && part !== renewedApprovalDetail())
            .join(" · ");
          const elapsed = now === undefined ? "" : taskTimeLabel(task, now);
          const parts = [
            workspace.needsRenewedApproval
              ? `${t(workspace.completion)} · ${t(workspace.delivery)}`
              : "",
            stateText && fullError && fullError !== reason ? (
              <Tooltip key="state" label={fullError}>
                {stateText}
              </Tooltip>
            ) : (
              stateText
            ),
            reason,
            projectDisplayName(task.cwd),
            showMachine ? task.machineName : "",
            task.harness ? resolveModel(task.harness, task.model).name : "",
            elapsed,
            task.stale && !task.pendingRefresh ? t("Offline") : "",
            planning,
          ].filter(Boolean);
          return (
            <>
              {section ? (
                <SectionLabel
                  as="h3"
                  className="task-list-heading"
                  count={section.tasks.length}
                  data-task-group={section.group}
                >
                  {taskGroupLabel(section.group)}
                </SectionLabel>
              ) : null}
              <ActionHost
                variant="row"
                controlMinHeight="compact"
                padding={{ inline: "md", block: "xs" }}
                selected={selected.has(key) || isActive}
                data-selected={selected.has(key) || undefined}
                data-active={isActive || undefined}
                className="task-management-row flex min-w-0 items-center gap-1"
              >
                {selection ? (
                  <Checkbox
                    className="task-row-select"
                    label={
                      <span className="sr-only">{t("Select task: {p0}", { p0: task.title })}</span>
                    }
                    disabled={disabled}
                    checked={selected.has(key)}
                    onChange={(event) => onToggle(task, event.currentTarget.checked)}
                  />
                ) : null}
                <Button
                  data-action-primary=""
                  variant="item"
                  aria-current={isActive ? "true" : undefined}
                  aria-label={task.title}
                  className="min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => onOpen(task)}
                >
                  <span aria-hidden="true" className="grid shrink-0 place-items-center">
                    {RUNNING_KINDS.has(status.kind) ? (
                      <Spinner size="xs" tone="info" />
                    ) : (
                      <StatusDot tone={status.tone} />
                    )}
                  </span>
                  <span className="task-row-text">
                    <Text as="span" size="secondary" weight="medium" truncate>
                      {task.title}
                    </Text>
                    <Text as="span" size="caption" tone="muted" truncate>
                      <MetaLine parts={parts} />
                    </Text>
                  </span>
                  <AssistantTaskBadge task={task} />
                </Button>
                {handlers ? (
                  <TaskActions task={task} className="task-row-actions" {...handlers} />
                ) : retry ? (
                  <InlineTextAction onClick={() => onRetry(task)} disabled={disabled}>
                    {t("Retry")}
                  </InlineTextAction>
                ) : null}
              </ActionHost>
            </>
          );
        }}
      />
    </div>
  );
}
