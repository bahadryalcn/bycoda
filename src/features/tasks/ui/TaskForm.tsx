import { TextareaField } from "../../../shared/ui/TextareaField";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { projectDisplayName } from "../../projects/model/projectNames";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { isWorkspaceValid, TaskWorkspacePicker, useWorkspaceChecks } from "./TaskWorkspacePicker";
import { useTaskTargetMachine } from "./useTaskTargetMachine";
import { TaskAccountPicker } from "./TaskAccountPicker";
import { CrewTaskPicker } from "../../crews/ui/CrewTaskPicker";
import { preflightTaskDraft, TASK_MACHINE_ERROR, type TaskDraft } from "../model/taskClient";
import { t, useLocale } from "../../../shared/i18n";
import { useState } from "react";
import { AccessPicker } from "../../sessions/ui/AccessPicker";
import { ChevronDown, ChevronRight } from "../../../shared/ui/icons";
import { ModelPicker } from "../../sessions/ui/ModelPicker";
import { resolveModel } from "../../sessions/model/models";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SkillPromptField } from "../../skills/ui/SkillPromptField";
import { TaskWorkflowControls } from "./TaskWorkflowControls";
import { TaskBudgetControls } from "./TaskBudgetControls";
import type { TaskPreflightReport } from "../model/taskPreflight";
import { backgroundMachineFor } from "../../automations/model/hostAutomationClient";
import { isLocalSyncMachine } from "../../connections/model/localSync";
import { REMOTE_PROVIDERS, type RemoteMachine } from "../../connections/model/protocol";
import { looksLikeProject, type RecentProject } from "../../projects/model/recents";
import {
  AutoMergeField,
  ContinueUntilDoneField,
  ProjectDiscoveryStatus,
  RUN_TIME_LIMIT_OPTIONS,
  TaskExecutionMode,
} from "./TaskFormFields";

