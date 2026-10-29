import { Badge } from "../../../shared/ui/Badge";
import { Alert } from "../../../shared/ui/Alert";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { OverlayParent, useOverlay } from "../../../shared/ui/overlay";
import { Button } from "../../../shared/ui/Button";
import { taskWorkspaceState } from "../../workspaces/model/taskWorkspaceState";
import { TextField } from "../../../shared/ui/TextField";
import { type BoardTask, taskTimeLabel } from "../model/taskClient";
import { canEditTask, taskRequiresInstructions, type TaskStatus } from "../model/hostTasks";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { LoaderCircle, Pencil, Sparkles, X } from "../../../shared/ui/icons";
import { RUNTIME_MODE_LABEL } from "../../sessions/model/session";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { TaskReviewNotes } from "./TaskReviewNotes";
import { TaskAcceptanceEvidence } from "./TaskAcceptanceEvidence";
import { TaskBudgetUsage } from "./TaskBudgetControls";
import { TaskRunInsights } from "./TaskRunInsights";
import { TaskAttemptHistory } from "./TaskAttemptHistory";
import { resolveModel } from "../../sessions/model/models";
import { taskInstructionsMarkdown } from "../model/taskInstructions";
import { type TaskActionHandlers, TaskActions, VerificationSummary } from "./TaskBoardCard";
import { RUN_TIME_LIMIT_OPTIONS } from "./TaskFormFields";

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  queued: "Queued",
  running: "Running",
  verifying: "Verifying",
  review: "Review",
  done: "Done",
  blocked: "Blocked",
};

function formatTime(at: number | undefined): string | undefined {
  return at ? new Date(at).toLocaleString(getLocale()) : undefined;
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  useLocale();
  return (
    <div className="flex min-w-0 gap-2 text-ui-caption">
      <dt className="w-24 shrink-0 text-(--ui-text-muted)">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-(--ui-tone-neutral-fg)">{children}</dd>
    </div>
  );
}

/** A task in full, beside the board: its description, where and how it runs,
 * and everything the host recorded about it. The title and description can be
 * edited in place while the task may be edited at all. */
