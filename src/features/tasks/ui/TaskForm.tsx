import { useEffect, useEffectEvent, useId, useState } from "react";
import { t, useFormat, useLocale } from "../../../shared/i18n";
import { useConnectionErrorShownCentrally } from "../../../shared/ui/connectionErrorGate";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { FieldGroup } from "../../../shared/ui/FieldGroup";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { ModalActions, ModalFooter } from "../../../shared/ui/Modal";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Surface } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { TextField } from "../../../shared/ui/TextField";
import {
  AUTOMATIC_SUBAGENTS,
  CROSS_SUBAGENTS_KEY,
} from "../../../shared/model/host-contracts/delegation";
import { backgroundMachineFor } from "../../automations/public/hostMachines";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import { presentRemoteError } from "../../connections/public/remoteFailure";
import type { RemoteMachine } from "../../connections/public/protocol";
import { useProjectCrews } from "../../crews/model/crewClient";
import { useModelRouting } from "../../model-routing/public/choice";
import { projectDisplayNameFrom, useProjectLabels } from "../../projects/public/projectNames";
import { looksLikeProject, type RecentProject } from "../../projects/public/recents";
import { AccessPicker } from "../../sessions/public/AccessPicker";
import { SkillPromptField } from "../../skills/ui/SkillPromptField";
import { WorkspacePicker } from "../../workspace/public/WorkspacePicker";
import { preflightTaskDraft, type TaskDraft } from "../model/taskClient";
import { taskClientErrors } from "../model/taskClientErrors";
import { parseTaskPreflightRequirements } from "../model/taskPreflight";
import { resolveTaskTitle, TASK_TITLE_LIMIT } from "../model/taskTitle";
import { TaskBudgetControls } from "./TaskBudgetControls";
import { TaskFormAgent, TaskReviewerFields } from "./TaskFormAgent";
import {
  ProjectDiscoveryStatus,
  RUN_TIME_LIMIT_OPTIONS,
  TaskExecutionMode,
  TaskFormRow,
  TaskFormSwitch,
} from "./TaskFormFields";
import { useTaskModelRouting } from "./TaskModelChoiceField";
import { TargetChips } from "../../../shared/ui/TargetChips";
import {
  TaskResourceFields,
  TaskTemplateMenu,
  type PreparationState,
} from "./TaskWorkflowControls";
import {
  isWorkspaceValid,
  TaskWorkspacePicker,
  taskWorkspaceScope,
  useWorkspaceChecks,
} from "./TaskWorkspacePicker";
import { useTaskTargetMachine } from "./useTaskTargetMachine";
import "./task-form.css";

type SubmitMode = "todo" | "queued" | "save";