export function TaskForm({
  draft,
  recents,
  machines,
  machine,
  todoUnsupported,
  saving,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: TaskDraft;
  recents: RecentProject[];
  machines: RemoteMachine[];
  /** The machine whose host would run this draft, when it is connected. */
  machine?: string;
  /** Why a to-do item cannot be added on that machine, when it cannot. */
  todoUnsupported?: string;
  saving: boolean;
  onChange: (draft: TaskDraft) => void;
  onCancel: () => void;
  /** `todo` and `queued` add a new task; `save` keeps an edited task's status. */
  onSubmit: (mode: "todo" | "queued" | "save") => void;
}) {
  useLocale();
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [submitMode, setSubmitMode] = useState<"todo" | "queued" | "save">("todo");
  const [workspaceChecks, patchWorkspaceChecks] = useWorkspaceChecks();
  const [crewValid, setCrewValid] = useState(true);
  const [preflightResult, setPreflightResult] = useState<{
    key: string;
    report: TaskPreflightReport;
  }>();
  const {
    targetId,
    target,
    projectState,
    machineOptions,
    defaultAccountFor,
    projectChoices,
    firstProjectOn,
  } = useTaskTargetMachine({
    machines,
    machineId: draft.machineId,
    cwd: draft.cwd,
    discover: !draft.id,
  });
  // Account profiles are local to this computer; other hosts keep their own account choice.
  const localAccounts = Boolean(target && isLocalSyncMachine(target));
  const workspaceValid = isWorkspaceValid(draft.workspace, workspaceChecks);
  const preflightKey = JSON.stringify([
    draft.cwd,
    targetId,
    draft.harness,
    draft.model,
    draft.workspace,
    draft.preflightRequirements,
  ]);
  // A to-do item is mostly title and description; the agent comes later.
  const [agentOpen, setAgentOpen] = useState(false);
  // Advanced starts closed; a task that already uses any of it opens it.
  const [advancedOpen, setAdvancedOpen] = useState(
    () =>
      Boolean(draft.verifyCommand?.trim()) ||
      Boolean(draft.budget) ||
      Boolean(draft.preflightRequirements?.length) ||
      Boolean(draft.workflowId),
  );
  const update = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) =>
    onChange({ ...draft, [key]: value });
  const hasDescription = draft.prompt.trim().length > 0;
  const ready =
    (!!draft.crewDefinitionId || (!workspaceBusy && workspaceValid)) &&
    (!draft.crewDefinitionId || crewValid) &&
    draft.title.trim().length > 0 &&
    looksLikeProject(draft.cwd) &&
    draft.model.length > 0 &&
    machine != null &&
    (draft.id != null || backgroundMachineFor(machines, draft.cwd)?.id === targetId);
  const canTodo = ready && !todoUnsupported;
  const canSave = ready && (draft.status === "todo" || hasDescription);
  const projectName = projectDisplayName(draft.cwd);
  // Why a footer action is unavailable, shown as its tooltip.
  const blockedReason = !draft.title.trim()
    ? t("Add a title to continue.")
    : !looksLikeProject(draft.cwd)
      ? t("Choose a project.")
      : machine == null
        ? TASK_MACHINE_ERROR
        : !draft.crewDefinitionId && (workspaceBusy || !workspaceValid)
          ? t("Check the working branch under Advanced.")
          : undefined;
  const startReason = hasDescription
    ? blockedReason
    : t("Add a description to start this with an agent.");
  const todoReason = blockedReason ?? (todoUnsupported || undefined);
  return (
    <form
      aria-label={draft.id ? t("Edit task") : t("New task")}
      aria-busy={saving}
      onSubmit={(event) => {
        event.preventDefault();
        if (saving) return;
        if (draft.id) {
          if (canSave) {
            setSubmitMode("save");
            onSubmit("save");
          }
        } else if (canTodo) {
          setSubmitMode("todo");
          onSubmit("todo");
        }
      }}
      className="task-form"
    >
      <div className="task-form-body">
        <fieldset disabled={saving} inert={saving} className="task-form-fields">
          <TextField
            hideLabel
            label=""
            autoFocus
            aria-label={t("Task title")}
            value={draft.title}
            onChange={(event) => update("title", event.target.value)}
            placeholder={t("What should get done?")}
            fieldClassName="task-title-field"
          />
          <div className="task-form-context">
            {!draft.id ? (
              <SearchableSelect
                variant="pill"
                label={t("Machine")}
                value={targetId}
                options={machineOptions}
                onChange={(id) => {
                  onChange({
                    ...draft,
                    machineId: id,
                    providerAccountId: defaultAccountFor(draft.harness, id),
                    crewDefinitionId: undefined,
                    workspace: undefined,
                    cwd: firstProjectOn(recents, id),
                  });
                }}
              />
            ) : null}
            {draft.id ? (
              // A task stays in the project it was created for.
              <span className="truncate">{projectName}</span>
            ) : (
              <SearchableSelect
                variant="pill"
                label={t("Project")}
                placeholder={t("Choose project")}
                value={draft.cwd}
                options={projectChoices(recents, { include: draft.cwd }).map((entry) => ({
                  value: entry.path,
                  label: projectDisplayName(entry.path),
                  keywords: entry.path,
                }))}
                onChange={(cwd) =>
                  onChange({ ...draft, cwd, workspace: undefined, crewDefinitionId: undefined })
                }
              />
            )}
            <ProjectDiscoveryStatus state={projectState} />
            <span aria-hidden className="h-3 w-px shrink-0 bg-(--ui-tone-neutral-border)" />
            {target && !looksLikeProject(draft.cwd) ? (
              <span>{t("Choose project")}</span>
            ) : machine ? (
              <span className="truncate">
                {t("Runs on ")}
                {machine}
              </span>
            ) : (
              <InlineMessage tone="warning" live="assertive">
                {TASK_MACHINE_ERROR}
              </InlineMessage>
            )}
            {!draft.id && todoUnsupported ? (
              <InlineMessage tone="warning">{todoUnsupported}</InlineMessage>
            ) : null}
          </div>
          <SkillPromptField
            value={draft.prompt}
            harness={draft.harness}
            cwd={draft.cwd}
            onChange={(prompt) => update("prompt", prompt)}
            label={t("Description")}
            placeholder={t("Details, acceptance criteria, links…")}
            surface="raised"
            frameProps={{ "data-task-prompt": "" }}
          />
          <CrewTaskPicker
            cwd={draft.cwd}
            machineId={targetId}
            value={draft.crewDefinitionId}
            disabled={saving || draft.workspaceLocked}
            onChange={(crewDefinitionId) => onChange({ ...draft, crewDefinitionId })}
            onValidityChange={setCrewValid}
          />
          {draft.crewDefinitionId ? (
            <div className="task-form-context">
              <AccessPicker
                value={draft.runtimeMode}
                onChange={(runtimeMode) => update("runtimeMode", runtimeMode)}
              />
              <SearchableSelect
                variant="pill"
                searchable={false}
                label={t("Time limit")}
                value={String(draft.maxRunMinutes)}
                options={RUN_TIME_LIMIT_OPTIONS}
                onChange={(value) => update("maxRunMinutes", Number(value))}
              />
            </div>
          ) : null}
          {/* Who does the work: one choice, with the agent's own settings one step away. */}
          <div className="task-form-options">
            {!draft.crewDefinitionId ? (
              <div className="task-form-section">
                <div className="flex min-w-0 items-center gap-2">
                  <Button
                    variant="ghost"
                    type="button"
                    aria-expanded={agentOpen}
                    onClick={() => setAgentOpen((open) => !open)}
                  >
                    {agentOpen ? (
                      <ChevronDown className="icon-xs" />
                    ) : (
                      <ChevronRight className="icon-xs" />
                    )}
                    {t("Agent settings")}
                  </Button>
                  {agentOpen ? null : (
                    <span className="task-form-hint min-w-0 truncate">
                      {resolveModel(draft.harness, draft.model).name}
                    </span>
                  )}
                </div>
                {agentOpen ? (
                  <div className="task-form-section-body">
                    {machine && looksLikeProject(draft.cwd) ? (
                      <p className="task-form-hint">
                        {t("Used when this task runs in {p0} on {p1}.", {
                          p0: projectName,
                          p1: machine,
                        })}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-1">
                      <ModelPicker
                        harness={draft.harness}
                        model={draft.model}
                        values={draft.modelSettings}
                        project={draft.cwd}
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
                      <span className="ml-auto flex items-center gap-2 text-ui-micro text-(--ui-text-secondary)">
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
                    </div>
                    <div className="task-form-checks">
                      <label className="flex cursor-pointer items-center gap-1.5">
                        <Checkbox
                          checked={draft.review}
                          onChange={(event) => update("review", event.target.checked)}
                        />
                        {t("Review with a second agent")}
                      </label>
                      <AutoMergeField
                        checked={draft.autoMerge && draft.isolate === true}
                        disabled={!draft.isolate}
                        onChange={(checked) => update("autoMerge", checked)}
                      />
                      <ContinueUntilDoneField
                        checked={draft.continueUntilDone}
                        onChange={(checked) => update("continueUntilDone", checked)}
                      />
                    </div>
                    {draft.review ? (
                      <details className="min-w-0 space-y-2 text-ui-caption">
                        <summary className="cursor-pointer">{t("Reviewer profile")}</summary>
                        <label className="flex items-center gap-2">
                          <Checkbox
                            checked={Boolean(draft.reviewerConfig)}
                            onChange={(event) =>
                              update(
                                "reviewerConfig",
                                event.target.checked
                                  ? {
                                      harness:
                                        draft.harness as import("../../connections/model/protocol").RemoteProvider,
                                      model: draft.model,
                                      modelSettings: { ...draft.modelSettings },
                                      instructions: "",
                                    }
                                  : undefined,
                              )
                            }
                          />
                          {t("Use a separate reviewer profile")}
                        </label>
                        {draft.reviewerConfig ? (
                          <div className="min-w-0 space-y-2">
                            <ModelPicker
                              presentation="field"
                              harness={draft.reviewerConfig.harness}
                              model={draft.reviewerConfig.model}
                              allowedHarnesses={REMOTE_PROVIDERS}
                              values={draft.reviewerConfig.modelSettings}
                              project={draft.cwd}
                              onChange={(harness, model) =>
                                update("reviewerConfig", {
                                  ...draft.reviewerConfig!,
                                  harness:
                                    harness as import("../../connections/model/protocol").RemoteProvider,
                                  model,
                                  modelSettings: {},
                                })
                              }
                              onSettingsChange={(modelSettings) =>
                                update("reviewerConfig", {
                                  ...draft.reviewerConfig!,
                                  modelSettings,
                                })
                              }
                            />
                            <TextareaField
                              label={t("Reviewer instructions")}
                              rows={2}
                              maxLength={8000}
                              value={draft.reviewerConfig.instructions}
                              onChange={(event) =>
                                update("reviewerConfig", {
                                  ...draft.reviewerConfig!,
                                  instructions: event.target.value,
                                })
                              }
                            />
                          </div>
                        ) : null}
                      </details>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <details
            className="task-form-advanced"
            open={advancedOpen}
            onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
          >
            <summary>{t("Advanced")}</summary>
            <div className="task-form-section">
              <label className="task-form-check-command">
                <span className="shrink-0">{t("Check command")}</span>
                <TextField
                  hideLabel
                  label=""
                  aria-label={t("Check command")}
                  value={draft.verifyCommand}
                  onChange={(event) => update("verifyCommand", event.target.value)}
                  placeholder={"npm test"}
                  spellCheck={false}
                  monospace
                  fieldClassName="min-w-[12rem] flex-1"
                />
              </label>
            </div>
            {!draft.crewDefinitionId ? (
              <details className="task-form-section task-advanced-options">
                <summary>{t("Working branch and worktree")}</summary>
                <div className="task-form-section-body">
                  <TaskExecutionMode
                    isolate={draft.isolate}
                    disabled={saving || draft.workspaceLocked}
                    onChange={(isolate) => update("isolate", isolate)}
                  />
                  <TaskWorkspacePicker
                    headingHidden
                    machine={target}
                    cwd={draft.cwd}
                    value={draft.workspace}
                    onChange={(workspace) => update("workspace", workspace)}
                    disabled={saving || draft.workspaceLocked}
                    branchName={draft.isolate === true}
                    isolate={draft.isolate}
                    onBusyChange={setWorkspaceBusy}
                    onChecksChange={patchWorkspaceChecks}
                  />
                </div>
              </details>
            ) : null}
            <TaskWorkflowControls
              scope={{ machineId: targetId, projectId: draft.cwd }}
              draft={{
                prompt: draft.prompt,
                verifyCommand: draft.verifyCommand,
                review: draft.review,
                reviewerConfig: draft.reviewerConfig,
                modelSettings: draft.modelSettings,
                requirements: draft.preflightRequirements,
              }}
              busy={saving}
              preflight={preflightResult?.key === preflightKey ? preflightResult.report : undefined}
              onCheck={async () =>
                setPreflightResult({
                  key: preflightKey,
                  report: await preflightTaskDraft(machines, draft),
                })
              }
              onApply={(value, profile) =>
                onChange({
                  ...draft,
                  prompt: value.prompt,
                  verifyCommand: value.verifyCommand ?? draft.verifyCommand,
                  review: value.review ?? draft.review,
                  reviewerConfig: value.reviewerConfig ?? draft.reviewerConfig,
                  modelSettings: value.modelSettings ?? draft.modelSettings,
                  preflightRequirements: value.requirements ?? draft.preflightRequirements,
                  ...(profile
                    ? { workflowId: profile.id, workflowVersion: Math.max(1, profile.updatedAt) }
                    : {}),
                })
              }
            />
            <TaskBudgetControls
              budget={draft.budget}
              onChange={(budget) => update("budget", budget)}
            />
          </details>
        </fieldset>
      </div>
      <div className="task-form-footer">
        <Button variant="ghost" type="button" disabled={saving} onClick={onCancel}>
          {t("Cancel")}
        </Button>
        {draft.id ? (
          <Button
            variant="primary"
            type="submit"
            loading={saving}
            disabled={!canSave || saving}
            disabledReason={
              canSave || saving ? undefined : (blockedReason ?? t("Add a description to save."))
            }
          >
            {t("Save")}
          </Button>
        ) : (
          <>
            <Button
              variant="secondary"
              type="button"
              disabled={!ready || !hasDescription || saving}
              loading={saving && submitMode === "queued"}
              tooltip={ready && hasDescription ? t("Queues it for an agent now.") : undefined}
              disabledReason={(ready && hasDescription) || saving ? undefined : startReason}
              onClick={() => {
                setSubmitMode("queued");
                onSubmit("queued");
              }}
            >
              {t(draft.crewDefinitionId ? "Start with crew" : "Add and start")}
            </Button>
            <Button
              variant="primary"
              type="submit"
              loading={saving && submitMode === "todo"}
              disabled={!canTodo || saving}
              tooltip={canTodo ? t("Saves it without running.") : undefined}
              disabledReason={canTodo || saving ? undefined : todoReason}
            >
              {t("Add to To do")}
            </Button>
          </>
        )}
      </div>
    </form>
  );
}
