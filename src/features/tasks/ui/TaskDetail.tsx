import { TaskModelChoiceLabel } from "./TaskModelChoiceLabel";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Code } from "../../../shared/ui/Code";
import { Heading } from "../../../shared/ui/Heading";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { Badge } from "../../../shared/ui/Badge";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { OverlayParent, useOverlay } from "../../../shared/ui/overlay";
import { Button } from "../../../shared/ui/Button";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { taskWorkspaceState } from "../../workspaces/public/taskWorkspaceState";
import { TextField } from "../../../shared/ui/TextField";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { type BoardTask, taskTimeLabel } from "../model/taskClient";
import { canEditTask, type TaskStatus } from "../model/hostTasks";
import {
  MetaLine,
  TaskOutcomeSummary,
  TaskOwnerNotices,
  taskDisplayStatus,
} from "./TaskStatusLine";
import { TaskStatusReason } from "./TaskStatusReason";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { taskStateText } from "../model/taskTextLabels";
import { runtimeModeLabel } from "../model/runtimeModeLabel";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { Fragment, type FormEvent, type ReactNode, useRef, useState } from "react";
import { HarnessIcon } from "../../sessions/public/HarnessIcon";
import { Pencil, Sparkles, X } from "../../../shared/ui/icons";
import { Spinner } from "../../../shared/ui/Spinner";
import { TaskReviewNotes } from "./TaskReviewNotes";
import { TaskAcceptanceEvidence } from "./TaskAcceptanceEvidence";
import { TaskBudgetUsage } from "./TaskBudgetControls";
import { TaskRunInsights } from "./TaskRunInsights";
import { TaskAttemptHistory } from "./TaskAttemptHistory";
import { resolveModel } from "../../sessions/public/models";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { TaskDetailInstructions } from "./TaskDetailInstructions";
import "./task-detail.css";
import { TaskActions, type TaskActionHandlers } from "./TaskCardActions";
import { VerificationSummary } from "./TaskCardVerification";
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
  return <DescriptionItem term={label}>{children}</DescriptionItem>;
}

