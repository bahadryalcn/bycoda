import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { InlineError } from "../../../shared/ui/InlineError";
import { Spinner } from "../../../shared/ui/Spinner";
import { Badge } from "../../../shared/ui/Badge";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { Modal } from "../../../shared/ui/Modal";
import { ActionHost, InlineAction } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { taskWorkspaceState } from "../../workspaces/model/taskWorkspaceState";
import { type BoardTask, taskTimeLabel } from "../model/taskClient";
import {
  canEditTask,
  canMoveTask,
  canTakeOverBlockedTask,
  hasUnmergedBranch,
  taskRequiresInstructions,
  type TaskStatus,
  type TaskVerification,
} from "../model/hostTasks";
import { t, useLocale } from "../../../shared/i18n";
import { memo, type ReactNode, useMemo, useState } from "react";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  GitBranch,
  GripVertical,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  X,
} from "../../../shared/ui/icons";
import { taskStatusLine, QUIET_TASK_STATUS } from "../model/taskStatusLine";
import { AssistantTaskBadge } from "./AssistantTaskBadge";
import { TaskStatusText } from "./TaskStatusLine";
import { unreadReviewNotes } from "../model/taskReviewNotes";
import { ExpandingButtonGroup } from "../../../shared/ui/ExpandingButtonGroup";
import { resolveModel } from "../../sessions/model/models";
import { taskInstructionsSummary } from "../model/taskInstructions";
import { isStewardProposal } from "../model/stewardClient";

