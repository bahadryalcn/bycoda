import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { InlineError } from "../../../shared/ui/InlineError";
import { Spinner } from "../../../shared/ui/Spinner";
import { InlineAction } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { taskWorkspaceState } from "../../workspaces/public/taskWorkspaceState";
import type { BoardTask } from "../model/taskClient";
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
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Isolation only: keeps action clicks and keys from opening the card; the buttons inside own interaction.
    <div
      role="group"
      aria-label={t("Task actions")}
      className={`task-card-actions mt-1.5 flex min-w-0 items-center gap-1 ${compact ? "flex-nowrap" : "flex-wrap"}`}
      data-no-drag=""
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {reviewAction ? (
        <Button
          variant="secondary"
          size="sm"
          startIcon={<GitBranch className="icon-xs" />}
          loading={reviewPending}
          disabled={busy || reviewPending}
          onClick={reviewAction.run}
        >
          {t("Review changes")}
        </Button>
      ) : null}
      {visible.map((action) => (
        <Button
          key={action.id}
          variant="secondary"
          size="sm"
          startIcon={action.loading ? <Spinner size="xs" /> : action.icon}
          disabled={action.disabled}
          onClick={action.run}
        >
          {action.label}
        </Button>
      ))}
      {reviewError ? (
        <InlineError className={compact ? "order-last w-full shrink-0" : "basis-full"}>
          {reviewError}
        </InlineError>
      ) : null}
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