export function TaskDetail({
  task,
  now,
  project,
  goal,
  waitingFor,
  onClose,
  onSaveDetails,
  planning,
  ...actions
}: {
  task: BoardTask;
  now: number;
  project: string;
  goal?: string;
  waitingFor: readonly string[];
  onClose: () => void;
  /** Resolves true once the new title and description are saved. */
  onSaveDetails: (title: string, prompt: string) => Promise<boolean>;
  planning?: ReactNode;
} & TaskActionHandlers) {
  useLocale();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [prompt, setPrompt] = useState(task.prompt);
  const [saving, setSaving] = useState(false);
  const model = resolveModel(task.harness, task.model);
  const description = task.prompt.trim();
  const editable = canEditTask(task.status);
  const canSave =
    title.trim().length > 0 && (task.status === "todo" || prompt.trim().length > 0) && !saving;

  // The task may stop being editable while its panel is open. The form closes
  // at once, and the flag is cleared so it cannot reopen if the task becomes
  // editable again.
  const isEditing = editing && editable;
  if (editing && !editable) setEditing(false);

  const detailRoot = useRef<HTMLElement>(null);
  const overlayId = useOverlay(detailRoot, false, () => {
    if (saving) return;
    if (isEditing) setEditing(false);
    else onClose();
  });

  const beginEdit = () => {
    setTitle(task.title);
    setPrompt(task.prompt);
    setEditing(true);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      if (await onSaveDetails(title.trim(), prompt)) setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <OverlayParent.Provider value={overlayId}>
      <aside
        ref={detailRoot}
        aria-label={t("Task details")}
        aria-busy={actions.pending || undefined}
        className="flex min-h-0 w-[380px] max-w-[45%] shrink-0 flex-col border-l border-(--ui-tone-neutral-border) @max-[640px]/task-area:w-full @max-[640px]/task-area:max-w-none @max-[640px]/task-area:border-is-0"
      >
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-(--ui-tone-neutral-border) px-3">
          {actions.pending ? (
            <LoaderCircle aria-label={t("Loading…")} className="icon-xs animate-spin" />
          ) : null}
          <Badge tone="neutral" className="">
            {t(STATUS_LABELS[task.status])}
          </Badge>
          {task.needsInput || taskRequiresInstructions(task) ? (
            <Badge tone="warning" className="">
              {t("Needs input")}
            </Badge>
          ) : null}
          {task.source === "steward" ? (
            <Badge data-task-suggested tone="info" className="">
              {t("Suggested")}
            </Badge>
          ) : null}
          <Button
            iconOnly
            label={t("Close details")}
            disabled={saving}
            variant="ghost"
            type="button"
            aria-label={t("Close details")}
            onClick={onClose}
            className="ml-auto"
          >
            <X className="icon-sm" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {isEditing ? (
            <form aria-label={t("Edit details")} onSubmit={save} className="space-y-2">
              <TextField
                hideLabel
                label=""
                autoFocus
                aria-label={t("Title")}
                value={title}
                disabled={saving}
                onChange={(event) => {
                  if (!saving) setTitle(event.target.value);
                }}
                fieldClassName="w-full"
              />
              <TextareaField
                hideLabel
                label=""
                aria-label={t("Description")}
                value={prompt}
                disabled={saving}
                onChange={(event) => {
                  if (!saving) setPrompt(event.target.value);
                }}
                placeholder={t("Details, acceptance criteria, links…")}
                rows={8}
                fieldClassName="block w-full"
                className="resize-y"
              />
              <div className="flex items-center gap-2">
                <Button variant="primary" type="submit" loading={saving} disabled={!canSave}>
                  {t("Save")}
                </Button>
                <Button
                  variant="secondary"
                  type="button"
                  disabled={saving}
                  onClick={() => setEditing(false)}
                >
                  {t("Cancel")}
                </Button>
              </div>
            </form>
          ) : (
            <>
              <div className="flex items-start gap-2">
                <h2 className="min-w-0 flex-1 break-words text-ui-title font-medium text-(--ui-tone-neutral-fg)">
                  {task.title}
                </h2>
                {editable ? (
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={beginEdit}

                    aria-label={t("Edit title and description")}
                  >
                    <Pencil className="icon-xs" />
                    {t("Edit")}
                  </Button>
                ) : null}
              </div>
              <div
                data-task-detail-description
                className="text-ui-secondary text-(--ui-tone-neutral-fg)"
              >
                {description ? (
                  <AgentMarkdown
                    text={taskInstructionsMarkdown(task.prompt)}
                    allowRemoteMedia={false}
                  />
                ) : (
                  <p className="text-(--ui-text-secondary)">{t("No description.")}</p>
                )}
              </div>
            </>
          )}
          {task.status === "blocked" && task.error ? (
            <Alert tone="danger" role="alert" className="break-words">
              {task.error}
            </Alert>
          ) : null}
          {task.mergeError ? (
            <Alert tone="danger" role="alert" className="break-words">
              {task.mergeError}
            </Alert>
          ) : null}
          {task.deliveryNote ? (
            <p role="status" className="break-words text-ui-caption text-(--ui-tone-warning-fg)">
              {task.deliveryNote}
            </p>
          ) : null}
          {planning}
          {taskWorkspaceState(task).needsRenewedApproval ? (
            <Alert tone="warning">
              {t("Automatic merge is suspended. Review changes to renew approval.")}
            </Alert>
          ) : null}
          <TaskActions task={task} {...actions} />
          <TaskAcceptanceEvidence
            task={task}
            onOpenReview={actions.onOpenReview}
            isOpeningSession={actions.isOpeningSession}
          />
          <TaskBudgetUsage usage={task.budgetUsage} stop={task.budgetStop} budget={task.budget} />
          {actions.onSaveEvaluation ? (
            <TaskRunInsights task={task} onSaveEvaluation={actions.onSaveEvaluation} />
          ) : null}
          <TaskAttemptHistory
            task={task}
            onOpenSession={actions.onOpenReview}
            isOpeningSession={actions.isOpeningSession}
          />
          {task.reviewNotes ? (
            <TaskReviewNotes
              notes={task.reviewNotes}
              busy={actions.busy}
              stale={task.stale}
              onRead={actions.onReadNotes}
              onResolve={actions.onResolveNote}
              onOpenReview={actions.onOpenReview}
              isOpeningSession={actions.isOpeningSession}
            />
          ) : null}
          {goal ? (
            <p className="flex min-w-0 items-center gap-1 text-ui-caption text-(--ui-text-secondary)">
              <Sparkles className="icon-xs shrink-0" />
              <span className="min-w-0 truncate">
                {t("Part of the goal “")}
                {goal}”
              </span>
            </p>
          ) : null}
          <dl className="space-y-1.5">
            <DetailRow label={t("Completion")}>{t(taskWorkspaceState(task).completion)}</DetailRow>
            <DetailRow label={t("Delivery")}>{t(taskWorkspaceState(task).delivery)}</DetailRow>
            <DetailRow label={t("Project")}>{project}</DetailRow>
            <DetailRow label={t("Machine")}>{task.machineName}</DetailRow>
            <DetailRow label={t("Execution")}>
              {task.continueUntilDone ? t("Continue until complete") : t("Standard")}
            </DetailRow>
            <DetailRow label={t("Agent")}>
              <span className="inline-flex items-center gap-1">
                <HarnessIcon harness={task.harness} className="icon-sm shrink-0" />
                {model.name}
              </span>
            </DetailRow>
            <DetailRow label={t("Access")}>{t(RUNTIME_MODE_LABEL[task.runtimeMode])}</DetailRow>
            <DetailRow label={t("Time limit")}>
              {RUN_TIME_LIMIT_OPTIONS.find((option) => option.value === String(task.maxRunMinutes))
                ?.label ?? t("{p0} minutes", { p0: task.maxRunMinutes })}
            </DetailRow>
            {task.branch ? (
              <DetailRow label={t("Branch")}>
                {task.merged
                  ? t("{p0} merged into {p1}", { p0: task.branch, p1: task.baseBranch })
                  : task.branch}
              </DetailRow>
            ) : null}
            {task.worktreeCwd ? (
              <DetailRow label={t("Worktree")}>{task.worktreeCwd}</DetailRow>
            ) : null}
            {task.deliveryCwd ? (
              <DetailRow label={t("Delivery worktree")}>{task.deliveryCwd}</DetailRow>
            ) : null}
            {task.baseBranch ? (
              <DetailRow label={t("Base branch")}>{task.baseBranch}</DetailRow>
            ) : null}
            {task.autoMerged ? (
              <DetailRow label={t("Merge")}>
                {t("Merged automatically")}
                {task.mergedAt ? ` · ${formatTime(task.mergedAt)}` : ""}
              </DetailRow>
            ) : null}
            {waitingFor.length > 0 ? (
              <DetailRow label={t("Waiting for")}>{waitingFor.join(", ")}</DetailRow>
            ) : null}
            <DetailRow label={t("Created")}>{formatTime(task.createdAt)}</DetailRow>
            {task.startedAt ? (
              <DetailRow label={t("Started")}>{formatTime(task.startedAt)}</DetailRow>
            ) : null}
            {task.completedAt ? (
              <DetailRow label={t("Completed")}>{formatTime(task.completedAt)}</DetailRow>
            ) : null}
            <DetailRow label={t("Duration")}>{taskTimeLabel(task, now)}</DetailRow>
            {task.repairAttempts ? (
              <DetailRow label={t("Automatic correction")}>
                {t("Attempt ")}
                {task.repairAttempts} · {task.repairNote}
              </DetailRow>
            ) : null}
            {task.verifyCommand ? (
              <DetailRow label={t("Check command")}>
                <code className="font-mono text-ui-micro">{task.verifyCommand}</code>
              </DetailRow>
            ) : null}
          </dl>
          {task.verification ? <VerificationSummary verification={task.verification} /> : null}
          {task.diffStat ? (
            <pre
              aria-label={t("Diff stat")}
              className="max-h-48 overflow-auto rounded bg-(--ui-surface-raised) px-2 py-1.5 font-mono text-ui-micro text-(--ui-text-secondary)"
            >
              {task.diffStat}
            </pre>
          ) : null}
        </div>
      </aside>
    </OverlayParent.Provider>
  );
}