export const TaskCard = memo(function TaskCard({
  task,
  now,
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
  now: number;
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
      now={now}
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
  now,
  project,
  goal,
  planning,
  waitingFor,
  selected,
  onOpen,
  ...actions
}: {
  task: BoardTask;
  now: number;
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
      className="task-board-card cursor-pointer rounded-(--ui-radius-card) border border-(--ui-tone-neutral-border) bg-transparent px-2.5 py-2"
    >
      {goal ? (
        <p
          data-task-goal
          title={t("Part of the goal “{p0}”", { p0: goal })}
          className="mb-1 flex min-w-0 items-center gap-1 text-ui-micro text-(--ui-text-muted)"
        >
          <Sparkles className="icon-xs shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 truncate">{goal}</span>
        </p>
      ) : null}
      <h3
        title={description}
        className="line-clamp-2 break-words text-ui-secondary font-medium text-(--ui-tone-neutral-fg)"
      >
        {actions.pending ? (
          <Spinner size="xs" label={t("Loading…")} className="mr-1 inline-block" />
        ) : null}
        <GripVertical aria-hidden="true" className="task-drag-grip icon-xs" strokeWidth={1.75} />
        {status.tone === "accent" ? (
          <StatusDot tone="accent" label={status.label} className="me-1 inline-block" />
        ) : null}
        {task.title}
      </h3>
      {planning ? <p className="task-planning-caption">{planning}</p> : null}
      <AssistantTaskBadge task={task} />
      {statusBadges ? (
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">{statusBadges}</div>
      ) : null}
      {showStatus ? (
        <TaskStatusText
          className="mbs-1"
          status={status}
          onOpen={hasFailureDetails ? () => setFailureOpen(true) : undefined}
        />
      ) : null}
      {task.branch || taskWorkspaceState(task).workspaceId ? (
        <div className="mbs-1 flex flex-wrap gap-x-2 text-ui-micro">
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
        <p data-task-renewed-approval className="mbs-1 text-ui-micro text-(--ui-tone-warning-fg)">
          {t("Automatic merge is suspended. Review changes to renew approval.")}
        </p>
      ) : null}
      {task.status === "review" &&
      !task.mergeError &&
      !taskWorkspaceState(task).needsRenewedApproval ? (
        <p className="mbs-1 text-ui-micro text-(--ui-tone-warning-fg)">
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
          className={`text-ui-micro ${unread ? "text-(--ui-tone-warning-fg)" : "text-(--ui-text-muted)"}`}
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
          className="flex min-w-0 items-center gap-1.5 text-ui-micro text-(--ui-tone-warning-fg)"
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
        <p
          data-task-description
          className="line-clamp-2 whitespace-pre-line break-words text-ui-micro text-(--ui-text-muted)"
        >
          {description}
        </p>
      ) : null}
      <p className="truncate text-ui-micro text-(--ui-text-muted)">
        {project}
        {t(" · on ")}
        {task.machineName}
        {task.stale ? t(" (offline, last known)") : ""}
      </p>
      <p className="flex min-w-0 items-center gap-1 text-ui-micro text-(--ui-text-muted)">
        {task.crewDefinitionId && <span>{t("Crew")} · </span>}
        <HarnessIcon harness={task.harness} className="icon-sm shrink-0" />
        <OverflowTooltip label={model.name}>
          <span className="min-w-0 truncate">{model.name}</span>
        </OverflowTooltip>
        <span className="ml-auto shrink-0 tabular-nums">{taskTimeLabel(task, now)}</span>
      </p>
      {task.branch ? (
        <p className="flex min-w-0 items-center gap-1 text-ui-micro text-(--ui-text-muted)">
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
              <h3>{task.title}</h3>
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

export type TaskActionHandlers = {
  pending?: boolean;
  onSaveEvaluation?: (evaluation: {
    accepted: boolean;
    reviewMinutes: number;
    corrections: number;
  }) => Promise<void>;
  busy: boolean;
  onStart: () => void;
  onDelivery: () => void;
  onPauseMerge: () => void;
  onEarlier?: () => void;
  onLater?: () => void;
  onMove: (to: TaskStatus) => void;
  onReviewWorkspace: () => Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
  /** Deletes a steward's to-do suggestion and keeps it from coming back. */
  onDecline: () => void;
  /** Missing while no current or retained worker session is known. */
  onOpenSession?: () => void;
  openingWorkerSession: boolean;
  onOpenReviewSession?: () => void;
  openingReviewSession: boolean;
  isOpeningSession: (sessionId: string) => boolean;
  onReadNotes: (noteIds: string[]) => void;
  onResolveNote: (noteId: string, resolved: boolean) => void;
  onOpenReview: (sessionId: string) => void;
  onRecheckReview: () => void;
};

/** What the owner can do with a task, as the card and the detail panel both
 * offer it. Clicks stay on the buttons rather than opening the panel. */
export function TaskActions({
  task,
  busy,
  onStart,
  onDelivery,
  onPauseMerge,
  onEarlier,
  onLater,
  onMove,
  onReviewWorkspace,
  onEdit,
  onDelete,
  onDecline,
  onOpenSession,
  openingWorkerSession,
  onOpenReviewSession,
  openingReviewSession,
  onRecheckReview,
  compact = false,
}: { task: BoardTask; compact?: boolean } & TaskActionHandlers) {
  useLocale();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [reviewPending, setReviewPending] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const can = (to: TaskStatus) =>
    canMoveTask(task.status, to, task.crewRunId ?? task.crewDefinitionId);
  type Action = {
    id: string;
    label: string;
    icon: ReactNode;
    run: () => void;
    disabled?: boolean;
    loading?: boolean;
    danger?: boolean;
  };
  const primary: Action[] = [],
    secondary: Action[] = [];
  if (task.branch || taskWorkspaceState(task).workspaceId)
    primary.push({
      id: "review-workspace",
      label: t("Review changes"),
      icon: <GitBranch className="icon-xs" />,
      loading: reviewPending,
      disabled: busy || reviewPending,
      run: () => {
        if (reviewPending) return;
        setReviewPending(true);
        setReviewError(null);
        void onReviewWorkspace()
          .catch((cause) => setReviewError(cause instanceof Error ? cause.message : String(cause)))
          .finally(() => setReviewPending(false));
      },
    });
  if (onEarlier)
    primary.push({
      id: "earlier",
      label: t("Move earlier"),
      icon: <ChevronUp className="icon-xs" />,
      run: onEarlier,
      disabled: busy,
    });
  if (onLater)
    primary.push({
      id: "later",
      label: t("Move later"),
      icon: <ChevronDown className="icon-xs" />,
      run: onLater,
      disabled: busy,
    });
  if (task.status === "queued" && task.workspaceControlsSupported)
    primary.push({
      id: "start-now",
      label: t("Start now"),
      icon: <Play className="icon-xs" />,
      run: onStart,
      disabled: busy,
    });
  if (task.status === "review" && hasUnmergedBranch(task) && task.workspaceControlsSupported) {
    secondary.push({
      id: "delivery",
      label: t("Choose delivery target"),
      icon: <GitBranch className="icon-xs" />,
      run: onDelivery,
      disabled: busy,
    });
    if (task.autoMerge || task.deliveryRequested)
      secondary.push({
        id: "pause-merge",
        label: t("Pause automatic merge"),
        icon: <Square className="icon-xs" />,
        run: onPauseMerge,
        disabled: busy,
      });
  }
  if (can("done"))
    primary.push({
      id: "done",
      label: hasUnmergedBranch(task)
        ? t("Mark finished")
        : task.status === "todo"
          ? t("Mark done")
          : t("Approve"),
      icon: <Check className="icon-xs" />,
      run: () => onMove("done"),
      disabled: busy,
    });
  if (can("queued") && !taskRequiresInstructions(task) && !canTakeOverBlockedTask(task))
    primary.push({
      id: "queued",
      label:
        task.status === "todo"
          ? t("Start")
          : task.status === "blocked"
            ? t("Retry")
            : t("Run again"),
      icon:
        task.status === "blocked" ? (
          <RotateCcw className="icon-xs" />
        ) : (
          <Play className="icon-xs" />
        ),
      run: () => onMove("queued"),
      disabled: busy,
    });
  if (
    task.status === "blocked" &&
    !taskRequiresInstructions(task) &&
    !canTakeOverBlockedTask(task) &&
    task.reviewRecheckSupported &&
    task.verification?.review?.verdict === "fail" &&
    task.sessionId
  )
    secondary.push({
      id: "recheck",
      label: t("Recheck review"),
      icon: <RefreshCw className="icon-xs" />,
      run: onRecheckReview,
      disabled: busy,
    });
  if (can("todo"))
    secondary.push({
      id: "todo",
      label: task.status === "done" ? t("Reopen") : t("Move to To do"),
      icon: <Undo2 className="icon-xs" />,
      run: () => onMove("todo"),
      disabled: busy,
    });
  if (can("blocked"))
    primary.push({
      id: "blocked",
      label: t("Stop"),
      icon: <Square className="icon-xs" />,
      run: () => onMove("blocked"),
      disabled: busy,
    });
  if (onOpenSession)
    primary.push({
      id: "worker",
      label: t("Open worker session"),
      icon: <MessageSquare className="icon-xs" />,
      run: onOpenSession,
      disabled: openingWorkerSession,
      loading: openingWorkerSession,
    });
  if (onOpenReviewSession)
    primary.push({
      id: "review",
      label: t("Open review session"),
      icon: <MessageSquare className="icon-xs" />,
      run: onOpenReviewSession,
      disabled: openingReviewSession,
      loading: openingReviewSession,
    });
  if (canEditTask(task.status))
    (taskRequiresInstructions(task) ? primary : secondary).push({
      id: "edit",
      label: taskRequiresInstructions(task) ? t("Update instructions") : t("Edit"),
      icon: <Pencil className="icon-xs" />,
      run: onEdit,
      disabled: busy,
    });
  if (isStewardProposal(task))
    secondary.push({
      id: "decline",
      label: t("Decline"),
      icon: <X className="icon-xs" />,
      run: onDecline,
      disabled: busy,
      danger: true,
    });
  else if (task.status !== "running" && task.status !== "verifying")
    secondary.push({
      id: "delete",
      label: t("Delete"),
      icon: <Trash2 className="icon-xs" />,
      run: onDelete,
      disabled: busy,
      danger: true,
    });
  const shortLabel = (action: Action) =>
    action.id === "worker"
      ? t("Worker")
      : action.id === "review"
        ? t("Review")
        : action.id === "delivery"
          ? t("Target")
          : action.label;
  const groupItem = (action: Action) => ({
    id: action.id,
    label: shortLabel(action),
    ariaLabel: action.label,
    icon: action.loading ? <Spinner size="xs" /> : action.icon,
    disabled: action.disabled,
    tone: "neutral" as const,
    onSelect: action.run,
  });
  const all = [...primary, ...secondary];
  const destructive = all.filter((action) => action.danger);
  const regular = all.filter((action) => !action.danger);
  // The card offers one lead action; the detail panel keeps the full set.
  const leadOrder =
    task.status === "review"
      ? ["review-workspace", "done", "queued"]
      : ["queued", "start-now", "blocked", "done", "review-workspace"];
  const lead = compact
    ? ((taskRequiresInstructions(task)
        ? primary.find((action) => action.id === "edit")
        : undefined) ??
      leadOrder
        .map((id) => primary.find((action) => action.id === id))
        .find((action) => action !== undefined))
    : undefined;
  const reviewAction = primary.find((action) => action.id === "review-workspace");
  const visible = (compact ? (lead ? [lead] : []) : regular).filter(
    (action) => action !== reviewAction,
  );
  const overflow = compact
    ? all.filter((action) => action !== lead && action !== reviewAction)
    : [];
  const overflowRegular = overflow.filter((action) => !action.danger);
  const overflowDanger = overflow.filter((action) => action.danger);
  const pickOverflow = (id: string) => overflow.find((action) => action.id === id)?.run();
  return (
    <div
      className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1"
      data-no-drag=""
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {reviewAction ? (
        <Button
          variant="secondary"
          loading={reviewPending}
          disabled={busy || reviewPending}
          onClick={reviewAction.run}
        >
          {t("Review changes")}
        </Button>
      ) : null}
      {visible.length > 0 ? (
        <ExpandingButtonGroup
          label={t("Task actions")}
          size="sm"
          fit
          defaultExpanded={visible.find((action) => !["earlier", "later"].includes(action.id))?.id}
          items={visible.map(groupItem)}
        />
      ) : null}
      {reviewError ? <InlineError className="basis-full">{reviewError}</InlineError> : null}
      {compact && overflow.length > 0 ? (
        <>
          {/* A compact action inside the card: the card keeps its own hover, the action only
              adds a transparent overlay instead of an opaque square. */}
          <InlineAction
            reveal="always"
            label={t("More actions")}
            aria-haspopup="menu"
            aria-expanded={!!menuAnchor}
            className="ms-auto"
            onClick={(event) => setMenuAnchor(event.currentTarget)}
          >
            <MoreHorizontal />
          </InlineAction>
          {menuAnchor ? (
            <DropdownMenu
              anchor={menuAnchor}
              label={t("Task actions")}
              items={[
                ...overflowRegular.map((action) => ({
                  kind: "item" as const,
                  id: action.id,
                  label: action.label,
                  icon: action.icon,
                  disabled: action.disabled,
                })),
                ...(overflowDanger.length > 0 && overflowRegular.length > 0
                  ? [{ kind: "sep" as const }]
                  : []),
                ...overflowDanger.map((action) => ({
                  kind: "item" as const,
                  id: action.id,
                  label: action.label,
                  icon: action.icon,
                  disabled: action.disabled,
                  danger: true,
                })),
              ]}
              onClose={() => setMenuAnchor(null)}
              onPick={pickOverflow}
            />
          ) : null}
        </>
      ) : null}
      {!compact
        ? destructive.map((action) => (
            <Button
              key={action.id}
              variant="ghost"
              tone="danger"
              className="ms-auto"
              disabled={action.disabled}
              startIcon={action.icon}
              onClick={action.run}
            >
              {action.label}
            </Button>
          ))
        : null}
    </div>
  );
}

/** What the host checked before review: the check command's result, with its
 * output on demand, and the reviewer's verdict. */
export function VerificationSummary({ verification }: { verification: TaskVerification }) {
  useLocale();
  const { command, review } = verification;
  if (!command && !review) return null;
  const passed = command && !command.timedOut && command.exitCode === 0;
  return (
    <div className="mt-1.5 space-y-1 text-ui-micro text-(--ui-text-secondary)">
      {command ? (
        <details open={!passed || undefined}>
          <summary className="cursor-pointer select-none">
            {t("Check command")}{" "}
            <span className={passed ? "text-(--ui-tone-success-fg)" : "text-(--ui-tone-danger-fg)"}>
              {passed
                ? t("passed")
                : command.timedOut
                  ? t("timed out")
                  : command.exitCode === null
                    ? t("could not run")
                    : t("failed (exit code {p0})", { p0: command.exitCode })}
            </span>
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-(--ui-surface-raised) px-1.5 py-1 font-mono text-ui-caption text-(--ui-text-secondary)">
            {command.output.trim() || t("No output.")}
          </pre>
        </details>
      ) : null}
      {review ? (
        <p className="break-words">
          {t("Reviewer")}{" "}
          <span
            className={
              review.verdict === "pass"
                ? "text-(--ui-tone-success-fg)"
                : "text-(--ui-tone-danger-fg)"
            }
          >
            {review.verdict === "pass" ? t("passed") : t("failed")}
          </span>
          {review.note ? ` · ${review.note}` : null}
        </p>
      ) : null}
    </div>
  );
}
