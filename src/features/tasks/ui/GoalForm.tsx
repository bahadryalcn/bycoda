import { type FormEvent, useId, useState } from "react";
import { t, useFormat, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { FieldGroup } from "../../../shared/ui/FieldGroup";
import { InlineAction, ActionHost } from "../../../shared/ui/ActionHost";
import { InlineError } from "../../../shared/ui/InlineError";
import { ModalActions, ModalFooter } from "../../../shared/ui/Modal";
import { PromptField } from "../../../shared/ui/PromptField";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Surface } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { TextField } from "../../../shared/ui/TextField";
import { X } from "../../../shared/ui/icons";
import { backgroundMachineFor } from "../../automations/public/hostMachines";
import type { RemoteMachine } from "../../connections";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import { CrewTaskPicker } from "../../crews/public/CrewTaskPicker";
import { projectDisplayNameFrom, useProjectLabels } from "../../projects/public/projectNames";
import type { RecentProject } from "../../projects/public/recents";
import { AccessPicker } from "../../sessions/public/AccessPicker";
import { ModelLabel } from "../../sessions/public/ModelLabel";
import { ModelPicker } from "../../sessions/public/ModelPicker";
import { defaultModelSettings, resolveModel } from "../../sessions/public/models";
import { WorkspacePicker } from "../../workspace/public/WorkspacePicker";
import { type GoalDraft, toggleGoalProject } from "../model/goalClient";
import { MAX_GOAL_PROJECTS } from "../model/hostGoals";
import type { MachineLimits } from "../model/settingsClient";
import { taskClientErrors } from "../model/taskClientErrors";
import {
  GoalConcurrencyOption,
  GoalContinueSwitch,
  goalWorkspacesValid,
  TaskMoreOptions,
} from "./GoalFormParts";
import { TaskAccountPicker } from "./TaskAccountPicker";
import { TaskBudgetControls } from "./TaskBudgetControls";
import {
  ProjectDiscoveryStatus,
  RUN_TIME_LIMIT_OPTIONS,
  TaskExecutionMode,
  TaskFormRow,
  TaskFormSwitch,
} from "./TaskFormFields";
import { MachineConcurrency, type SaveLimits } from "./TaskLimits";
import { TaskModelChoiceField, useTaskModelRouting } from "./TaskModelChoiceField";
import { TargetChips } from "../../../shared/ui/TargetChips";
import {
  INITIAL_WORKSPACE_CHECKS,
  TaskWorkspacePicker,
  taskWorkspaceScope,
  type WorkspaceChecks,
} from "./TaskWorkspacePicker";
import { useTaskTargetMachine } from "./useTaskTargetMachine";
import "./task-goals.css";

