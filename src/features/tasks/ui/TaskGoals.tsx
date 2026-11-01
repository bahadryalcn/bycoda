import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { PromptField } from "../../../shared/ui/PromptField";
import { NumberField } from "../../../shared/ui/NumberField";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { Spinner } from "../../../shared/ui/Spinner";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { Progress } from "../../../shared/ui/Progress";
import { Alert } from "../../../shared/ui/Alert";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { projectDisplayName } from "../../projects/model/projectNames";
import { Modal } from "../../../shared/ui/Modal";
import { InlineAction } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import {
  INITIAL_WORKSPACE_CHECKS,
  isWorkspaceValid,
  TaskWorkspacePicker,
  type WorkspaceChecks,
} from "./TaskWorkspacePicker";
import { resolveTaskMachineId, useTaskTargetMachine } from "./useTaskTargetMachine";
import { useSprintBoard } from "../model/sprintClient";
import { taskMatchesProject, type TaskProjectScope } from "../model/taskBoardScope";
import { TaskAccountPicker } from "./TaskAccountPicker";
import { HostModelSource } from "../../connections/ui/HostModelSource";
import { type BoardTask, TASK_MACHINE_ERROR } from "../model/taskClient";
import { t, useLocale } from "../../../shared/i18n";
import { type FormEvent, useMemo, useRef, useState } from "react";
import { AccessPicker } from "../../sessions/ui/AccessPicker";
import {
  Check,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  X,
} from "../../../shared/ui/icons";
import { ModelPicker } from "../../sessions/ui/ModelPicker";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { TaskAcceptanceEvidence } from "./TaskAcceptanceEvidence";
import { TaskBudgetControls, TaskBudgetUsage } from "./TaskBudgetControls";
import { backgroundMachineFor } from "../../automations/model/hostAutomationClient";
import { isLocalSyncMachine } from "../../connections/model/localSync";
import type { RemoteMachine } from "../../connections/model/protocol";
import { parseRemotePath } from "../../connections/model/remoteProjects";
import { isProjectLockedIn, type LockSnapshot } from "../../group-lock/model/lockState";
import { looksLikeProject, type RecentProject } from "../../projects/model/recents";
import {
  defaultSessionChoice,
  firstEnabledHarness,
  modelsFor,
  preferredModelId,
} from "../../sessions/model/models";
import {
  GOAL_FINAL_ACCEPTANCE_CRITERIA,
  goalProgress,
  type GoalSettings,
  type GoalStatus,
  MAX_GOAL_PROJECTS,
} from "../model/hostGoals";
import {
  approveGoal,
  type BoardGoal,
  cancelGoal,
  createGoal,
  deleteGoal,
  type GoalDraft,
  goalKey,
  newGoalDraft,
  recheckGoalFinalReview,
  replanGoal,
  toggleGoalProject,
  updateGoal,
} from "../model/goalClient";
import { type HostSettings, MAX_RUNNING_TASKS_LIMIT } from "../model/hostSettings";
import type { MachineLimits } from "../model/settingsClient";
import { type BackgroundSessionTarget, taskSessionIds } from "../model/backgroundSession";
import type { PlanningRecovery, TaskBoardOperations } from "./useTaskBoardOperations";
import { STATUS_LABELS } from "./TaskDetail";
import {
  AutoMergeField,
  ContinueUntilDoneField,
  machineName,
  ProjectDiscoveryStatus,
  RUN_TIME_LIMIT_OPTIONS,
  TaskExecutionMode,
} from "./TaskFormFields";
import { MachineConcurrency } from "./TaskLimits";

const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  planning: "Planning",
  "awaiting-approval": "Plan ready",
  running: "Running",
  done: "Done",
  blocked: "Blocked",
  cancelled: "Cancelled",
};

const GOAL_STATUS_TONES: Record<GoalStatus, BadgeTone> = {
  planning: "info",
  "awaiting-approval": "warning",
  running: "info",
  done: "success",
  blocked: "danger",
  cancelled: "neutral",
};

export const ALL_GOALS = "all";

/** One goal above the board: where it stands, how many of its tasks are done,
 * and what the owner can do about it. A plan waiting for approval is shown in
 * full; a plan that failed shows why. */