export function TaskForm({
  draft: inputDraft,
  recents,
  machines,
  machine,
  todoUnsupported,
  crewPreselected = false,
  saving,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: TaskDraft;
  recents: RecentProject[];
  machines: RemoteMachine[];
  /** The machine whose host would run this draft, when connected. */
  machine?: string;
  todoUnsupported?: string;
  /** The caller chose the crew: its row and the crew's Access stay hidden while the crew resolves. */
  crewPreselected?: boolean;
  saving: boolean;
  onChange: (draft: TaskDraft) => void;
  onCancel: () => void;
  onSubmit: (mode: SubmitMode, draft: TaskDraft) => void;
}) {
  useLocale();
  const projectLabels = useProjectLabels();
  const format = useFormat();
  const formId = useId();
  const reasonId = useId();
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceChecks, patchWorkspaceChecks] = useWorkspaceChecks();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [submitMode, setSubmitMode] = useState<SubmitMode>("queued");
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
    machineId: inputDraft.machineId,
    cwd: inputDraft.cwd,
    discover: !inputDraft.id,
  });
  const { supported: routingSupported, choice } = useTaskModelRouting(
    target,
    !inputDraft.id,
    inputDraft.modelChoice,
  );
  const routing = useModelRouting(targetId || undefined, routingSupported);
  const draft =
    choice === inputDraft.modelChoice ? inputDraft : { ...inputDraft, modelChoice: choice };
  const update = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) =>
    onChange({ ...draft, [key]: value });
  const isEdit = Boolean(draft.id);
  const hasCrew = Boolean(draft.crewDefinitionId);
  const crewQuery = useProjectCrews(draft.cwd, Boolean(targetId && draft.cwd));
  const centralCrewError = useConnectionErrorShownCentrally(crewQuery.error);
  const crews =
    crewQuery.data?.machine.id === targetId && crewQuery.data.taskExecutionSupported
      ? crewQuery.data.definitions
      : [];
  const crew = crews.find((entry) => entry.id === draft.crewDefinitionId);
  const crewValid = !hasCrew || Boolean(crew);
  const crewLoading = hasCrew && !crewQuery.data && !crewQuery.error && crewQuery.isFetching;
  // A preselected crew that fails to resolve brings the picker back so the draft can recover.
  const showCrewRows = !crewPreselected || (!crewValid && !crewLoading);
  const { preparation, requirementsError } = useTaskPreparation(machines, draft, target, saving);
  const workspaceValid = isWorkspaceValid(
    draft.workspace,
    workspaceChecks,
    taskWorkspaceScope(target, draft.cwd),
  );
  const hasDescription = Boolean(draft.prompt.trim());
  const titleTooLong = draft.title.trim().length > TASK_TITLE_LIMIT;
  const titleValid = isEdit
    ? Boolean(draft.title.trim()) && !titleTooLong
    : Boolean(resolveTaskTitle(draft.title, draft.prompt));
  const projectValid =
    looksLikeProject(draft.cwd) &&
    (isEdit || backgroundMachineFor(machines, draft.cwd)?.id === targetId);
  const ready =
    titleValid &&
    projectValid &&
    draft.model.length > 0 &&
    machine != null &&
    !workspaceBusy &&
    (hasCrew ? crewValid : workspaceValid) &&
    !requirementsError;
  const canStart = ready && hasDescription;
  const canTodo = ready && !todoUnsupported;
  const canSave = ready && (draft.status === "todo" || hasDescription);
  const underivedTitle = !titleValid && !titleTooLong && !isEdit && hasDescription;
  let reason: string | undefined;
  if (!saving) {
    if (!machine && (looksLikeProject(draft.cwd) || !target)) {
      reason = taskClientErrors.machine();
    } else if (workspaceBusy) {
      reason = t("Creating the integration worktree…");
    } else if (!hasCrew && !workspaceValid) {
      reason = t("Check the selected working copy.");
    } else if (!optionsOpen && requirementsError) {
      reason = requirementsError;
    } else if (!optionsOpen && !crewValid) {
      reason = crewLoading ? t("Loading crews…") : t("Choose an available crew in More options.");
    } else if (!isEdit && projectValid && machine) {
      reason = todoUnsupported;
    }
  }
  const submit = (mode: SubmitMode) => {
    if (saving || !(mode === "save" ? canSave : mode === "queued" ? canStart : canTodo)) return;
    setSubmitMode(mode);
    onSubmit(mode, draft);
  };
  const limit = draft.maxRunMinutes;
  const limitLabel =
    RUN_TIME_LIMIT_OPTIONS.find((option) => option.value === String(limit))?.label ??
    (limit === undefined ? undefined : format.formatDuration(limit * 60_000));
  const defaultLimit = routing.state?.defaultMaxRunMinutes;
  const defaultLimitLabel = routing.state
    ? `${t("Default")} · ${defaultLimit ? format.formatDuration(defaultLimit * 60_000) : t("No limit")}`
    : t("Default");
  const timeLimitOptions = [
    { value: "inherit", label: defaultLimitLabel },
    ...RUN_TIME_LIMIT_OPTIONS,
  ];
  const requirementCount = draft.preflightRequirements?.length ?? 0;
  const optionSummary = [
    limit === 0 ? t("No time limit") : limitLabel,
    draft.verifyCommand.trim(),
    !hasCrew && draft.modelSettings[CROSS_SUBAGENTS_KEY] === "[]" ? t("Subagents off") : undefined,
    draft.budget ? t("Run budget") : undefined,
    requirementCount
      ? t("Resources ({p0})", { p0: format.formatNumber(requirementCount) })
      : undefined,
    showCrewRows ? (crew?.name ?? (hasCrew ? t("Crew") : undefined)) : undefined,
    !hasCrew && draft.review && draft.reviewerConfig ? t("Reviewer profile") : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  const workspaceMode =
    draft.isolate === undefined
      ? t("Automatic")
      : draft.isolate
        ? t("Separate worktree")
        : t("Shared checkout");
  const workspaceLabel = draft.workspace?.baseBranch
    ? `${workspaceMode} · ${draft.workspace.baseBranch}`
    : workspaceMode;
  return (
    <form
      id={formId}
      aria-label={isEdit ? t("Edit task") : t("New task")}
      aria-busy={saving}
      className="task-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit(isEdit ? "save" : "queued");
      }}
    >
      <div className="task-form-body">
        <FieldGroup variant="bare" disabled={saving} inert={saving}>
          <div className="task-form-fields">
            <TextField
              label={t("Task title")}
              hideLabel
              appearance="quiet"
              textSize="title"
              weight="medium"
              autoFocus
              aria-required={isEdit || undefined}
              value={draft.title}
              onChange={(event) => update("title", event.target.value)}
              placeholder={isEdit ? t("What should get done?") : t("Title (optional)")}
              error={
                titleTooLong
                  ? t("The title must be at most 200 characters. Shorten it before saving.")
                  : underivedTitle
                    ? t("Add a title to continue.")
                    : undefined
              }
            />
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
            <TargetChips
              disabled={saving}
              machine={{
                value: targetId,
                options: machineOptions,
                currentLabel: machine,
                onChange: isEdit
                  ? undefined
                  : (machineId) =>
                      onChange({
                        ...draft,
                        machineId,
                        modelChoice: undefined,
                        providerAccountId: defaultAccountFor(draft.harness, machineId),
                        crewDefinitionId: undefined,
                        workspace: undefined,
                        cwd: firstProjectOn(recents, machineId),
                      }),
              }}
              project={{
                value: draft.cwd,
                currentLabel: looksLikeProject(draft.cwd)
                  ? projectDisplayNameFrom(draft.cwd, projectLabels)
                  : undefined,
                options: projectChoices(recents, { include: draft.cwd }).map((entry) => ({
                  value: entry.path,
                  label: projectDisplayNameFrom(entry.path, projectLabels),
                  keywords: entry.path,
                })),
                onChange: isEdit
                  ? undefined
                  : (cwd) =>
                      onChange({
                        ...draft,
                        cwd,
                        modelChoice: undefined,
                        workspace: undefined,
                        crewDefinitionId: undefined,
                      }),
              }}
              model={
                !hasCrew ? (
                  <TaskFormAgent
                    draft={draft}
                    target={target}
                    routingSupported={routingSupported}
                    localAccounts={Boolean(target && isLocalSyncMachine(target))}
                    defaultAccountFor={defaultAccountFor}
                    update={update}
                    onChange={onChange}
                  />
                ) : null
              }
              access={
                !hasCrew && draft.harness !== "fx" ? (
                  <AccessPicker
                    value={draft.runtimeMode}
                    onChange={(mode) => update("runtimeMode", mode)}
                  />
                ) : null
              }
              workingCopy={
                <TaskWorkspacePicker
                  headingHidden
                  machine={target}
                  cwd={draft.cwd}
                  value={draft.workspace}
                  onChange={(workspace) => update("workspace", workspace)}
                  disabled={saving || draft.workspaceLocked || hasCrew}
                  branchName={draft.isolate === true}
                  isolate={draft.isolate}
                  onBusyChange={setWorkspaceBusy}
                  onChecksChange={patchWorkspaceChecks}
                  render={(fields) =>
                    !hasCrew ? (
                      <WorkspacePicker
                        presentation="chip"
                        label={workspaceLabel}
                        worktree={draft.isolate === true || Boolean(draft.workspace?.checkoutCwd)}
                        enabled={!saving && Boolean(machine)}
                        content={
                          <>
                            <TaskExecutionMode
                              isolate={draft.isolate}
                              disabled={workspaceBusy || draft.workspaceLocked}
                              onChange={(isolate) => update("isolate", isolate)}
                            />
                            {fields}
                          </>
                        }
                      />
                    ) : null
                  }
                />
              }
            />
            <ProjectDiscoveryStatus state={projectState} />
            {!hasCrew ? (
              <Surface
                frame="pane"
                radius="row"
                dividers="pane"
                padding="sm"
                className="task-form-rows"
              >
                <TaskFormSwitch
                  label={t("Review with a second agent")}
                  checked={draft.review}
                  onChange={(review) => update("review", review)}
                />
                <TaskFormSwitch
                  label={t("Keep fixing until done")}
                  help={t("Keeps correcting while progress is made; asks for input when needed.")}
                  checked={draft.continueUntilDone}
                  onChange={(value) => update("continueUntilDone", value)}
                />
              </Surface>
            ) : null}
            <Disclosure
              variant="compact"
              open={optionsOpen}
              onOpenChange={setOptionsOpen}
              summary={
                <>
                  {t("More options")}
                  {!optionsOpen && optionSummary ? (
                    <Text truncate size="caption" tone="muted" className="task-form-summary-hint">
                      · {optionSummary}
                    </Text>
                  ) : null}
                </>
              }
            >
              <div className="task-more-options">
                <Surface
                  frame="pane"
                  radius="row"
                  dividers="pane"
                  padding="sm"
                  className="task-form-rows"
                >
                  <TaskFormRow label={t("Time limit")}>
                    <SearchableSelect
                      label={t("Time limit")}
                      hideLabel
                      variant="pill"
                      align="end"
                      searchable={false}
                      value={limit === undefined ? "inherit" : String(limit)}
                      options={
                        limit !== undefined &&
                        !RUN_TIME_LIMIT_OPTIONS.some((option) => option.value === String(limit))
                          ? [
                              ...timeLimitOptions,
                              { value: String(limit), label: limitLabel ?? String(limit) },
                            ]
                          : timeLimitOptions
                      }
                      onChange={(value) =>
                        update("maxRunMinutes", value === "inherit" ? undefined : Number(value))
                      }
                    />
                  </TaskFormRow>
                  <TaskFormRow
                    label={
                      <span className="inline-flex items-center gap-1">
                        {t("Check command")}
                        <InfoPopover>
                          {t("Runs after the agent finishes to check the result.")}
                        </InfoPopover>
                      </span>
                    }
                  >
                    <TextField
                      label={t("Check command")}
                      hideLabel
                      fieldVariant="compact"
                      monospace
                      spellCheck={false}
                      placeholder="npm test"
                      value={draft.verifyCommand}
                      onChange={(event) => update("verifyCommand", event.target.value)}
                    />
                  </TaskFormRow>
                  {!hasCrew ? (
                    <TaskFormSwitch
                      label={t("Allow subagents")}
                      checked={draft.modelSettings[CROSS_SUBAGENTS_KEY] !== "[]"}
                      onChange={(value) =>
                        update("modelSettings", {
                          ...draft.modelSettings,
                          [CROSS_SUBAGENTS_KEY]: value ? AUTOMATIC_SUBAGENTS : "[]",
                        })
                      }
                    />
                  ) : null}
                  <TaskBudgetControls
                    compact
                    budget={draft.budget}
                    onChange={(budget) => update("budget", budget)}
                  />
                  <TaskResourceFields
                    requirements={draft.preflightRequirements ?? []}
                    onChange={(value) => update("preflightRequirements", value)}
                    preparation={preparation}
                  />
                  {hasCrew || crews.length ? (
                    <div>
                      {showCrewRows ? (
                        <TaskFormRow label={t("Run with a crew")}>
                          <SearchableSelect
                            label={t("Crew")}
                            hideLabel
                            variant="pill"
                            value={draft.crewDefinitionId ?? ""}
                            disabled={draft.workspaceLocked || workspaceBusy}
                            options={[
                              { value: "", label: t("Agent") },
                              ...crews.map((entry) => ({
                                value: entry.id,
                                label: entry.name,
                                description: entry.projectId
                                  ? t("This project")
                                  : t("All projects on this host"),
                              })),
                            ]}
                            onChange={(id) => update("crewDefinitionId", id || undefined)}
                          />
                        </TaskFormRow>
                      ) : null}
                      {hasCrew && showCrewRows ? (
                        <TaskFormRow label={t("Access")}>
                          <AccessPicker
                            value={draft.runtimeMode}
                            onChange={(mode) => update("runtimeMode", mode)}
                          />
                        </TaskFormRow>
                      ) : null}
                      {crewLoading ? <LoadingText>{t("Loading crews…")}</LoadingText> : null}
                      {crewQuery.error && !centralCrewError ? (
                        <InlineError
                          details={crewQuery.error.message}
                          retry={{
                            onRetry: () => {
                              void crewQuery.refetch().catch(() => {});
                            },
                            pending: crewQuery.isFetching,
                          }}
                        >
                          {t("Could not load the crews for this project.")}
                        </InlineError>
                      ) : !crewValid && !crewLoading && !crewQuery.error ? (
                        <InlineMessage tone="warning">
                          {t("Connect an updated host and choose an available crew.")}
                        </InlineMessage>
                      ) : null}
                    </div>
                  ) : null}
                </Surface>
                {!hasCrew && draft.review ? (
                  <Surface
                    frame="pane"
                    radius="row"
                    dividers="pane"
                    padding="sm"
                    className="task-form-rows"
                  >
                    <TaskReviewerFields draft={draft} update={update} />
                  </Surface>
                ) : null}
              </div>
            </Disclosure>
          </div>
        </FieldGroup>
      </div>
      <ModalFooter>
        <ModalActions
          start={
            <TaskTemplateMenu
              scope={{ machineId: targetId, projectId: draft.cwd }}
              templateId={draft.workflowId}
              draft={{
                prompt: draft.prompt,
                verifyCommand: draft.verifyCommand,
                review: draft.review,
                reviewerConfig: draft.reviewerConfig,
                modelSettings: draft.modelSettings,
                requirements: draft.preflightRequirements,
              }}
              busy={saving}
              onApply={(value, profile) =>
                onChange({
                  ...draft,
                  prompt: value.prompt,
                  verifyCommand: value.verifyCommand ?? draft.verifyCommand,
                  review: value.review ?? draft.review,
                  ...(value.reviewerConfig ? { reviewerConfig: value.reviewerConfig } : {}),
                  modelSettings: value.modelSettings ?? draft.modelSettings,
                  preflightRequirements: value.requirements ?? draft.preflightRequirements,
                  workflowId: profile.id,
                  workflowVersion: Math.max(1, profile.updatedAt),
                })
              }
            />
          }
          reason={reason}
          reasonId={reasonId}
        >
          <Button variant="ghost" type="button" disabled={saving} onClick={onCancel}>
            {t("Cancel")}
          </Button>
          {!isEdit ? (
            <Button
              variant="secondary"
              type="button"
              disabled={!canTodo || saving}
              loading={saving && submitMode === "todo"}
              aria-describedby={!canTodo && reason ? reasonId : undefined}
              onClick={() => submit("todo")}
            >
              {t("Add to To do")}
            </Button>
          ) : null}
          <Button
            variant="primary"
            type="submit"
            form={formId}
            disabled={!(isEdit ? canSave : canStart) || saving}
            aria-describedby={
              !(isEdit ? canSave : canStart) && reason && reason !== todoUnsupported
                ? reasonId
                : undefined
            }
            loading={saving && submitMode !== "todo"}
          >
            {isEdit ? t("Save") : t("Start")}
          </Button>
        </ModalActions>
      </ModalFooter>
    </form>
  );
}