/** Creates a plan from an objective and the selected Host's project checkouts. */
export function GoalForm({
  draft: inputDraft,
  recents,
  machines,
  machine,
  saving,
  error,
  onChange,
  onCancel,
  onSubmit,
  limits,
  onChangeLimits,
}: {
  draft: GoalDraft;
  recents: RecentProject[];
  machines: RemoteMachine[];
  machine?: string;
  saving: boolean;
  error?: string | null;
  onChange: (draft: GoalDraft) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent, draft: GoalDraft) => void;
  limits: readonly MachineLimits[];
  onChangeLimits: SaveLimits;
}) {
  useLocale();
  const projectLabels = useProjectLabels();
  const format = useFormat();
  const formId = useId();
  const [checkingCreation, setCheckingCreation] = useState(false);
  const [busyProjects, setBusyProjects] = useState<ReadonlySet<string>>(new Set());
  const [crewValid, setCrewValid] = useState(false);
  const [concurrencyValid, setConcurrencyValid] = useState(true);
  const [workspaceChecks, setWorkspaceChecks] = useState<Record<string, WorkspaceChecks>>({});
  const { targetId, target, projectState, machineOptions, defaultAccountFor, projectChoices } =
    useTaskTargetMachine({
      machines,
      machineId: inputDraft.machineId,
      cwd: inputDraft.cwds[0] ?? "",
    });
  const { supported: routingSupported, choice } = useTaskModelRouting(
    target,
    true,
    inputDraft.modelChoice,
  );
  const draft =
    choice === inputDraft.modelChoice ? inputDraft : { ...inputDraft, modelChoice: choice };
  const update = <K extends keyof GoalDraft>(key: K, value: GoalDraft[K]) =>
    onChange({ ...draft, [key]: value });
  const workspaceBusy = busyProjects.size > 0;
  const workspacesValid = goalWorkspacesValid(draft, target, workspaceChecks);
  const pendingCreation = Boolean(draft.creation?.pending);
  const fieldsLocked = saving || pendingCreation;
  const projectsValid =
    draft.cwds.length > 0 &&
    machine != null &&
    target != null &&
    draft.cwds.every((cwd) => backgroundMachineFor(machines, cwd)?.id === targetId);
  const selectedCrewValid = !draft.crewDefinitionId || (draft.cwds.length === 1 && crewValid);
  const valid =
    projectsValid &&
    workspacesValid &&
    !workspaceBusy &&
    selectedCrewValid &&
    concurrencyValid &&
    Boolean(draft.title.trim() && draft.prompt.trim() && draft.model);
  let reason: string | undefined;
  if (!fieldsLocked && !valid) {
    // A missing title or description is plain from the empty fields and the disabled primary.
    if (!draft.title.trim() || !draft.prompt.trim()) reason = undefined;
    else if (!draft.cwds.length) reason = t("Choose project");
    else if (!projectsValid) reason = taskClientErrors.machine();
    else if (workspaceBusy) reason = t("Creating the integration worktree…");
    else if (!workspacesValid) reason = t("Check the selected working copy.");
    else if (!selectedCrewValid) reason = t("A crew epic must use one project and a valid crew.");
    else if (!concurrencyValid) reason = t("Enter a valid task limit.");
    else reason = taskClientErrors.agent();
  }
  const lead = draft.leadCwd || draft.cwds[0] || "";
  const localAccounts = Boolean(target && isLocalSyncMachine(target));
  const projects = draft.cwds.map((cwd) => ({
    value: cwd,
    label: projectDisplayNameFrom(cwd, projectLabels),
  }));
  const timeLimit = String(draft.maxRunMinutes);
  const fixedLimit = RUN_TIME_LIMIT_OPTIONS.find((option) => option.value === timeLimit);
  const timeLabel = fixedLimit?.label ?? format.formatDuration(draft.maxRunMinutes * 60_000);
  const executionLabel =
    draft.isolate === undefined
      ? undefined
      : draft.isolate
        ? t("Separate worktree")
        : t("Shared checkout");

  return (
    <form
      id={formId}
      aria-label={t("New epic")}
      aria-busy={saving}
      onSubmit={(event) => {
        event.preventDefault();
        // Reconciliation can read the original receipt while current inventory is unavailable.
        if (!saving && (pendingCreation || valid)) {
          setCheckingCreation(pendingCreation);
          onSubmit(event, draft);
        }
      }}
      className="task-form"
    >
      <div className="task-form-body">
        <FieldGroup variant="bare" disabled={fieldsLocked} inert={fieldsLocked}>
          <div className="task-form-fields">
            <TextField
              label={t("Epic title")}
              hideLabel
              appearance="quiet"
              textSize="title"
              weight="medium"
              autoFocus
              value={draft.title}
              onChange={(event) => update("title", event.target.value)}
              placeholder={t("Name the main job")}
            />
            <PromptField
              label={t("Objective")}
              surface="raised"
              minRows={4}
              value={draft.prompt}
              onChange={(event) => update("prompt", event.target.value)}
              placeholder={t("Details, acceptance criteria, links…")}
            />
            <TargetChips
              disabled={fieldsLocked || workspaceBusy}
              machine={{
                value: targetId,
                options: machineOptions,
                onChange: (machineId) => {
                  setWorkspaceChecks({});
                  setCrewValid(false);
                  onChange({
                    ...draft,
                    machineId,
                    modelChoice: undefined,
                    cwds: [],
                    leadCwd: "",
                    workspaces: undefined,
                    crewDefinitionId: undefined,
                    providerAccountId: defaultAccountFor(draft.harness, machineId),
                  });
                },
              }}
              model={
                <TaskModelChoiceField
                  machine={target}
                  routingRole="goal.planner"
                  value={draft.modelChoice}
                  supported={routingSupported}
                  onChange={(choice) => update("modelChoice", choice)}
                  fixedLabel={<ModelLabel harness={draft.harness} model={draft.model} />}
                  fixed={
                    <ModelPicker
                      presentation="chip"
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
                          modelChoice: routingSupported
                            ? (draft.modelChoice ?? { kind: "fixed" })
                            : undefined,
                          modelSettings:
                            harness === draft.harness && model === draft.model
                              ? draft.modelSettings
                              : defaultModelSettings(resolveModel(harness, model)),
                          providerAccountId: localAccounts
                            ? (accountId ?? defaultAccountFor(harness))
                            : harness === draft.harness
                              ? draft.providerAccountId
                              : defaultAccountFor(harness),
                        })
                      }
                      onSettingsChange={(modelSettings) => update("modelSettings", modelSettings)}
                    />
                  }
                />
              }
              access={
                draft.harness !== "fx" ? (
                  <AccessPicker
                    value={draft.runtimeMode}
                    onChange={(mode) => update("runtimeMode", mode)}
                  />
                ) : null
              }
            />
            {!routingSupported || !draft.modelChoice || draft.modelChoice.kind === "fixed" ? (
              <TaskAccountPicker
                harness={draft.harness}
                accountId={draft.providerAccountId}
                local={localAccounts}
              />
            ) : null}
            <Surface
              frame="pane"
              radius="row"
              dividers="pane"
              padding="sm"
              className="task-form-rows"
            >
              <div className="goal-project-controls">
                {projects.length < MAX_GOAL_PROJECTS ? (
                  <SearchableSelect
                    hideLabel
                    variant="pill"
                    label={t("Project")}
                    placeholder={t("Choose project")}
                    value=""
                    disabled={workspaceBusy}
                    options={projectChoices(recents, { exclude: draft.cwds }).map(({ path }) => ({
                      value: path,
                      label: projectDisplayNameFrom(path, projectLabels),
                      keywords: path,
                    }))}
                    onChange={(cwd) => {
                      setCrewValid(false);
                      onChange(toggleGoalProject(draft, cwd));
                    }}
                  />
                ) : null}
                {projects.length > 1 ? (
                  <TaskFormRow label={t("Lead project")}>
                    <SearchableSelect
                      variant="pill"
                      searchable={false}
                      hideLabel
                      label={t("Lead project")}
                      value={lead}
                      options={projects}
                      onChange={(cwd) => update("leadCwd", cwd)}
                    />
                  </TaskFormRow>
                ) : null}
                <ProjectDiscoveryStatus state={projectState} />
              </div>
              {projects.map(({ value: cwd, label }) => {
                const scope = taskWorkspaceScope(target, cwd);
                const workspace = draft.workspaces?.[cwd];
                return (
                  <ActionHost
                    key={scope}
                    role="group"
                    aria-label={label}
                    data-goal-project={cwd}
                    className="goal-project-row"
                  >
                    <Text truncate size="secondary" tone="primary">
                      {label}
                    </Text>
                    <TaskWorkspacePicker
                      headingHidden
                      machine={target}
                      cwd={cwd}
                      isolate={draft.isolate}
                      value={workspace}
                      disabled={fieldsLocked || (workspaceBusy && !busyProjects.has(scope))}
                      onBusyChange={(busy) =>
                        setBusyProjects((current) => {
                          const next = new Set(current);
                          if (busy) next.add(scope);
                          else next.delete(scope);
                          return next;
                        })
                      }
                      onChecksChange={(patch) =>
                        setWorkspaceChecks((current) => ({
                          ...current,
                          [scope]: { ...(current[scope] ?? INITIAL_WORKSPACE_CHECKS), ...patch },
                        }))
                      }
                      onChange={(next) =>
                        update("workspaces", { ...draft.workspaces, [cwd]: next ?? {} })
                      }
                      render={(fields) => (
                        <WorkspacePicker
                          presentation="chip"
                          label={
                            workspace?.baseBranch ??
                            (workspace?.checkoutCwd ? t("Worktree") : t("Project checkout"))
                          }
                          worktree={Boolean(workspace?.checkoutCwd)}
                          enabled={Boolean(machine) && !fieldsLocked}
                          content={fields}
                        />
                      )}
                    />
                    <InlineAction
                      reveal="always"
                      label={t("Remove {p0}", { p0: label })}
                      disabled={workspaceBusy}
                      disabledReason={t("Creating the integration worktree…")}
                      onClick={() => {
                        setCrewValid(false);
                        setWorkspaceChecks((current) => {
                          const remaining = { ...current };
                          delete remaining[scope];
                          return remaining;
                        });
                        onChange(toggleGoalProject(draft, cwd));
                      }}
                    >
                      <X />
                    </InlineAction>
                  </ActionHost>
                );
              })}
            </Surface>
            <Surface
              frame="pane"
              radius="row"
              dividers="pane"
              padding="sm"
              className="task-form-rows"
            >
              <TaskFormSwitch
                label={t("Review the plan before starting")}
                checked={draft.approvePlan}
                onChange={(checked) => update("approvePlan", checked)}
              />
              <TaskFormSwitch
                label={t("Review each task with a second agent")}
                checked={draft.review}
                onChange={(checked) => update("review", checked)}
              />
              <GoalContinueSwitch
                checked={draft.continueUntilDone}
                onChange={(checked) => update("continueUntilDone", checked)}
              />
            </Surface>

            <TaskMoreOptions
              summary={[
                draft.maxRunMinutes > 0 && timeLabel,
                executionLabel,
                draft.manualStart && t("Manually from To do"),
                draft.maxRunningTasks
                  ? `${t("Concurrent tasks in this epic")} (${format.formatNumber(draft.maxRunningTasks)})`
                  : undefined,
                draft.finalReview !== true && t("Final review off"),
                draft.budget && t("Run budget"),
                draft.crewDefinitionId && t("Crew"),
              ]}
            >
              <Surface
                frame="pane"
                radius="row"
                dividers="pane"
                padding="sm"
                className="task-form-rows"
              >
                <TaskFormRow label={t("Time limit")}>
                  <SearchableSelect
                    hideLabel
                    variant="pill"
                    searchable={false}
                    align="end"
                    label={t("Time limit")}
                    value={timeLimit}
                    options={
                      fixedLimit
                        ? RUN_TIME_LIMIT_OPTIONS
                        : [...RUN_TIME_LIMIT_OPTIONS, { value: timeLimit, label: timeLabel }]
                    }
                    onChange={(value) => update("maxRunMinutes", Number(value))}
                  />
                </TaskFormRow>
                <TaskExecutionMode
                  isolate={draft.isolate}
                  disabled={workspaceBusy}
                  onChange={(isolate) => update("isolate", isolate)}
                />
                <GoalConcurrencyOption
                  value={draft.maxRunningTasks ?? 0}
                  onChange={(value) => update("maxRunningTasks", value || undefined)}
                  onValidityChange={setConcurrencyValid}
                />
                <TaskFormSwitch
                  label={t("Start planned tasks manually")}
                  checked={draft.manualStart === true}
                  onChange={(checked) => update("manualStart", checked)}
                />
                <TaskFormSwitch
                  label={t("Verify the integrated result before completing this epic")}
                  checked={draft.finalReview === true}
                  onChange={(checked) => update("finalReview", checked)}
                />
                <TaskBudgetControls
                  compact
                  budget={draft.budget}
                  onChange={(budget) => update("budget", budget)}
                />
                {projects.length === 1 || draft.crewDefinitionId ? (
                  <CrewTaskPicker
                    key={JSON.stringify([targetId, draft.cwds, draft.crewDefinitionId])}
                    cwd={draft.cwds[0] ?? ""}
                    machineId={targetId}
                    value={draft.crewDefinitionId}
                    disabled={fieldsLocked || workspaceBusy}
                    onChange={(id) => {
                      setCrewValid(false);
                      update("crewDefinitionId", id);
                    }}
                    onValidityChange={setCrewValid}
                  />
                ) : null}
                <MachineConcurrency
                  machineId={targetId}
                  limits={limits}
                  onChange={onChangeLimits}
                />
              </Surface>
            </TaskMoreOptions>
          </div>
        </FieldGroup>
        {error ? <InlineError className="mt-3" details={error} /> : null}
      </div>
      <ModalFooter>
        <ModalActions reason={reason}>
          <Button variant="ghost" type="button" disabled={fieldsLocked} onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            loading={saving}
            disabled={saving || (!pendingCreation && !valid)}
          >
            {(saving ? checkingCreation : pendingCreation)
              ? t("Check epic creation")
              : t("Plan it")}
          </Button>
        </ModalActions>
      </ModalFooter>
    </form>
  );
}
