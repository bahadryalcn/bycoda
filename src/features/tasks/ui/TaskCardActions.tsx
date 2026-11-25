import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { InlineError } from "../../../shared/ui/InlineError";
import { InlineMoreAction } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { taskWorkspaceState } from "../../workspaces/public/taskWorkspaceState";
import type { BoardTask } from "../model/taskClient";
import { canFinishTaskWithFindings } from "../../../shared/model/host-contracts/task-findings";
import {
  canEditTask,
  canMoveTask,
  canTakeOverBlockedTask,
  hasUnmergedBranch,
  taskRequiresInstructions,
  type TaskStatus,
} from "../model/hostTasks";
import { t, useLocale } from "../../../shared/i18n";
import { type ReactNode, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  GitBranch,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
  Undo2,
  X,
} from "../../../shared/ui/icons";
import { isStewardProposal } from "../model/stewardClient";
import "./task-board.css";
import { presentRemoteError } from "../../connections/public/remoteFailure";

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
  onFinishWithFindings?: () => void;
};

type TaskAction = {
  id: string;
  label: string;
  icon: ReactNode;
  run: () => void;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
};

/** What a task offers the owner. The one `lead` action is the next step for the task's state;
 * everything else sits in the `overflow`, regular actions first and destructive ones last. */
type TaskActionPlan = {
  lead: TaskAction | undefined;
  overflow: readonly TaskAction[];
  reviewError: string | null;
};

/** Lead candidates per state, strongest first. A task that waits for instructions leads with
 * its edit action; a task in review leads with its review of the changes. */
function leadOrder(task: BoardTask): readonly string[] {
  if (taskRequiresInstructions(task)) return ["edit", "review-workspace"];
  if (task.status === "review") return ["review-workspace", "done", "queued"];
  return ["queued", "start-now", "blocked", "done", "review-workspace"];
}