function useTaskPreparation(
  machines: RemoteMachine[],
  draft: TaskDraft,
  target: RemoteMachine | undefined,
  saving: boolean,
) {
  const [revision, retry] = useState(0);
  const [answer, setAnswer] = useState<{ key: string; result: PreparationState }>();
  let requirementsError: string | undefined;
  try {
    parseTaskPreflightRequirements(draft.preflightRequirements);
  } catch {
    requirementsError = t("Check the resource references. Each needs a unique, valid reference.");
  }
  const enabled =
    !requirementsError &&
    Boolean(target && looksLikeProject(draft.cwd) && draft.preflightRequirements?.length);
  const key = JSON.stringify([
    taskWorkspaceScope(target, draft.cwd),
    draft.harness,
    draft.providerAccountId,
    draft.model,
    draft.modelChoice,
    draft.modelSettings,
    draft.isolate,
    draft.workspace,
    draft.crewDefinitionId,
    draft.preflightRequirements,
    revision,
  ]);
  const [currentKey, setCurrentKey] = useState(key);
  if (currentKey !== key) {
    setCurrentKey(key);
    setAnswer(undefined);
  }
  const check = useEffectEvent(() => preflightTaskDraft(machines, { ...draft, title: "" }));
  // Debounce edits and ignore answers from older resource lists or Host targets.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- runs the debounced preparation check timer for the current resource list and drops late Host answers
  useEffect(() => {
    if (!enabled || saving) return;
    let current = true;
    const timer = setTimeout(() => {
      void check().then(
        (report) => {
          if (current) setAnswer({ key, result: { report } });
        },
        (error) => {
          if (current)
            setAnswer({ key, result: { error: presentRemoteError(error, { explicit: true }) } });
        },
      );
    }, 350);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [enabled, key, saving]);
  const preparation: PreparationState = requirementsError
    ? { error: requirementsError }
    : !enabled
      ? {}
      : answer?.key === key
        ? { ...answer.result, retry: () => retry((value) => value + 1) }
        : { pending: true };
  return { preparation, requirementsError };
}
