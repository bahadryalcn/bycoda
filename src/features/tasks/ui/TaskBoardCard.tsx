import { Heading } from "../../../shared/ui/Heading";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { Spinner } from "../../../shared/ui/Spinner";
import { Badge } from "../../../shared/ui/Badge";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { Modal } from "../../../shared/ui/Modal";
import { ActionHost } from "../../../shared/ui/ActionHost";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import { taskWorkspaceState } from "../../workspaces/public/taskWorkspaceState";
import type { BoardTask } from "../model/taskClient";
import { hasUnmergedBranch } from "../model/hostTasks";
import { t, useLocale } from "../../../shared/i18n";
import { memo, useMemo, useState } from "react";
import { HarnessIcon } from "../../sessions/public/HarnessIcon";
import { Bot, GitBranch, GripVertical, Sparkles } from "../../../shared/ui/icons";
import { taskStatusLine, QUIET_TASK_STATUS } from "../model/taskStatusLine";
import { AssistantTaskBadge } from "./AssistantTaskBadge";
import { TaskStatusText } from "./TaskStatusLine";
import { unreadReviewNotes } from "../model/taskReviewNotes";
import { resolveModel } from "../../sessions/public/models";
import { taskInstructionsSummary } from "../model/taskInstructions";
import { TaskActions, type TaskActionHandlers } from "./TaskCardActions";
import { VerificationSummary } from "./TaskCardVerification";
import "./task-board.css";

export { TaskActions, VerificationSummary };
export type { TaskActionHandlers };

export const TaskCard = memo(function TaskCard({
  task,
  timeLabel,
  project,
  goal,
  planning,
  waitingForText,
  selected,
  onOpen,
  actionsFor,
  busy,
  openingState,
  orderKey,
}: {
  task: BoardTask;
  /** The relative time line, resolved by the board so the card re-renders only when its text changes. */
  timeLabel: string;
  project: string;
  goal?: string;
  planning?: string;
  waitingForText: string;
  selected: boolean;
  onOpen: (key: string) => void;
  actionsFor: (task: BoardTask) => TaskActionHandlers;
  busy: boolean;
  openingState: string;
  orderKey: string;
}) {
  void busy;
  void openingState;
  void orderKey;
  const waitingFor = useMemo<readonly string[]>(() => JSON.parse(waitingForText), [waitingForText]);
  return (
    <TaskCardBody
      task={task}
      timeLabel={timeLabel}
      project={project}
      goal={goal}
      planning={planning}
      waitingFor={waitingFor}
      selected={selected}
      onOpen={() => onOpen(task.machineId + ":" + task.id)}
      {...actionsFor(task)}
    />
  );
});