function GoalCard({
  goal,
  tasks,
  busy,
  pending,
  onApprove,
  onEdit,
  onReplan,
  onCancel,
  onDelete,
  onOpenPlanner,
  onRecheckFinal,
  onOpenFinal,
  onSessions,
}: {
  goal: BoardGoal;
  /** The tasks on the goal's machine. */
  tasks: readonly BoardTask[];
  busy: boolean;
  pending: boolean;
  onApprove: () => void;
  onEdit: () => void;
  onReplan: (feedback: string) => Promise<unknown>;
  onCancel: () => void;
  onDelete: () => void;
  onOpenPlanner?: () => void;
  onRecheckFinal?: () => void;
  onOpenFinal?: () => void;
  onSessions: () => void;
}) {
  useLocale();
  const [replanning, setReplanning] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const [feedback, setFeedback] = useState("");
  const progress = goalProgress(goal, tasks);
  const failedPlanning = goal.status === "blocked" && goal.taskIds.length === 0;
  const canReplan = goal.status === "awaiting-approval" || failedPlanning;
  const projectOf = (id: string | undefined, path: string) =>
    goal.projects.find((project) => project.id === id)?.name ?? projectDisplayName(path);
  const titleOf = (key: string) => goal.plan?.tasks.find((task) => task.key === key)?.title ?? key;
  const reason = goal.planError ?? goal.error;
  return (
    <article
      aria-label={goal.title}
      data-goal-status={goal.status}
      aria-busy={pending || undefined}
      className="task-goal-card rounded-(--ui-radius-card) border border-(--ui-tone-neutral-border) bg-(--ui-surface) px-3 py-2"
    >
      <div className="task-goal-heading flex min-w-0 flex-wrap items-center gap-2">
        <Sparkles className="icon-sm shrink-0 text-(--ui-text-secondary)" />
        <h3
          title={goal.prompt}
          className="task-goal-title min-w-0 truncate text-ui-secondary font-medium text-(--ui-tone-neutral-fg)"
        >
          {goal.title}
        </h3>
        <Badge tone={GOAL_STATUS_TONES[goal.status]} className="shrink-0">
          {goal.status === "planning" ? (
            <Spinner size="xs" className="mr-1" />
          ) : null}
          {t(GOAL_STATUS_LABELS[goal.status])}
        </Badge>
        {progress.total > 0 ? (
          <span className="flex shrink-0 items-center gap-1.5 tabular-nums text-ui-micro text-(--ui-text-secondary)">
            <span className="w-14">
              <Progress
                compact
                value={progress.done}
                max={progress.total}
                label={t("Goal progress")}
                tone={goal.status === "blocked" ? "danger" : "neutral"}
              />
            </span>
            <span>
              {progress.done}/{progress.total}
              {t(" done")}
            </span>
          </span>
        ) : null}
        <span className="task-goal-context min-w-0 truncate text-ui-micro text-(--ui-text-secondary)">
          {goal.projects.map((project) => project.name).join(", ")}
          {t(" · on")} {goal.machineName}
          {goal.stale ? t(" (offline, last known)") : ""}
        </span>
        <div className="task-goal-actions ml-auto flex flex-wrap items-center gap-0.5">
          {pending ? (
            <Spinner size="xs" className="mx-1.5 text-(--ui-text-secondary)" />
          ) : null}
          {goal.status !== "done" && goal.status !== "cancelled" ? (
            <Button
              variant="ghost"
              iconOnly
              label={t("Edit goal settings")}
              disabled={busy || Boolean(goal.stale) || !goal.settingsSupported}
              tooltip={
                goal.settingsSupported
                  ? t("Edit goal settings")
                  : t("Update the selected host to edit goal settings.")
              }
              onClick={onEdit}
            >
              <Pencil className="icon-xs" />
            </Button>
          ) : null}
          {goal.status === "awaiting-approval" ? (
            <Button variant="ghost" disabled={busy} onClick={onApprove}>
              <Check className="icon-xs" />
              {t("Approve")}
            </Button>
          ) : null}
          {canReplan ? (
            <Button
              variant="ghost"

              disabled={busy}
              onClick={() => setReplanning((open) => !open)}
            >
              <RotateCcw className="icon-xs" />
              {t("Replan")}
            </Button>
          ) : null}
          {onOpenPlanner ? (
            <Button variant="ghost" disabled={false} onClick={onOpenPlanner}>
              <MessageSquare className="icon-xs" />
              {t("Open planner")}
            </Button>
          ) : null}
          {goal.taskIds.length > 0 ? (
            <Button variant="ghost" disabled={false} onClick={onSessions}>
              <MessageSquare className="icon-xs" />
              {t("Task sessions")}
            </Button>
          ) : null}
          <Button
            ref={menuTrigger}
            variant="ghost"
            iconOnly
            label={t("More actions")}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={busy}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreHorizontal className="icon-sm" />
          </Button>
          {menuOpen ? (
            <DropdownMenu
              anchor={menuTrigger}
              label={t("More actions")}
              onClose={() => setMenuOpen(false)}
              items={[
                ...(goal.status === "done" || goal.status === "cancelled"
                  ? []
                  : [
                      {
                        kind: "item" as const,
                        id: "cancel",
                        label: t("Cancel"),
                        disabled: busy,
                        icon: <Square className="icon-xs" />,
                      },
                    ]),
                ...(goal.status === "planning" || goal.status === "running"
                  ? []
                  : [
                      {
                        kind: "item" as const,
                        id: "delete",
                        label: t("Delete"),
                        disabled: busy,
                        danger: true,
                        icon: <Trash2 className="icon-xs" />,
                      },
                    ]),
              ]}
              onPick={(id) => {
                if (busy) return;
                if (id === "cancel") onCancel();
                else if (id === "delete") onDelete();
              }}
            />
          ) : null}
        </div>
      </div>
      {goal.status === "blocked" && reason ? (
        <p className="mt-1 break-words text-ui-micro leading-snug text-(--ui-tone-danger-fg)">
          {reason}
        </p>
      ) : null}
      {goal.finalReview ? (
        <div className="mt-2 min-w-0 space-y-2 text-ui-caption">
          <p role="status">
            {t("Final goal acceptance")}:{" "}
            {t(
              goal.finalAcceptance?.status === "passed"
                ? "Verified"
                : goal.finalAcceptance?.status === "failed"
                  ? "Failed"
                  : goal.finalAcceptance?.status === "running"
                    ? "Running"
                    : "Queued",
            )}
          </p>
          {goal.finalAcceptance?.note ? (
            <p className="break-words text-(--ui-text-secondary)">{goal.finalAcceptance.note}</p>
          ) : null}
          <div className="flex flex-wrap gap-1">
            {goal.finalAcceptance?.sessionId && onOpenFinal ? (
              <Button variant="ghost" onClick={onOpenFinal}>
                {t("Open final review")}
              </Button>
            ) : null}
            {goal.finalAcceptance?.status === "failed" && onRecheckFinal ? (
              <Button
                variant="ghost"
                disabled={busy || goal.stale || !goal.finalReviewSupported}
                onClick={onRecheckFinal}
              >
                {t("Recheck final acceptance")}
              </Button>
            ) : null}
          </div>
          {goal.finalAcceptance?.acceptance ? (
            <TaskAcceptanceEvidence
              task={{
                prompt: JSON.stringify({
                  schema: "bycoda.task.v1",
                  objective: goal.prompt,
                  deliverables: [],
                  acceptance: GOAL_FINAL_ACCEPTANCE_CRITERIA,
                  constraints: [],
                  verification: [],
                }),
                verification: { acceptance: goal.finalAcceptance.acceptance },
              }}
              onOpenReview={() => onOpenFinal?.()}
            />
          ) : null}
        </div>
      ) : null}
      <TaskBudgetUsage usage={goal.budgetUsage} stop={goal.budgetStop} budget={goal.budget} />
      {goal.status === "awaiting-approval" && goal.plan ? (
        <ol aria-label={t("Plan")} className="mt-1.5 space-y-1">
          {goal.plan.tasks.map((task) => (
            <li
              key={task.key}
              title={task.prompt}
              className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-ui-caption leading-snug"
            >
              <span className="text-(--ui-text-secondary)">{task.title}</span>
              <span className="text-ui-micro text-(--ui-text-secondary)">
                {t("in ")}
                {projectOf(task.projectId, task.project)}
              </span>
              {task.dependsOn.length ? (
                <span className="text-ui-micro text-(--ui-text-secondary)">
                  {t("· after ")}
                  {task.dependsOn.map(titleOf).join(", ")}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {replanning && canReplan ? (
        <form
          aria-label={t("Replan")}
          className="mt-1.5 flex items-start gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void onReplan(feedback).then(() => {
              setReplanning(false);
              setFeedback("");
            });
          }}
        >
          <TextareaField
            hideLabel
            label=""
            autoFocus
            aria-label={t("Plan feedback")}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder={t("What should the plan do differently? (optional)")}
            rows={2}
            fieldClassName="min-w-0 flex-1"
            className="resize-y"
          />
          <Button variant="primary" type="submit" disabled={busy}>
            {t("Plan again")}
          </Button>
        </form>
      ) : null}
    </article>
  );
}

/** Operational edits retain the goal's plan and execution identity. */
function GoalSettingsForm({
  goal,
  saving,
  error,
  onCancel,
  onSave,
}: {
  goal: BoardGoal;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (settings: GoalSettings) => Promise<void>;
}) {
  useLocale();
  const [settings, setSettings] = useState<GoalSettings>(() => ({
    budget: goal.budget,
    autoMerge: Boolean(goal.autoMerge),
    continueUntilDone: Boolean(goal.continueUntilDone),
    maxRunningTasks: goal.maxRunningTasks ?? 0,
    maxRunMinutes: goal.maxRunMinutes,
  }));
  const valid =
    Number.isInteger(settings.maxRunMinutes) &&
    settings.maxRunMinutes >= 0 &&
    settings.maxRunMinutes <= 10_080;
  const update = <K extends keyof GoalSettings>(key: K, value: GoalSettings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));
  return (
    <form
      aria-label={t("Edit goal settings")}
      className="task-form text-ui-secondary"
      onSubmit={(event) => {
        event.preventDefault();
        if (!saving && valid) void onSave(settings);
      }}
    >
      <div className="task-form-body">
        <p className="break-words font-medium">{goal.title}</p>
        <p className="task-form-hint">
          {t(
            "Applies to existing unfinished tasks. Delivery requires approval of the reviewed source and target.",
          )}
        </p>
        <fieldset disabled={saving} className="task-form-fields mt-3">
          <TaskBudgetControls
            budget={settings.budget}
            onChange={(budget) => update("budget", budget ?? {})}
          />
          <AutoMergeField
            checked={settings.autoMerge}
            disabled={goal.isolate === false}
            onChange={(value) => update("autoMerge", value)}
          />
          <ContinueUntilDoneField
            checked={settings.continueUntilDone}
            onChange={(value) => update("continueUntilDone", value)}
          />
          <label className="grid min-w-0 gap-1 text-ui-caption">
            {t("Concurrent tasks in this goal")}
            <SearchableSelect
              label={t("Concurrent tasks in this goal")}
              searchable={false}
              value={String(settings.maxRunningTasks)}
              options={[
                { value: "0", label: t("Use machine limit") },
                ...Array.from({ length: MAX_RUNNING_TASKS_LIMIT }, (_, index) => ({
                  value: String(index + 1),
                  label: String(index + 1),
                })),
              ]}
              onChange={(value) => update("maxRunningTasks", Number(value))}
            />
          </label>
          <NumberField
            label={t("Run limit (minutes)")}
            disabled={goal.status === "planning"}
            min={0}
            max={10_080}
            step={1}
            value={Number.isNaN(settings.maxRunMinutes) ? "" : settings.maxRunMinutes}
            onChange={(event) =>
              update("maxRunMinutes", event.target.value === "" ? NaN : Number(event.target.value))
            }
          />
          <p className="text-ui-caption text-(--ui-text-secondary)">
            {t(
              "Zero disables the run limit. Limits apply to waiting tasks; active tasks keep their current limit. Blocked tasks still require restart.",
            )}
          </p>
          {goal.status === "planning" ? (
            <p className="text-ui-caption text-(--ui-text-secondary)">
              {t("Wait for planning to finish before changing the run limit.")}
            </p>
          ) : null}
        </fieldset>
        {error ? (
          <Alert tone="danger" role="alert" className="mt-3">
            {t(error)}
          </Alert>
        ) : null}
      </div>
      <div className="task-form-footer">
        <Button variant="ghost" disabled={saving} onClick={onCancel}>
          {t("Cancel")}
        </Button>
        <Button variant="primary" type="submit" loading={saving} disabled={!valid}>
          {t("Save")}
        </Button>
      </div>
    </form>
  );
}

/** The new goal form: the job, projects, lead project and task agent. */
function GoalForm({
  draft,
  recents,
  machines,
  machine,
  saving,
  onChange,
  onCancel,
  onSubmit,
  limits,
  onChangeLimits,
}: {
  draft: GoalDraft;
  recents: RecentProject[];
  machines: RemoteMachine[];
  /** The machine whose host would carry out this goal, when it is connected. */
  machine?: string;
  saving: boolean;
  onChange: (draft: GoalDraft) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
  limits: readonly MachineLimits[];
  onChangeLimits: (machineId: string, settings: Partial<HostSettings>) => void;
}) {
  useLocale();
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceChecks, setWorkspaceChecks] = useState<Record<string, WorkspaceChecks>>({});
  const update = <K extends keyof GoalDraft>(key: K, value: GoalDraft[K]) =>
    onChange({ ...draft, [key]: value });
  const { targetId, target, projectState, machineOptions, defaultAccountFor, projectChoices } =
    useTaskTargetMachine({ machines, machineId: draft.machineId, cwd: draft.cwds[0] ?? "" });
  const choices = projectChoices(recents, { exclude: draft.cwds });
  // Account profiles are local to this computer; other hosts keep their own account choice.
  const localAccounts = Boolean(target && isLocalSyncMachine(target));
  const lead = draft.leadCwd || draft.cwds[0] || "";
  const valid =
    !workspaceBusy &&
    draft.cwds.every((cwd) =>
      isWorkspaceValid(draft.workspaces?.[cwd], workspaceChecks[cwd] ?? INITIAL_WORKSPACE_CHECKS),
    ) &&
    draft.title.trim().length > 0 &&
    draft.prompt.trim().length > 0 &&
    draft.cwds.length > 0 &&
    draft.model.length > 0 &&
    machine != null &&
    target != null &&
    draft.cwds.every((cwd) => backgroundMachineFor(machines, cwd)?.id === targetId);
  return (
    <form
      aria-label={t("New goal")}
      aria-busy={saving}
      onSubmit={(event) => {
        if (!valid || saving) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
      className="task-form"
    >
      <div className="task-form-body">
        <fieldset disabled={saving} inert={saving} className="task-form-fields">
          <div className="flex flex-wrap items-start gap-4">
            <TextField
              hideLabel
              label=""
              autoFocus
              aria-label={t("Goal title")}
              value={draft.title}
              onChange={(event) => update("title", event.target.value)}
              placeholder={t("Name the main job")}
              fieldClassName="task-title-field"
            />
          </div>
          <div className="task-form-context">
            <SearchableSelect
              variant="pill"
              label={t("Machine")}
              placeholder={t("Choose machine")}
              value={targetId}
              options={machineOptions}
              onChange={(machineId) =>
                onChange({
                  ...draft,
                  machineId,
                  cwds: [],
                  leadCwd: "",
                  workspaces: undefined,
                  providerAccountId: defaultAccountFor(draft.harness, machineId),
                })
              }
            />
            <span aria-hidden className="h-3 w-px shrink-0 bg-(--ui-tone-neutral-border)" />
            <span className="shrink-0">{t("Projects")}</span>
            {draft.cwds.map((cwd) => (
              <span
                key={cwd}
                data-goal-project={cwd}
                className="inline-flex h-6 max-w-[220px] items-center gap-1 rounded-full border border-(--ui-tone-neutral-border) pl-2 pr-1 text-ui-caption text-(--ui-text-secondary)"
              >
                <span className="min-w-0 truncate">{projectDisplayName(cwd)}</span>
                {cwd === lead ? (
                  <span className="shrink-0 text-ui-caption text-(--ui-text-secondary)">
                    {t("lead")}
                  </span>
                ) : null}
                <InlineAction
                  reveal="always"
                  label={t("Remove {p0}", { p0: projectDisplayName(cwd) })}
                  onClick={() => onChange(toggleGoalProject(draft, cwd))}
                >
                  <X />
                </InlineAction>
              </span>
            ))}
            {draft.cwds.length < MAX_GOAL_PROJECTS ? (
              <SearchableSelect
                variant="pill"
                label={t("Project")}
                placeholder={t("Choose project")}
                value=""
                options={choices.map((entry) => ({
                  value: entry.path,
                  label: projectDisplayName(entry.path),
                  keywords: entry.path,
                }))}
                onChange={(cwd) => onChange(toggleGoalProject(draft, cwd))}
              />
            ) : null}
            <ProjectDiscoveryStatus state={projectState} />
            {draft.cwds.length > 1 ? (
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="h-3 w-px shrink-0 bg-(--ui-tone-neutral-border)" />
                {t("Lead")}
                <SearchableSelect
                  variant="pill"
                  searchable={false}
                  label={t("Lead project")}
                  value={lead}
                  options={draft.cwds.map((cwd) => ({
                    value: cwd,
                    label: projectDisplayName(cwd),
                  }))}
                  onChange={(cwd) => update("leadCwd", cwd)}
                />
              </span>
            ) : null}
            <span aria-hidden className="h-3 w-px shrink-0 bg-(--ui-tone-neutral-border)" />
            {machine ? (
              <span className="truncate">
                {t("Runs on ")}
                {machine}
              </span>
            ) : draft.cwds.length ? (
              <InlineMessage tone="warning" live="assertive">
                {TASK_MACHINE_ERROR}
              </InlineMessage>
            ) : (
              <span>{t("Choose the projects the job may touch, all on one machine.")}</span>
            )}
          </div>
          <PromptField
            label={t("Main job")}
            surface="raised"
            minRows={4}
            value={draft.prompt}
            onChange={(event) => update("prompt", event.target.value)}
            placeholder={t(
              "Describe the whole job. A planner agent reads the projects and splits it into tasks, which agents then carry out.",
            )}
            toolbarLeading={
              <>
                <ModelPicker
                  harness={draft.harness}
                  model={draft.model}
                  values={draft.modelSettings}
                  project={lead || "~"}
                  accountChoices={localAccounts}
                  accountId={draft.providerAccountId}
                  onChange={(harness, model, accountId) =>
                    onChange({
                      ...draft,
                      harness,
                      model,
                      providerAccountId: localAccounts
                        ? (accountId ?? defaultAccountFor(harness))
                        : harness === draft.harness
                          ? draft.providerAccountId
                          : defaultAccountFor(harness),
                    })
                  }
                  onSettingsChange={(modelSettings) => update("modelSettings", modelSettings)}
                />
                <TaskAccountPicker
                  harness={draft.harness}
                  accountId={draft.providerAccountId}
                  local={localAccounts}
                />
                {draft.harness !== "fx" ? (
                  <AccessPicker
                    value={draft.runtimeMode}
                    onChange={(runtimeMode) => update("runtimeMode", runtimeMode)}
                  />
                ) : null}
              </>
            }
            toolbarTrailing={
              <span className="flex items-center gap-2 text-ui-micro text-(--ui-text-secondary)">
                {t("Time limit")}
                <SearchableSelect
                  variant="pill"
                  searchable={false}
                  align="end"
                  label={t("Time limit")}
                  value={String(draft.maxRunMinutes)}
                  options={RUN_TIME_LIMIT_OPTIONS}
                  onChange={(value) => update("maxRunMinutes", Number(value))}
                />
              </span>
            }
          />
          <div className="task-form-options">
            <div className="task-form-section">
              <div className="task-form-section-body">
                <div className="task-form-checks">
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={draft.finalReview === true}
                      onChange={(event) => update("finalReview", event.target.checked)}
                    />
                    {t("Verify the integrated result before completing this goal")}
                  </label>
                  <Tooltip
                    label={t("The planned tasks are created only once you approve the plan.")}
                  >
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <Checkbox
                        checked={draft.approvePlan}
                        onChange={(event) => update("approvePlan", event.target.checked)}
                      />
                      {t("Review the plan before starting")}
                    </label>
                  </Tooltip>
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <Checkbox
                      checked={draft.review}
                      onChange={(event) => update("review", event.target.checked)}
                    />
                    {t("Review each task with a second agent")}
                  </label>
                  <TaskExecutionMode
                    isolate={draft.isolate}
                    disabled={saving}
                    onChange={(isolate) => update("isolate", isolate)}
                  />
                  <AutoMergeField
                    checked={draft.autoMerge && draft.isolate === true}
                    disabled={draft.isolate !== true}
                    onChange={(checked) => update("autoMerge", checked)}
                  />
                  <ContinueUntilDoneField
                    checked={draft.continueUntilDone}
                    onChange={(checked) => update("continueUntilDone", checked)}
                  />
                </div>
                {draft.isolate === undefined ? null : (
                  <span className="task-form-hint">
                    {draft.isolate !== true
                      ? t(
                          "Tasks work directly in the selected checkout. You review and commit the changes.",
                        )
                      : t("Each task runs on its own branch and waits for you to merge it.")}
                  </span>
                )}
                <div className="flex flex-wrap items-center gap-3 text-ui-caption">
                  <label>
                    {t("Start planned tasks")}
                    <SearchableSelect
                      label={t("Start planned tasks")}
                      searchable={false}
                      value={draft.manualStart ? "manual" : "automatic"}
                      options={[
                        { value: "automatic", label: t("Automatically when ready") },
                        { value: "manual", label: t("Manually from To do") },
                      ]}
                      onChange={(value) => update("manualStart", value === "manual")}
                    />
                  </label>
                  <label>
                    {t("Concurrent tasks in this goal")}
                    <SearchableSelect
                      label={t("Concurrent tasks in this goal")}
                      searchable={false}
                      value={String(draft.maxRunningTasks ?? 0)}
                      options={[
                        { value: "0", label: t("Use machine limit") },
                        ...Array.from({ length: MAX_RUNNING_TASKS_LIMIT }, (_, index) => ({
                          value: String(index + 1),
                          label: String(index + 1),
                        })),
                      ]}
                      onChange={(value) => update("maxRunningTasks", Number(value) || undefined)}
                    />
                  </label>
                </div>
              </div>
            </div>
            <details className="task-form-section task-advanced-options">
              <summary>{t("Working branch and worktree")}</summary>
              <div className="task-form-section-body">
                {draft.cwds.map((cwd) => (
                  <div key={cwd}>
                    <p className="font-medium text-ui-caption">{projectDisplayName(cwd)}</p>
                    <TaskWorkspacePicker
                      headingHidden
                      machine={target}
                      cwd={cwd}
                      isolate={draft.isolate}
                      value={draft.workspaces?.[cwd]}
                      disabled={saving || workspaceBusy}
                      onBusyChange={setWorkspaceBusy}
                      onChecksChange={(patch) =>
                        setWorkspaceChecks((current) => ({
                          ...current,
                          [cwd]: { ...(current[cwd] ?? INITIAL_WORKSPACE_CHECKS), ...patch },
                        }))
                      }
                      onChange={(workspace) =>
                        update("workspaces", { ...draft.workspaces, [cwd]: workspace ?? {} })
                      }
                    />
                  </div>
                ))}
              </div>
            </details>
            <TaskBudgetControls
              budget={draft.budget}
              onChange={(budget) => update("budget", budget)}
            />
          </div>
          <MachineConcurrency machineId={targetId} limits={limits} onChange={onChangeLimits} />
        </fieldset>
      </div>
      <div className="task-form-footer">
        <Button variant="ghost" type="button" disabled={saving} onClick={onCancel}>
          {t("Cancel")}
        </Button>
        <Button variant="primary" type="submit" loading={saving} disabled={!valid || saving}>
          {t("Plan it")}
        </Button>
      </div>
    </form>
  );
}

type GoalScope = {
  cwd?: string;
  recents: RecentProject[];
  projectFilter: string;
  lock: LockSnapshot;
  machines: RemoteMachine[];
  selectedProject?: TaskProjectScope;
  scopedCwd?: string;
  currentSprint?: { id: string; name: string };
  sprintBoard: Pick<ReturnType<typeof useSprintBoard>, "supported" | "setGoalContext">;
};

/** Goal drafts and actions. The goals themselves are the board query's; this
 * keeps only what the owner is editing, and puts every host-confirmed goal
 * back into that query through `putGoal` / `removeGoal`. */
export function useTaskGoals({
  ops,
  scope,
  stored,
  capable,
  putGoal,
  removeGoal,
  filter,
  setFilter,
  addRecovery,
  openSession,
}: {
  ops: TaskBoardOperations;
  scope: GoalScope;
  stored: BoardGoal[];
  capable: RemoteMachine[];
  putGoal: (saved: BoardGoal) => void;
  removeGoal: (removed: BoardGoal) => void;
  filter: string;
  setFilter: (value: string) => void;
  addRecovery: (item: PlanningRecovery) => void;
  openSession: (target: BackgroundSessionTarget) => void;
}) {
  const { saving, setSaving, setError, refresh, act, confirm } = ops;
  const { cwd, recents, projectFilter, lock, machines, selectedProject, scopedCwd } = scope;
  const { currentSprint, sprintBoard } = scope;
  const [draft, setDraft] = useState<GoalDraft | null>(null);
  const [editing, setEditing] = useState<BoardGoal | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [sessionsFor, setSessionsFor] = useState<BoardGoal | null>(null);
  const goals = useMemo(
    () =>
      stored.filter(
        (goal) =>
          !goal.projects.some((project) => isProjectLockedIn(lock, project.cwd)) &&
          goal.projects.some((project) =>
            taskMatchesProject(
              { machineId: goal.machineId, projectId: project.id, cwd: project.cwd },
              projectFilter,
              machines,
            ),
          ),
      ),
    [lock, stored, projectFilter, machines],
  );

  const begin = () => {
    if (projectFilter !== "all" && (!scopedCwd || isProjectLockedIn(lock, scopedCwd))) {
      setError(TASK_MACHINE_ERROR);
      return;
    }
    const project =
      scopedCwd ??
      (currentSprint
        ? ""
        : cwd && looksLikeProject(cwd) && !parseRemotePath(cwd) && !isProjectLockedIn(lock, cwd)
          ? cwd
          : (recents.find(
              (entry) =>
                looksLikeProject(entry.path) &&
                !parseRemotePath(entry.path) &&
                !isProjectLockedIn(lock, entry.path),
            )?.path ?? ""));
    const preferred = defaultSessionChoice(project || "~");
    const harness = firstEnabledHarness(project || "~", preferred.harness);
    const model =
      (preferred.harness === harness ? preferred.model : undefined) ??
      modelsFor(harness)[0]?.id ??
      preferredModelId(harness);
    setError(null);
    const next = newGoalDraft(project, harness, model);
    setDraft(
      looksLikeProject(project)
        ? {
            ...next,
            machineId: selectedProject?.machineId ?? backgroundMachineFor(capable, project)?.id,
          }
        : { ...next, cwds: [], leadCwd: "" },
    );
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !draft) return;
    setSaving(true);
    try {
      const saved = await createGoal(capable, draft);
      putGoal(saved);
      setDraft(null);
      if (currentSprint && sprintBoard.supported) {
        const machine = machines.find((entry) => entry.id === saved.machineId);
        try {
          if (!machine) throw new Error(TASK_MACHINE_ERROR);
          await sprintBoard.setGoalContext(machine.environmentId, saved.id, currentSprint.id);
        } catch (reason) {
          addRecovery({
            id: `goal:${saved.machineId}:${saved.id}`,
            title: saved.title,
            sprintId: currentSprint.id,
            goal: { environmentId: machine?.environmentId ?? "", goalId: saved.id },
          });
          setError(
            t("Goal created. Sprint assignment failed: {p0}", {
              p0: reason instanceof Error ? reason.message : String(reason),
            }),
          );
          void refresh();
          return;
        }
      }
      setError(null);
      void refresh();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const actOn = (goal: BoardGoal, action: () => Promise<BoardGoal>) =>
    act({ id: `goal:${goalKey(goal.machineId, goal.id)}` }, action, putGoal);

  const remove = async (goal: BoardGoal) => {
    if (
      !(await confirm({
        title: t("Delete goal"),
        message: t("Delete the goal “{p0}”? Its tasks stay on the board.", { p0: goal.title }),
        confirmLabel: t("Delete"),
      }))
    )
      return;
    if (filter === goalKey(goal.machineId, goal.id)) setFilter(ALL_GOALS);
    void act(
      { id: `goal:${goalKey(goal.machineId, goal.id)}` },
      () => deleteGoal(goal),
      () => removeGoal(goal),
    );
  };

  const cancel = (goal: BoardGoal) => {
    void confirm({
      title: t("Cancel goal"),
      message: t("Cancel the goal “{p0}”? Its running tasks are stopped; their branches stay.", {
        p0: goal.title,
      }),
      confirmLabel: t("Cancel goal"),
    }).then((ok) => {
      if (ok) void actOn(goal, () => cancelGoal(goal));
    });
  };

  const openPlanner = (goal: BoardGoal) => {
    const lead = goal.projects.find((project) => project.id === goal.leadProjectId);
    if (!goal.plannerSessionId || !lead) return;
    openSession({
      machineId: goal.machineId,
      cwd: lead.cwd,
      projectId: lead.id,
      sessionId: goal.plannerSessionId,
    });
  };

  const openFinal = (goal: BoardGoal) => {
    const lead = goal.projects.find((project) => project.id === goal.leadProjectId);
    if (lead && goal.finalAcceptance?.sessionId)
      openSession({
        machineId: goal.machineId,
        cwd: lead.cwd,
        projectId: lead.id,
        sessionId: goal.finalAcceptance.sessionId,
      });
  };

  const saveSettings = async (settings: GoalSettings) => {
    if (saving || !editing) return;
    setSaving(true);
    setSettingsError(null);
    try {
      putGoal(await updateGoal(editing, settings));
      setEditing(null);
      void refresh();
    } catch (reason) {
      setSettingsError(reason instanceof Error ? reason.message : String(reason));
      void refresh();
    } finally {
      setSaving(false);
    }
  };

  return {
    goals,
    draft,
    setDraft,
    editing,
    settingsError,
    sessionsFor,
    setSessionsFor,
    begin,
    create,
    actOn,
    remove,
    cancel,
    openPlanner,
    openFinal,
    saveSettings,
    startEditing: (goal: BoardGoal) => {
      setSettingsError(null);
      setEditing(goal);
    },
    stopEditing: () => setEditing(null),
  };
}

export type TaskGoalsController = ReturnType<typeof useTaskGoals>;

/** Goal settings, edited on the goal's own host without replanning. */
export function GoalSettingsDialog({
  goals,
  saving,
}: {
  goals: TaskGoalsController;
  saving: boolean;
}) {
  if (!goals.editing) return null;
  return (
    <Modal
      title={t("Edit goal settings")}
      scroll="none"
      onClose={() => {
        if (!saving) goals.stopEditing();
      }}
    >
      <GoalSettingsForm
        goal={goals.editing}
        saving={saving}
        error={goals.settingsError}
        onCancel={goals.stopEditing}
        onSave={goals.saveSettings}
      />
    </Modal>
  );
}

/** The new-goal dialog, with the model options of the host that would run it. */
export function NewGoalDialog({
  goals,
  saving,
  error,
  recents,
  capable,
  currentSprintName,
  limits,
  onChangeLimits,
}: {
  goals: TaskGoalsController;
  saving: boolean;
  error: string | null;
  recents: RecentProject[];
  capable: RemoteMachine[];
  currentSprintName?: string;
  limits: readonly MachineLimits[];
  onChangeLimits: (machineId: string, settings: Partial<HostSettings>) => void;
}) {
  const draft = goals.draft;
  if (!draft) return null;
  return (
    <Modal
      title={t("New goal")}
      context={currentSprintName ? `${t("Sprint")}: ${currentSprintName}` : undefined}
      size="lg"
      scroll="none"
      onClose={() => {
        if (!saving) goals.setDraft(null);
      }}
    >
      {error ? (
        <Alert tone="danger" role="alert" className="mx-4 mt-3 shrink-0">
          {error}
        </Alert>
      ) : null}
      <HostModelSource
        machine={capable.find(
          (entry) =>
            entry.id === resolveTaskMachineId(capable, draft.cwds[0] ?? "", draft.machineId),
        )}
        cwd={draft.leadCwd || draft.cwds[0] || "~"}
        model={draft.model}
        values={draft.modelSettings}
      >
        <GoalForm
          draft={draft}
          recents={recents}
          machines={capable}
          machine={draft.cwds[0] ? machineName(capable, draft.cwds[0], draft.machineId) : undefined}
          saving={saving}
          onChange={(next) => {
            if (!saving) goals.setDraft(next);
          }}
          onCancel={() => {
            if (!saving) goals.setDraft(null);
          }}
          onSubmit={goals.create}
          limits={limits}
          onChangeLimits={onChangeLimits}
        />
      </HostModelSource>
    </Modal>
  );
}

/** Goals above the board, filtered to the one the owner is looking at. */
export function GoalList({
  goals,
  filter,
  tasks,
  acting,
}: {
  goals: TaskGoalsController;
  filter: string;
  tasks: BoardTask[];
  acting: string | null;
}) {
  return (
    <details className="task-goals-disclosure">
      <summary>
        {t("Goals")} · {goals.goals.length}
      </summary>
      <ul
        aria-label={t("Goals")}
        className="flex max-h-64 shrink-0 flex-col gap-1.5 overflow-y-auto p-3"
      >
        {goals.goals
          .filter((goal) => filter === ALL_GOALS || goalKey(goal.machineId, goal.id) === filter)
          .map((goal) => {
            const key = goalKey(goal.machineId, goal.id);
            return (
              <li key={key}>
                <GoalCard
                  goal={goal}
                  tasks={tasks.filter((task) => task.machineId === goal.machineId)}
                  busy={acting != null}
                  pending={acting === `goal:${key}`}
                  onApprove={() => void goals.actOn(goal, () => approveGoal(goal))}
                  onEdit={() => goals.startEditing(goal)}
                  onReplan={(feedback) => goals.actOn(goal, () => replanGoal(goal, feedback))}
                  onCancel={() => goals.cancel(goal)}
                  onDelete={() => goals.remove(goal)}
                  onSessions={() => goals.setSessionsFor(goal)}
                  onOpenPlanner={goal.plannerSessionId ? () => goals.openPlanner(goal) : undefined}
                  onRecheckFinal={() => void goals.actOn(goal, () => recheckGoalFinalReview(goal))}
                  onOpenFinal={() => goals.openFinal(goal)}
                />
              </li>
            );
          })}
      </ul>
    </details>
  );
}

/** A goal's worker and review sessions, each opened on its own host. */
export function GoalSessionsDialog({
  goals,
  tasks,
  onOpenSession,
}: {
  goals: TaskGoalsController;
  tasks: BoardTask[];
  onOpenSession: (task: BoardTask, sessionId: string) => void;
}) {
  const goal = goals.sessionsFor;
  if (!goal) return null;
  return (
    <Modal title={t("Task sessions")} size="lg" onClose={() => goals.setSessionsFor(null)}>
      <div className="grid gap-3 p-4 text-ui-secondary">
        <p className="break-words font-medium">{goal.title}</p>
        {tasks
          .filter((task) => task.machineId === goal.machineId && task.goalId === goal.id)
          .map((task) => {
            const sessions = taskSessionIds(task);
            return (
              <div key={task.id} className="task-session-row">
                <span className="break-words font-medium">{task.title}</span>
                <span className="text-ui-caption text-(--ui-text-secondary)">
                  {t(STATUS_LABELS[task.status])}
                </span>
                <span className="break-all text-ui-micro">
                  {task.branch} {task.worktreeCwd ?? task.workspace?.checkoutCwd ?? task.cwd}
                </span>
                <div className="flex flex-wrap gap-2">
                  {sessions.worker ? (
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={() => {
                        goals.setSessionsFor(null);
                        onOpenSession(task, sessions.worker!);
                      }}
                    >
                      {t("Open worker session")}
                    </Button>
                  ) : (
                    <span className="text-ui-caption text-(--ui-text-secondary)">
                      {t("Session will appear when this task starts.")}
                    </span>
                  )}
                  {sessions.review ? (
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={() => {
                        goals.setSessionsFor(null);
                        onOpenSession(task, sessions.review!);
                      }}
                    >
                      {t("Open review session")}
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
      </div>
    </Modal>
  );
}
