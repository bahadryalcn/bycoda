import { type FormEvent, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { FieldGroup } from "../../../shared/ui/FieldGroup";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { InlineAction } from "../../../shared/ui/ActionHost";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { PromptField } from "../../../shared/ui/PromptField";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { TextField } from "../../../shared/ui/TextField";
import { X } from "../../../shared/ui/icons";
import { backgroundMachineFor } from "../../automations/public/hostMachines";
import type { RemoteMachine } from "../../connections";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import { projectDisplayName } from "../../projects/public/projectNames";
import type { RecentProject } from "../../projects/public/recents";
import { AccessPicker } from "../../sessions/public/AccessPicker";
import { ModelPicker } from "../../sessions/public/ModelPicker";
import { type GoalDraft, toggleGoalProject } from "../model/goalClient";
import { MAX_GOAL_PROJECTS } from "../model/hostGoals";
import type { HostSettings } from "../model/hostSettings";
import type { MachineLimits } from "../model/settingsClient";
import { TASK_MACHINE_ERROR } from "../model/taskClient";
import {
  GoalConcurrencyOption,
  GoalExecutionModeOption,
  GoalOption,
  GoalSection,
  GoalCheckOption,
} from "./GoalFormParts";
import { TaskAccountPicker } from "./TaskAccountPicker";
import { TaskBudgetControls } from "./TaskBudgetControls";
import { AutoMergeField, ProjectDiscoveryStatus, RUN_TIME_LIMIT_OPTIONS } from "./TaskFormFields";
import { MachineConcurrency } from "./TaskLimits";
import {
  INITIAL_WORKSPACE_CHECKS,
  isWorkspaceValid,
  TaskWorkspacePicker,
  type WorkspaceChecks,
} from "./TaskWorkspacePicker";
import { useTaskTargetMachine } from "./useTaskTargetMachine";
import "./task-goals.css";

/** The new goal form: the job, where it runs, how it runs, review and delivery, and limits. */
export function GoalForm({
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
    useTaskTargetMachine({
      machines,
      machineId: draft.machineId,
      cwd: draft.cwds[0] ?? "",
    });
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
  const executionHint =
    draft.isolate === undefined
      ? undefined
      : draft.isolate !== true
        ? t("Tasks work directly in the selected checkout. You review and commit the changes.")
        : t("Each task runs on its own branch and waits for you to merge it.");
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
        <FieldGroup variant="bare" disabled={saving} inert={saving}>
          <div className="goal-form-sections min-w-0">
            <GoalSection title={t("What")} framed={false}>
              <TextField
                hideLabel
                label=""
                autoFocus
                aria-label={t("Goal title")}
                value={draft.title}
                onChange={(event) => update("title", event.target.value)}
                placeholder={t("Name the main job")}
              />
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
                      hideLabel
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
            </GoalSection>

            <GoalSection title={t("Where")} framed={false}>
              <div className="goal-section-rows">
                <GoalOption title={t("Machine")}>
                  <SearchableSelect
                    hideLabel
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
                </GoalOption>
                <div className="goal-option-wide grid min-w-0 gap-2">
                  <div className="goal-projects">
                    <span className="shrink-0">{t("Projects")}</span>
                    {draft.cwds.map((cwd) => (
                      <span key={cwd} data-goal-project={cwd} className="goal-project-chip">
                        <span className="min-w-0 truncate">{projectDisplayName(cwd)}</span>
                        {cwd === lead ? <span className="shrink-0">{t("lead")}</span> : null}
                        <InlineAction
                          reveal="always"
                          label={t("Remove {p0}", {
                            p0: projectDisplayName(cwd),
                          })}
                          onClick={() => onChange(toggleGoalProject(draft, cwd))}
                        >
                          <X />
                        </InlineAction>
                      </span>
                    ))}
                    {draft.cwds.length < MAX_GOAL_PROJECTS ? (
                      <SearchableSelect
                        hideLabel
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
                        {t("Lead")}
                        <SearchableSelect
                          variant="pill"
                          searchable={false}
                          hideLabel
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
                  </div>
                  {machine ? (
                    <span className="text-ui-caption text-(--ui-text-secondary)">
                      {t("Runs on ")}
                      {machine}
                    </span>
                  ) : draft.cwds.length ? (
                    <InlineMessage tone="warning" live="assertive">
                      {TASK_MACHINE_ERROR}
                    </InlineMessage>
                  ) : (
                    <span className="text-ui-caption text-(--ui-text-secondary)">
                      {t("Choose the projects the job may touch, all on one machine.")}
                    </span>
                  )}
                </div>
              </div>
              <Disclosure summary={t("Working branch and worktree")}>
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
                            [cwd]: {
                              ...(current[cwd] ?? INITIAL_WORKSPACE_CHECKS),
                              ...patch,
                            },
                          }))
                        }
                        onChange={(workspace) =>
                          update("workspaces", {
                            ...draft.workspaces,
                            [cwd]: workspace ?? {},
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              </Disclosure>
            </GoalSection>

            <GoalSection title={t("How it runs")}>
              <GoalOption
                title={t("Start planned tasks")}
                description={t("Choose whether planned tasks start on their own.")}
              >
                <SearchableSelect
                  hideLabel
                  label={t("Start planned tasks")}
                  searchable={false}
                  value={draft.manualStart ? "manual" : "automatic"}
                  options={[
                    {
                      value: "automatic",
                      label: t("Automatically when ready"),
                    },
                    { value: "manual", label: t("Manually from To do") },
                  ]}
                  onChange={(value) => update("manualStart", value === "manual")}
                />
              </GoalOption>
              <GoalExecutionModeOption
                isolate={draft.isolate}
                description={executionHint}
                disabled={saving}
                onChange={(isolate) => update("isolate", isolate)}
              />
              <GoalConcurrencyOption
                value={draft.maxRunningTasks ?? 0}
                onChange={(value) => update("maxRunningTasks", value || undefined)}
              />
              <GoalCheckOption
                title={t("Continue until complete")}
                description={t(
                  "Keeps correcting while progress is made; asks for input when needed.",
                )}
                checked={draft.continueUntilDone}
                onChange={(checked) => update("continueUntilDone", checked)}
              />
            </GoalSection>

            <GoalSection title={t("Review and delivery")}>
              <GoalCheckOption
                title={t("Review the plan before starting")}
                description={t("The planned tasks are created only once you approve the plan.")}
                checked={draft.approvePlan}
                onChange={(checked) => update("approvePlan", checked)}
              />
              <GoalCheckOption
                title={t("Review each task with a second agent")}
                description={t("A second agent checks each task's result.")}
                checked={draft.review}
                onChange={(checked) => update("review", checked)}
              />
              <GoalCheckOption
                title={t("Verify the integrated result before completing this goal")}
                description={t(
                  "Checks the combined result of all tasks before the goal completes.",
                )}
                checked={draft.finalReview === true}
                onChange={(checked) => update("finalReview", checked)}
              />
              <div className="goal-option-wide grid gap-1">
                <AutoMergeField
                  checked={draft.autoMerge && draft.isolate === true}
                  disabled={draft.isolate !== true}
                  onChange={(checked) => update("autoMerge", checked)}
                />
                {draft.isolate !== true ? (
                  <span className="goal-option-reason">
                    {t("Needs a separate worktree for each task.")}
                  </span>
                ) : null}
              </div>
            </GoalSection>

            <GoalSection title={t("Limits")} framed={false}>
              <TaskBudgetControls
                budget={draft.budget}
                onChange={(budget) => update("budget", budget)}
              />
              <MachineConcurrency machineId={targetId} limits={limits} onChange={onChangeLimits} />
            </GoalSection>
          </div>
        </FieldGroup>
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
