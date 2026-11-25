import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { motionAttributes } from "../../../shared/ui/Motion";
import { Heading } from "../../../shared/ui/Heading";
import { OverflowTooltip, Tooltip } from "../../../shared/ui/Tooltip";
import { Spinner } from "../../../shared/ui/Spinner";
import { Badge } from "../../../shared/ui/Badge";
import { InlineError } from "../../../shared/ui/InlineError";
import { Modal } from "../../../shared/ui/Modal";
import { ActionHost, actionContentAttributes } from "../../../shared/ui/ActionHost";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import { taskWorkspaceState } from "../../workspaces/public/taskWorkspaceState";
import type { BoardTask } from "../model/taskClient";
import { t, useLocale } from "../../../shared/i18n";
import { memo, useState } from "react";
import { HarnessIcon } from "../../sessions/public/HarnessIcon";
import { Bot, GripVertical } from "../../../shared/ui/icons";
import { QUIET_TASK_STATUS } from "../model/taskStatusLine";
import { TaskStatusText, taskDisplayStatus } from "./TaskStatusLine";
import { unreadReviewNotes } from "../model/taskReviewNotes";
import { resolveModel } from "../../sessions/public/models";
import { TaskActions, type TaskActionHandlers } from "./TaskCardActions";
import { VerificationSummary } from "./TaskCardVerification";
import { taskCardKeyIntent } from "./taskCardKeys";
import "./task-board.css";

/** A board card: the same content as a list row (state when it adds information, project, model,
 * elapsed time, one lead action and an overflow), compact, in the column that names its state. */
export const TaskCard = memo(function TaskCard({
  task,
  timeLabel,
  project,
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
  return (
    <TaskCardBody
      task={task}
      timeLabel={timeLabel}
      project={project}
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
  selected,
  onOpen,
  ...actions
}: {
  task: BoardTask;
  timeLabel: string;
  project: string;
  /** Its detail panel is open. */
  selected: boolean;
  onOpen: () => void;
} & TaskActionHandlers) {
  useLocale();
  const [failureOpen, setFailureOpen] = useState(false);
  const model = resolveModel(task.harness, task.model);
  const unread = unreadReviewNotes(task.reviewNotes);
  // Exceptional state leads the card; execution metadata stays in the detail panel.
  const status = taskDisplayStatus(task);
  const hasFailureDetails = Boolean(
    task.error || task.mergeError || task.budgetStop || task.repairStop || task.verification,
  );
  // The column already names plain states; the line names everything else.
  const showStatus =
    !QUIET_TASK_STATUS.has(status.kind) ||
    taskWorkspaceState(task).needsRenewedApproval ||
    (status.kind === "blocked" && hasFailureDetails);
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
      variant="row"
      padding={{ inline: "md", block: "md" }}
      interactionTone="neutral"
      selected={selected}
      aria-label={task.title}
      aria-busy={actions.pending || undefined}
      aria-current={selected || undefined}
      tabIndex={0}
      aria-keyshortcuts={
        actions.onEarlier || actions.onLater ? "Alt+ArrowUp Alt+ArrowDown" : undefined
      }
      onClick={onOpen}
      onKeyDown={(event) => {
        const intent = taskCardKeyIntent({
          key: event.key,
          altKey: event.altKey,
          ownTarget: event.target === event.currentTarget,
          canMoveEarlier: Boolean(actions.onEarlier),
          canMoveLater: Boolean(actions.onLater),
          busy: actions.busy,
        });
        if (!intent) return;
        // Space and Alt+Arrow would otherwise scroll the board.
        event.preventDefault();
        if (intent === "open") onOpen();
        else if (intent === "earlier") actions.onEarlier?.();
        else actions.onLater?.();
      }}
      {...surfaceAttributes({ radius: "row" }, "task-board-card cursor-pointer")}
    >
      <Heading size="item" lines={2} className="task-card-title">
        {actions.pending ? (
          <Spinner size="xs" label={t("Loading…")} className="mr-1 inline-block" />
        ) : null}
        {task.title}
        <GripVertical
          aria-hidden="true"
          tone="muted"
          {...actionContentAttributes(
            { phase: "interaction", hide: "opacity" },
            motionAttributes({ transition: "opacity" }, "task-drag-grip icon-xs").className,
          )}
          strokeWidth={1.75}
        />
      </Heading>
      {showStatus ? (
        <TaskStatusText
          status={status}
          onOpen={hasFailureDetails ? () => setFailureOpen(true) : undefined}
        />
      ) : null}
      <Text
        as="p"
        size="micro"
        tone="muted"
        leading="inherit"
        className="task-card-footer flex min-w-0 items-center gap-1"
      >
        <Text truncate size="inherit" tone="inherit">
          {project}
        </Text>
        {statusBadges}
        {unread ? (
          <Badge
            variant="count"
            label={t(unread === 1 ? "{p0} new review note" : "{p0} new review notes", {
              p0: unread,
            })}
          >
            {unread}
          </Badge>
        ) : null}
        {task.stale && !task.pendingRefresh ? (
          <Text tone="warning" size="inherit">
            {t("Offline")}
          </Text>
        ) : null}
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
      <TaskActions task={task} className="task-card-actions" {...actions} />
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
              {task.budgetStop ? (
                <Text as="p" tone="secondary" size="secondary">
                  {task.budgetStop}
                </Text>
              ) : null}
              {task.repairStop?.message ? (
                <Text as="p" tone="secondary" size="secondary">
                  {task.repairStop.message}
                </Text>
              ) : null}
              {task.error ? <InlineError details={task.error} /> : null}
              {task.mergeError ? <InlineError details={task.mergeError} /> : null}
              {task.verification ? <VerificationSummary verification={task.verification} /> : null}
            </Text>
          </Modal>
        </div>
      ) : null}
    </ActionHost>
  );
}
