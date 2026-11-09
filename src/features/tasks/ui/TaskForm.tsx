import { projectDisplayName } from "../../projects/public/projectNames";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { TextField } from "../../../shared/ui/TextField";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { isWorkspaceValid, TaskWorkspacePicker, useWorkspaceChecks } from "./TaskWorkspacePicker";
import { useTaskTargetMachine } from "./useTaskTargetMachine";
import { TaskFormAgent } from "./TaskFormAgent";
import "./task-form.css";
import { CrewTaskPicker } from "../../crews/ui/CrewTaskPicker";
import { preflightTaskDraft, TASK_MACHINE_ERROR, type TaskDraft } from "../model/taskClient";
import { t, useLocale } from "../../../shared/i18n";
import { useState } from "react";
import { AccessPicker } from "../../sessions/public/AccessPicker";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SkillPromptField } from "../../skills/ui/SkillPromptField";
import { TaskWorkflowControls } from "./TaskWorkflowControls";
import { TaskBudgetControls } from "./TaskBudgetControls";
import type { TaskPreflightReport } from "../model/taskPreflight";
import { backgroundMachineFor } from "../../automations/model/hostAutomationClient";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { RemoteMachine } from "../../connections/public/protocol";

import { looksLikeProject, type RecentProject } from "../../projects/public/recents";
import {
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
          <div className="task-form-targets">
            <div className="task-form-targets-row">
              {!draft.id ? (
                <SearchableSelect
                  hideLabel
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
                  hideLabel
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
            </div>
            <div className="task-form-targets-note">
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
                hideLabel
                variant="pill"
                searchable={false}
                label={t("Time limit")}
                value={String(draft.maxRunMinutes)}
                options={RUN_TIME_LIMIT_OPTIONS}
                onChange={(value) => update("maxRunMinutes", Number(value))}
              />
            </div>
          ) : null}
          {draft.crewDefinitionId ? null : (
            <TaskFormAgent
              draft={draft}
              update={update}
              onChange={onChange}
              open={agentOpen}
              onOpenChange={setAgentOpen}
              machine={machine}
              projectName={projectName}
              hasProject={looksLikeProject(draft.cwd)}
              localAccounts={localAccounts}
              defaultAccountFor={defaultAccountFor}
            />
          )}
          <Disclosure
            variant="card"
            className="task-form-advanced"
            open={advancedOpen}
            onOpenChange={setAdvancedOpen}
            summary={t("Advanced")}
          >
            <div className="task-form-section">
              <TextField
                label={t("Check command")}
                value={draft.verifyCommand}
                onChange={(event) => update("verifyCommand", event.target.value)}
                placeholder={"npm test"}
                spellCheck={false}
                monospace
              />
            </div>
            {!draft.crewDefinitionId ? (
              <Disclosure
                className="task-advanced-options"
                summary={t("Working branch and worktree")}
              >
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
              </Disclosure>
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
          </Disclosure>
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