function TaskCardBody({
  task,
  timeLabel,
  project,
  goal,
  planning,
  waitingFor,
  selected,
  onOpen,
  ...actions
}: {
  task: BoardTask;
  timeLabel: string;
  project: string;
  /** The title of the goal the task was planned for. */
  goal?: string;
  planning?: string;
  /** Titles of the tasks it waits for. */
  waitingFor: readonly string[];
  /** Its detail panel is open. */
  selected: boolean;
  onOpen: () => void;
} & TaskActionHandlers) {
  useLocale();
  const [failureOpen, setFailureOpen] = useState(false);
  const model = resolveModel(task.harness, task.model);
  const description = taskInstructionsSummary(task.prompt);
  const unread = unreadReviewNotes(task.reviewNotes);
  // Exceptional state leads the card; machine, model and branch are ambient.
  const status = taskStatusLine(task);
  const hasFailureDetails = Boolean(
    task.error || task.mergeError || task.budgetStop || task.repairStop || task.verification,
  );
  // The column already names plain states; the line names everything else.
  const showStatus =
    !QUIET_TASK_STATUS.has(status.kind) || (status.kind === "blocked" && hasFailureDetails);
  const statusBadges =
    task.source === "steward" || task.autoMerged ? (
      <>
        {task.autoMerged ? (
          <Badge data-task-auto-merged tone="success">
            {t("Merged automatically")}
          </Badge>
        ) : null}
        {task.source === "steward" ? (
          <Badge data-task-suggested title={t("Suggested by a project steward")} tone="info">
            <Bot className="icon-xs shrink-0" strokeWidth={1.75} />
            {t("Suggested")}
          </Badge>
        ) : null}
      </>
    ) : null;
  return (
    // A click anywhere on the card but its buttons opens the detail panel.
    <ActionHost
      as="article"
      selected={selected}
      aria-label={task.title}
      aria-busy={actions.pending || undefined}
      aria-current={selected || undefined}
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && event.key === "Enter") onOpen();
      }}
      className="task-board-card cursor-pointer"
    >
      {goal ? (
        <p
          data-task-goal
          title={t("Part of the goal “{p0}”", { p0: goal })}
          className="task-card-goal"
        >
          <Sparkles className="icon-xs shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 truncate">{goal}</span>
        </p>
      ) : null}
      <Heading size="item" title={description} className="task-card-title">
        {actions.pending ? (
          <Spinner size="xs" label={t("Loading…")} className="mr-1 inline-block" />
        ) : null}
        {task.title}
        <GripVertical aria-hidden="true" className="task-drag-grip icon-xs" strokeWidth={1.75} />
      </Heading>
      {planning ? <p className="task-planning-caption">{planning}</p> : null}
      <AssistantTaskBadge task={task} />
      {statusBadges ? <div className="task-card-chips">{statusBadges}</div> : null}
      {showStatus ? (
        <TaskStatusText
          status={status}
          onOpen={hasFailureDetails ? () => setFailureOpen(true) : undefined}
        />
      ) : null}
      {task.branch || taskWorkspaceState(task).workspaceId ? (
        <div className="task-card-note flex flex-wrap gap-x-2">
          <span data-task-completion>{t(taskWorkspaceState(task).completion)}</span>
          {/* A blocked delivery is already named by the failure link above. */}
          {task.mergeError ? null : (
            <span data-task-delivery className="text-(--ui-text-secondary)">
              {t(taskWorkspaceState(task).delivery)}
            </span>
          )}
        </div>
      ) : null}
      {taskWorkspaceState(task).needsRenewedApproval ? (
        <p data-task-renewed-approval className="task-card-note text-(--ui-tone-warning-fg)">
          {t("Automatic merge is suspended. Review changes to renew approval.")}
        </p>
      ) : null}
      {task.status === "review" &&
      !task.mergeError &&
      !taskWorkspaceState(task).needsRenewedApproval ? (
        <p className="task-card-note text-(--ui-tone-warning-fg)">
          {hasUnmergedBranch(task)
            ? task.mergeError
              ? t("Delivery is blocked")
              : t("Waiting for your merge approval")
            : t("Waiting for your approval")}
        </p>
      ) : null}
      {task.reviewNotes?.length ? (
        <p
          data-task-review-notes
          className={`task-card-note ${unread ? "text-(--ui-tone-warning-fg)" : "text-(--ui-text-muted)"}`}
        >
          {unread
            ? t(unread === 1 ? "{p0} new review note" : "{p0} new review notes", { p0: unread })
            : t(task.reviewNotes.length === 1 ? "{p0} review note" : "{p0} review notes", {
                p0: task.reviewNotes.length,
              })}
        </p>
      ) : null}
      {waitingFor.length > 0 ? (
        // The list's "+N" is a button of its own, so its clicks must not open the card.
        <div
          data-no-drag
          className="task-card-note flex min-w-0 items-center gap-1.5 text-(--ui-tone-warning-fg)"
          onClick={(event) => event.stopPropagation()}
        >
          <span className="shrink-0">{t("Waiting for: ")}</span>
          <BadgeList
            label={t("Waiting for")}
            size="xs"
            className="min-w-0 flex-1"
            items={waitingFor.map((title, index) => ({ id: `${index}:${title}`, label: title }))}
          />
        </div>
      ) : null}
      {description ? (
        <p data-task-description className="task-card-description">
          {description}
        </p>
      ) : null}
      <p className="task-card-meta truncate">
        {project}
        {t(" · on ")}
        {task.machineName}
        {task.stale ? t(" (offline, last known)") : ""}
      </p>
      <p className="task-card-meta task-card-footer flex min-w-0 items-center gap-1">
        {task.crewDefinitionId && <span>{t("Crew")} · </span>}
        <HarnessIcon harness={task.harness} className="icon-sm shrink-0" />
        <OverflowTooltip label={model.name}>
          <span className="min-w-0 truncate">{model.name}</span>
        </OverflowTooltip>
        {timeLabel ? (
          <span className="ms-auto flex shrink-0 items-center gap-1 tabular-nums">
            {task.status === "running" || task.status === "verifying" ? <WorkingIndicator /> : null}
            {timeLabel}
          </span>
        ) : null}
      </p>
      {task.branch ? (
        <p className="task-card-meta flex min-w-0 items-center gap-1">
          <GitBranch className="icon-xs shrink-0" strokeWidth={1.75} />
          <OverflowTooltip
            label={
              task.merged
                ? t("{p0} merged into {p1}", { p0: task.branch, p1: task.baseBranch })
                : task.branch
            }
          >
            <span className="min-w-0 truncate">
              {task.merged
                ? t("{p0} merged into {p1}", { p0: task.branch, p1: task.baseBranch })
                : task.branch}
            </span>
          </OverflowTooltip>
        </p>
      ) : null}
      <TaskActions task={task} compact {...actions} />
      {failureOpen ? (
        <div onClick={(event) => event.stopPropagation()}>
          <Modal title={t("Task details")} onClose={() => setFailureOpen(false)}>
            <div className="task-status-details">
              <Heading size="item">{task.title}</Heading>
              <TaskStatusText status={{ ...status, detail: undefined }} />
              {task.budgetStop ? <p>{task.budgetStop}</p> : null}
              {task.repairStop?.message ? <p>{task.repairStop.message}</p> : null}
              {task.error ? <p>{task.error}</p> : null}
              {task.mergeError ? <p>{task.mergeError}</p> : null}
              {task.verification ? <VerificationSummary verification={task.verification} /> : null}
            </div>
          </Modal>
        </div>
      ) : null}
    </ActionHost>
  );
}