function useTaskActionPlan(
  task: BoardTask,
  {
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
    onFinishWithFindings,
  }: TaskActionHandlers,
): TaskActionPlan {
  const [reviewPending, setReviewPending] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const can = (to: TaskStatus) =>
    canMoveTask(task.status, to, task.crewRunId ?? task.crewDefinitionId);
  const actions: TaskAction[] = [];
  if (task.branch || taskWorkspaceState(task).workspaceId)
    actions.push({
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
          .catch((cause) => setReviewError(presentRemoteError(cause, { explicit: true })))
          .finally(() => setReviewPending(false));
      },
    });
  if (task.status === "queued" && task.workspaceControlsSupported)
    actions.push({
      id: "start-now",
      label: t("Start now"),
      icon: <Play className="icon-xs" />,
      run: onStart,
      disabled: busy,
    });
  if (can("done"))
    actions.push({
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
    actions.push({
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
  if (can("blocked"))
    actions.push({
      id: "blocked",
      label: t("Stop"),
      icon: <Square className="icon-xs" />,
      run: () => onMove("blocked"),
      disabled: busy,
    });
  if (canEditTask(task.status))
    actions.push({
      id: "edit",
      label: taskRequiresInstructions(task) ? t("Update instructions") : t("Edit"),
      icon: <Pencil className="icon-xs" />,
      run: onEdit,
      disabled: busy,
    });
  if (task.status === "review" && hasUnmergedBranch(task) && task.workspaceControlsSupported) {
    actions.push({
      id: "delivery",
      label: t("Choose delivery target"),
      icon: <GitBranch className="icon-xs" />,
      run: onDelivery,
      disabled: busy,
    });
    if (task.autoMerge || task.deliveryRequested)
      actions.push({
        id: "pause-merge",
        label: t("Pause automatic merge"),
        icon: <Square className="icon-xs" />,
        run: onPauseMerge,
        disabled: busy,
      });
  }
  if (
    task.status === "blocked" &&
    !taskRequiresInstructions(task) &&
    !canTakeOverBlockedTask(task) &&
    task.reviewRecheckSupported &&
    task.verification?.review?.verdict === "fail" &&
    task.sessionId
  )
    actions.push({
      id: "recheck",
      label: t("Recheck review"),
      icon: <RefreshCw className="icon-xs" />,
      run: onRecheckReview,
      disabled: busy,
    });
  if (task.finishWithFindingsSupported && onFinishWithFindings && canFinishTaskWithFindings(task))
    actions.push({
      id: "finish-with-findings",
      label: t("Finish with findings"),
      icon: <Check className="icon-xs" />,
      run: onFinishWithFindings,
      disabled: busy,
    });
  if (onOpenSession)
    actions.push({
      id: "worker",
      label: t("Open worker session"),
      icon: <MessageSquare className="icon-xs" />,
      run: onOpenSession,
      disabled: openingWorkerSession,
      loading: openingWorkerSession,
    });
  if (onOpenReviewSession)
    actions.push({
      id: "review",
      label: t("Open review session"),
      icon: <MessageSquare className="icon-xs" />,
      run: onOpenReviewSession,
      disabled: openingReviewSession,
      loading: openingReviewSession,
    });
  if (onEarlier)
    actions.push({
      id: "earlier",
      label: t("Move earlier"),
      icon: <ChevronUp className="icon-xs" />,
      run: onEarlier,
      disabled: busy,
    });
  if (onLater)
    actions.push({
      id: "later",
      label: t("Move later"),
      icon: <ChevronDown className="icon-xs" />,
      run: onLater,
      disabled: busy,
    });
  if (can("todo"))
    actions.push({
      id: "todo",
      label: task.status === "done" ? t("Reopen") : t("Move to To do"),
      icon: <Undo2 className="icon-xs" />,
      run: () => onMove("todo"),
      disabled: busy,
    });
  if (isStewardProposal(task))
    actions.push({
      id: "decline",
      label: t("Decline"),
      icon: <X className="icon-xs" />,
      run: onDecline,
      disabled: busy,
      danger: true,
    });
  else if (task.status !== "running" && task.status !== "verifying")
    actions.push({
      id: "delete",
      label: t("Delete"),
      icon: <Trash2 className="icon-xs" />,
      run: onDelete,
      disabled: busy,
      danger: true,
    });
  const lead = leadOrder(task)
    .map((id) => actions.find((action) => action.id === id))
    .find((action) => action !== undefined);
  const rest = actions.filter((action) => action !== lead);
  return {
    lead,
    overflow: [
      ...rest.filter((action) => !action.danger),
      ...rest.filter((action) => action.danger),
    ],
    reviewError,
  };
}

/**
 * What the owner can do with a task, as a row, a card and the detail header offer it: the one
 * action that moves the task's current state forward, and everything else in an overflow menu.
 * Clicks stay on the buttons rather than opening the task.
 *
 * `standalone` marks a placement outside an `ActionHost` row (the detail header), where the
 * overflow is a plain icon button.
 */
export function TaskActions({
  task,
  standalone = false,
  className,
  ...handlers
}: { task: BoardTask; standalone?: boolean; className?: string } & TaskActionHandlers) {
  useLocale();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const { lead, overflow, reviewError } = useTaskActionPlan(task, handlers);
  const regular = overflow.filter((action) => !action.danger);
  const danger = overflow.filter((action) => action.danger);
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Isolation only: keeps action clicks and keys from opening the card; the buttons inside own interaction.
    <div
      role="group"
      aria-label={t("Task actions")}
      className={["task-actions flex min-w-0 flex-wrap items-center gap-1", className]
        .filter(Boolean)
        .join(" ")}
      data-no-drag=""
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {lead ? (
        <Button
          truncate
          variant={lead.id === "blocked" ? "ghost" : "secondary"}
          size="sm"
          startIcon={lead.icon}
          loading={lead.loading}
          disabled={lead.disabled}
          disabledReason={
            lead.disabled && !lead.loading
              ? t("Wait for the current operation to finish")
              : undefined
          }
          onClick={lead.run}
        >
          {lead.label}
        </Button>
      ) : null}
      {overflow.length > 0 ? (
        <>
          {standalone ? (
            <Button
              iconOnly
              variant="ghost"
              size="sm"
              label={t("More actions")}
              aria-haspopup="menu"
              aria-expanded={!!menuAnchor}
              onClick={(event) => setMenuAnchor(event.currentTarget)}
            >
              <MoreHorizontal className="icon-sm" />
            </Button>
          ) : (
            <InlineMoreAction
              reveal="always"
              label={t("More actions")}
              expanded={!!menuAnchor}
              onOpen={setMenuAnchor}
            />
          )}
          {menuAnchor ? (
            <DropdownMenu
              anchor={menuAnchor}
              label={t("Task actions")}
              items={[
                ...regular.map((action) => ({
                  kind: "item" as const,
                  id: action.id,
                  label: action.label,
                  icon: action.icon,
                  disabled: action.disabled,
                })),
                ...(danger.length > 0 && regular.length > 0 ? [{ kind: "sep" as const }] : []),
                ...danger.map((action) => ({
                  kind: "item" as const,
                  id: action.id,
                  label: action.label,
                  icon: action.icon,
                  disabled: action.disabled,
                  danger: true,
                })),
              ]}
              onClose={() => setMenuAnchor(null)}
              onPick={(id) => overflow.find((action) => action.id === id)?.run()}
            />
          ) : null}
        </>
      ) : null}
      {reviewError ? <InlineError className="basis-full" details={reviewError} /> : null}
    </div>
  );
}