/** A task in full, beside the board: its state and next action, the instructions, what came out
 * of the runs, the attempts, and the technical facts behind one "Details" disclosure. The title
 * and description can be edited in place while the task may be edited at all. */
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
  const status = taskDisplayStatus(task);
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
  const workspace = taskWorkspaceState(task);
  const elapsed = taskTimeLabel(task, now);
  // Who runs it and where, on one line; the dated and technical facts are under Details.
  const meta = [
    project,
    task.machineName,
    task.modelChoice && task.modelChoice.kind !== "fixed" ? (
      <Fragment key="model">
        <TaskModelChoiceLabel choice={task.modelChoice} machineId={task.machineId} /> · {model.name}
      </Fragment>
    ) : (
      model.name
    ),
    elapsed,
  ].filter(Boolean);

  return (
    <OverlayParent.Provider value={overlayId}>
      <aside
        ref={detailRoot}
        aria-label={t("Task details")}
        aria-busy={actions.pending || undefined}
        {...surfaceAttributes(
          { frame: "pane", edge: "responsive-start" },
          "flex min-h-0 w-95 max-w-[45%] shrink-0 flex-col @max-[640px]/task-area:w-full @max-[640px]/task-area:max-w-none @max-[640px]/task-area:[--surface-frame-visible:0]",
        )}
      >
        <div
          {...surfaceAttributes(
            { frame: "pane", edge: "bottom" },
            "flex min-h-9 shrink-0 items-center gap-2 px-3 py-1",
          )}
        >
          {actions.pending ? <Spinner size="xs" delay label={t("Loading…")} /> : null}
          <Badge
            data-task-status={status.kind}
            tone={status.tone}
            icon={
              status.tone === "accent" ? (
                <StatusDot tone="accent" label={status.label} />
              ) : undefined
            }
          >
            {status.label}
          </Badge>
          {task.source === "steward" ? (
            <Badge data-task-suggested tone="info">
              {t("Suggested")}
            </Badge>
          ) : null}
          <TaskActions
            task={task}
            standalone
            className="task-detail-actions ms-auto justify-end"
            {...actions}
          />
          <Button
            iconOnly
            label={t("Close details")}
            disabled={saving}
            variant="ghost"
            type="button"
            onClick={onClose}
          >
            <X className="icon-sm" />
          </Button>
        </div>
        <div className="task-detail-body">
          {isEditing ? (
            <form aria-label={t("Edit details")} onSubmit={save} className="space-y-2">
              <TextField
                label={t("Title")}
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
                label={t("Description")}
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
                <Button
                  variant="primary"
                  type="submit"
                  loading={saving}
                  disabled={!canSave}
                  disabledReason={
                    saving || canSave
                      ? undefined
                      : title.trim()
                        ? t("Add a description first.")
                        : t("Enter a title first.")
                  }
                >
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
            <div className="task-detail-head">
              <div className="flex items-start gap-2">
                <Heading size="section" className="min-w-0 flex-1 break-words">
                  {task.title}
                </Heading>
                {editable ? (
                  <Button
                    iconOnly
                    variant="ghost"
                    type="button"
                    onClick={beginEdit}
                    label={t("Edit title and description")}
                  >
                    <Pencil className="icon-xs" />
                  </Button>
                ) : null}
              </div>
              <Text
                as="p"
                size="caption"
                tone="muted"
                className="flex min-w-0 flex-wrap items-center gap-x-1"
              >
                <HarnessIcon harness={task.harness} className="icon-sm shrink-0" />
                <MetaLine parts={meta} />
              </Text>
              {goal ? (
                <Text
                  as="p"
                  size="caption"
                  tone="secondary"
                  className="flex min-w-0 items-center gap-1"
                >
                  <Sparkles className="icon-xs shrink-0" />
                  <Text truncate size="inherit" tone="inherit" className="min-w-0">
                    {t("Part of the epic “")}
                    {goal}”
                  </Text>
                </Text>
              ) : null}
            </div>
          )}
          <TaskStatusReason task={task} status={status} />
          <TaskOwnerNotices task={task} />
          {task.deliveryNote ? (
            <InlineMessage tone="warning">{task.deliveryNote}</InlineMessage>
          ) : null}
          {isEditing ? null : <TaskDetailInstructions prompt={task.prompt} />}
          {planning ? (
            <section className="task-detail-section">
              <SectionLabel as="h3">{t("Planning")}</SectionLabel>
              {planning}
            </section>
          ) : null}
          {/* Results: what the runs produced and how it was checked. */}
          <TaskOutcomeSummary task={task} />
          {task.verification ? <VerificationSummary verification={task.verification} /> : null}
          <TaskAcceptanceEvidence
            task={task}
            onOpenReview={actions.onOpenReview}
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
          <TaskBudgetUsage usage={task.budgetUsage} stop={task.budgetStop} budget={task.budget} />
          {actions.onSaveEvaluation ? (
            <TaskRunInsights task={task} onSaveEvaluation={actions.onSaveEvaluation} />
          ) : null}
          {/* History: every attempt and its review. */}
          <TaskAttemptHistory
            task={task}
            onOpenSession={actions.onOpenReview}
            isOpeningSession={actions.isOpeningSession}
          />
          <Disclosure summary={t("Details")}>
            <DescriptionList size="sm">
              <DetailRow label={t("Created")}>{formatTime(task.createdAt)}</DetailRow>
              {task.startedAt ? (
                <DetailRow label={t("Started")}>{formatTime(task.startedAt)}</DetailRow>
              ) : null}
              {task.completedAt ? (
                <DetailRow label={t("Completed")}>{formatTime(task.completedAt)}</DetailRow>
              ) : null}
              <DetailRow label={t("Completion")}>{taskStateText(workspace.completion)}</DetailRow>
              <DetailRow label={t("Delivery")}>{taskStateText(workspace.delivery)}</DetailRow>
              {task.continueUntilDone ? (
                <DetailRow label={t("Execution")}>{t("Keep fixing until done")}</DetailRow>
              ) : null}
              <DetailRow label={t("Access")}>{runtimeModeLabel(task.runtimeMode)}</DetailRow>
              <DetailRow label={t("Time limit")}>
                {task.inheritMaxRunMinutes && task.runtimeLimitResolvedAt === undefined
                  ? t("Default")
                  : (RUN_TIME_LIMIT_OPTIONS.find(
                      (option) => option.value === String(task.maxRunMinutes),
                    )?.label ?? t("{p0} minutes", { p0: task.maxRunMinutes }))}
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
                <DetailRow label={t("Waiting for")}>
                  <BadgeList
                    label={t("Waiting for")}
                    max={5}
                    items={waitingFor.map((title, index) => ({
                      id: `${index}:${title}`,
                      label: title,
                    }))}
                  />
                </DetailRow>
              ) : null}
              {task.verifyCommand ? (
                <DetailRow label={t("Check command")}>
                  <Code size="micro">{task.verifyCommand}</Code>
                </DetailRow>
              ) : null}
            </DescriptionList>
            {task.diffStat ? (
              <OutputBlock
                aria-label={t("Diff stat")}
                size="micro"
                tone="secondary"
                frame="none"
                scroll
                wrap={false}
                {...surfaceAttributes({ radius: "sm", variant: "card" }, "max-h-48 px-2 py-1.5")}
              >
                {task.diffStat}
              </OutputBlock>
            ) : null}
          </Disclosure>
        </div>
      </aside>
    </OverlayParent.Provider>
  );
}
