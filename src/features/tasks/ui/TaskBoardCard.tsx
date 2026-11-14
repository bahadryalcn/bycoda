import { surfaceAttributes } from "../../../shared/ui/Surface";
import { ClampText } from "../../../shared/ui/ClampText";
import { Text } from "../../../shared/ui/Text";
import { motionAttributes } from "../../../shared/ui/Motion";
import { Heading } from "../../../shared/ui/Heading";
import { OverflowTooltip, Tooltip } from "../../../shared/ui/Tooltip";
import { Spinner } from "../../../shared/ui/Spinner";
import { Badge } from "../../../shared/ui/Badge";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { Modal } from "../../../shared/ui/Modal";
import { ActionHost, actionContentAttributes } from "../../../shared/ui/ActionHost";
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
  const description = taskInstructionsSummary(task.prompt, {
    crewAssignment: Boolean(task.crewRunId || task.crewDefinitionId),
  });
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
          <Tooltip label={t("Suggested by a project steward")} asChild>
            <Badge data-task-suggested tone="info">
              <Bot className="icon-xs shrink-0" strokeWidth={1.75} />
              {t("Suggested")}
            </Badge>
          </Tooltip>
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
      {...surfaceAttributes({ radius: "row" }, "task-board-card cursor-pointer")}
    >
      {goal ? (
        <Tooltip label={t("Part of the epic “{p0}”", { p0: goal })} asChild>
          <Text
            as="p"
            tone="muted"
            size="micro"
            leading="inherit"
            data-task-goal

            className="task-card-goal"
          >
            <Sparkles className="icon-xs shrink-0" strokeWidth={1.75} />
            <Text truncate size="inherit" tone="inherit" className="min-w-0">
              {goal}
            </Text>
          </Text>
        </Tooltip>
      ) : null}
      <Tooltip label={description} asChild>
        <Heading size="item" lines={2} className="task-card-title">
          {actions.pending ? (
            <Spinner size="xs" label={t("Loading…")} className="mr-1 inline-block" />
          ) : null}
          {task.title}
          <GripVertical
            aria-hidden="true"
            tone="muted"
            {...motionAttributes({ transition: "opacity" })}
            {...actionContentAttributes(
              { phase: "interaction", hide: "opacity" },
              motionAttributes({ transition: "opacity" }, "task-drag-grip icon-xs").className,
            )}
            strokeWidth={1.75}
          />
        </Heading>
      </Tooltip>
      {planning ? (
        <Text
          as="p"
          size="caption"
          tone="secondary"
          leading="inherit"
          className="task-planning-caption"
        >
          {planning}
        </Text>
      ) : null}
      <AssistantTaskBadge task={task} />
      {statusBadges ? <div className="task-card-chips">{statusBadges}</div> : null}
      {showStatus ? (
        <TaskStatusText
          status={status}
          onOpen={hasFailureDetails ? () => setFailureOpen(true) : undefined}
        />
      ) : null}
      {task.branch || taskWorkspaceState(task).workspaceId ? (
        <Text
          as="div"
          size="micro"
          tone="muted"
          leading="inherit"
          className="flex flex-wrap gap-x-2"
        >
          <span data-task-completion>{t(taskWorkspaceState(task).completion)}</span>
          {/* A blocked delivery is already named by the failure link above. */}
          {task.mergeError ? null : (
            <Text tone="secondary" size="inherit" data-task-delivery>
              {t(taskWorkspaceState(task).delivery)}
            </Text>
          )}
        </Text>
      ) : null}
      {taskWorkspaceState(task).needsRenewedApproval ? (
        <Text as="p" size="micro" tone="muted" leading="inherit" data-task-renewed-approval>
          {t("Automatic merge is suspended. Review changes to renew approval.")}
        </Text>
      ) : null}
      {task.status === "review" &&
      !task.mergeError &&
      !taskWorkspaceState(task).needsRenewedApproval ? (
        <Text as="p" size="micro" tone="muted" leading="inherit">
          {hasUnmergedBranch(task)
            ? task.mergeError
              ? t("Delivery is blocked")
              : t("Waiting for your merge approval")
            : t("Waiting for your approval")}
        </Text>
      ) : null}
      {task.reviewNotes?.length ? (
        <Text as="p" size="micro" tone="muted" leading="inherit" data-task-review-notes>
          {unread
            ? t(unread === 1 ? "{p0} new review note" : "{p0} new review notes", { p0: unread })
            : t(task.reviewNotes.length === 1 ? "{p0} review note" : "{p0} review notes", {
                p0: task.reviewNotes.length,
              })}
        </Text>
      ) : null}
      {waitingFor.length > 0 ? (
        // The list's "+N" is a button of its own, so its clicks must not open the card.
        <Text
          as="div"
          size="micro"
          tone="muted"
          leading="inherit"
          data-no-drag
          className="flex min-w-0 items-center gap-1.5"
          onClick={(event) => event.stopPropagation()}
        >
          <span className="shrink-0">{t("Waiting for: ")}</span>
          <BadgeList
            label={t("Waiting for")}
            size="xs"
            className="min-w-0 flex-1"
            items={waitingFor.map((title, index) => ({ id: `${index}:${title}`, label: title }))}
          />
        </Text>
      ) : null}
      {description ? (
        <ClampText
          as="p"
          lines={1}
          expandable={false}
          size="micro"
          tone="muted"
          leading="inherit"
          data-task-description
          className="task-card-description"
        >
          {description}
        </ClampText>
      ) : null}
      <Text as="p" truncate size="micro" tone="muted" leading="inherit">
        {project}
        {t(" · on ")}
        {task.machineName}
      </Text>
      {task.stale ? (
        <Text as="p" size="micro" tone="warning" leading="inherit" wrap="anywhere">
          {t(" (offline, last known)").trim()}
        </Text>
      ) : null}
      <Text
        as="p"
        size="micro"
        tone="muted"
        leading="inherit"
        className="task-card-footer flex min-w-0 items-center gap-1"
      >
        {task.crewDefinitionId && <span>{t("Crew")} · </span>}
        <HarnessIcon harness={task.harness} className="icon-sm shrink-0" />
        <OverflowTooltip label={model.name}>
          <Text truncate size="inherit" tone="inherit" className="min-w-0">
            {model.name}
          </Text>
        </OverflowTooltip>
        {timeLabel ? (
          <span className="ms-auto flex shrink-0 items-center gap-1 tabular-nums">
            {task.status === "running" || task.status === "verifying" ? <WorkingIndicator /> : null}
            {timeLabel}
          </span>
        ) : null}
      </Text>
      {task.branch ? (
        <Text
          as="p"
          size="micro"
          tone="muted"
          leading="inherit"
          className="flex min-w-0 items-center gap-1"
        >
          <GitBranch className="icon-xs shrink-0" strokeWidth={1.75} />
          <OverflowTooltip
            label={
              task.merged
                ? t("{p0} merged into {p1}", { p0: task.branch, p1: task.baseBranch })
                : task.branch
            }
          >
            <Text truncate size="inherit" tone="inherit" className="min-w-0">
              {task.merged
                ? t("{p0} merged into {p1}", { p0: task.branch, p1: task.baseBranch })
                : task.branch}
            </Text>
          </OverflowTooltip>
        </Text>
      ) : null}
      <TaskActions task={task} compact {...actions} />
      {failureOpen ? (
        <div onClick={(event) => event.stopPropagation()}>
          <Modal title={t("Task details")} onClose={() => setFailureOpen(false)}>
            <Text
              as="div"
              tone="secondary"
              size="secondary"
              leading="inherit"
              className="task-status-details"
            >
              <Heading size="item">{task.title}</Heading>
              <TaskStatusText status={{ ...status, detail: undefined }} />
              {task.budgetStop ? <p>{task.budgetStop}</p> : null}
              {task.repairStop?.message ? <p>{task.repairStop.message}</p> : null}
              {task.error ? <p>{task.error}</p> : null}
              {task.mergeError ? <p>{task.mergeError}</p> : null}
              {task.verification ? <VerificationSummary verification={task.verification} /> : null}
            </Text>
          </Modal>
        </div>
      ) : null}
    </ActionHost>
  );
}
