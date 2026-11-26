import { useId, type FormEvent } from "react";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ModalActions } from "../../../shared/ui/Modal";
import { Select } from "../../../shared/ui/Select";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { TargetChips } from "../../../shared/ui/TargetChips";
import { TextField } from "../../../shared/ui/TextField";
import { Play, Trash2 } from "../../../shared/ui/icons";
import type { RemoteMachine } from "../../connections/public/protocol";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import { isProjectLockedIn } from "../../group-lock/public/lockState";
import { useLockSnapshot } from "../../group-lock/public/useGroupLock";
import { projectDisplayNameFrom, useProjectLabels } from "../../projects/public/projectNames";
import { looksLikeProject, type RecentProject } from "../../projects/public/recents";
import { AccessPicker } from "../../sessions/public/AccessPicker";
import { SkillPromptField } from "../../skills/public/SkillPromptField";
import { WorkspacePicker } from "../../workspace/public/WorkspacePicker";
import { useAutomationRoutingHost } from "../hooks/useAutomationRoutingHost";
import {
  automationName,
  backgroundRequired,
  backgroundTriggerReady,
  resolveRunMode,
  withTemplate,
} from "../model/automationDraftRules";
import type { AutomationDraft, AutomationRun } from "../model/automations";
import { backgroundMachineFor, decideHostAutomationRun } from "../model/hostAutomationClient";
import { AutomationFixedModel, AutomationModelChoice } from "./AutomationModelChoice";
import { RecipeStepsEditor, recipeStepsValid } from "./RecipeStepsEditor";
import { newRecipeStepId } from "../model/automationRecipe";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { WorkExecutorFields } from "../../tasks/public/workExecutor";
import { crewIncompatibility } from "../../../shared/model/host-contracts/work-executor";
import { AutomationMoreOptions } from "./AutomationMoreOptions";
import { AutomationRuns } from "./AutomationRuns";
import { AutomationTemplateMenu } from "./AutomationTemplateMenu";
import { AutomationTriggerField } from "./AutomationTriggerField";
import { useHostCapabilities } from "./useHostCapabilities";

/** Project chip value for an automation that belongs to no project (Host room). */
const GENERAL = "general:";
const ROOM_CAPABILITY = "automations.room.v1";

const WORKTREE_OPTIONS = [
  {
    value: "automatic",
    get label() {
      return t("Automatic");
    },
  },
  {
    value: "current",
    get label() {
      return t("Current");
    },
  },
  {
    value: "worktree",
    get label() {
      return t("Fresh worktree");
    },
  },
] as const;

/**
 * One page for creating and editing an automation: name (optional), instructions, where and how it
 * runs, its trigger, the rare settings, and for a saved automation its recent runs. The list owns
 * pausing; Run now owns running; templates live in the footer.
 */
export function AutomationEditor({
  machines,
  machine,
  draft,
  recents,
  runs,
  historyLoading,
  historyError,
  onRefreshHistory,
  saving,
  running,
  deleteDisabled,
  dirty,
  onChange,
  onClose,
  onSubmit,
  onRun,
  onDelete,
  onOpenTask,
  onOpenSession,
}: {
  machines: readonly RemoteMachine[];
  /** The machine whose Host runs this draft in the background. */
  machine?: RemoteMachine;
  draft: AutomationDraft;
  recents: readonly RecentProject[];
  runs: AutomationRun[];
  historyLoading: boolean;
  historyError: string | null;
  onRefreshHistory: () => void;
  saving: boolean;
  running: boolean;
  deleteDisabled: boolean;
  dirty: boolean;
  onChange: (draft: AutomationDraft) => void;
  /** Cancels a new draft or resets an edited one. */
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  onRun?: () => void;
  onDelete?: () => void;
  onOpenTask?: (taskId: string) => void | Promise<void>;
  onOpenSession: (sessionId: string) => void | Promise<void>;
}) {
  useLocale();
  const formId = useId();
  const reasonId = useId();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const lock = useLockSnapshot();
  const projectLabels = useProjectLabels();
  const routingHost = useAutomationRoutingHost(draft.runInBackground ? machine?.id : undefined);
  const capabilities = useHostCapabilities(machine);
  const saved = Boolean(draft.id);
  const background = draft.runInBackground;
  const targetId = machine?.id ?? "";
  const machineName = (entry: RemoteMachine) =>
    isLocalSyncMachine(entry) ? t("this computer") : entry.name;
  const usableOn = (path: string, id: string) =>
    looksLikeProject(path) &&
    !isProjectLockedIn(lock, path) &&
    (backgroundMachineFor(machines, path)?.id ?? "") === id;
  const generalOffered =
    !saved && !!machine && capabilities.data?.includes(ROOM_CAPABILITY) === true;
  const projectOptions = [
    ...(generalOffered ? [{ value: GENERAL, label: t("General") }] : []),
    ...[{ path: draft.cwd }, ...recents]
      .filter(
        (entry, index, entries) =>
          usableOn(entry.path, targetId) &&
          entries.findIndex((other) => other.path === entry.path) === index,
      )
      .map((entry) => ({
        value: entry.path,
        label: projectDisplayNameFrom(entry.path, projectLabels),
        keywords: entry.path,
      })),
  ];
  const projectLocked = saved && background;
  const update = <K extends keyof AutomationDraft>(key: K, value: AutomationDraft[K]) =>
    onChange({ ...draft, [key]: value });
  const worktree =
    draft.workspaceMode === "existing" ? "current" : (draft.workspaceMode ?? "automatic");
  const worktreeLabel = WORKTREE_OPTIONS.find((option) => option.value === worktree)?.label;

  const hasInstructions = draft.workRecipe
    ? recipeStepsValid(draft.workRecipe.steps)
    : draft.prompt.trim().length > 0;
  // Steps run as Host tasks, so only a background automation without a template or event offers them.
  const stepsOffered = background && !draft.hostTemplate && !draft.hostTrigger;
  const hasProject =
    looksLikeProject(draft.cwd) || (background && !draft.cwd && !!draft.hostMachineId);
  const hasName = automationName(draft).length > 0;
  const hasTrigger = !background || backgroundTriggerReady(draft);
  const valid = hasInstructions && hasName && hasProject && hasTrigger && draft.model.length > 0;
  const reason = saving
    ? undefined
    : !hasInstructions
      ? t("Add instructions to continue.")
      : !hasProject
        ? t("Choose a project to continue.")
        : !hasName
          ? t("Add a name to continue.")
          : !hasTrigger
            ? t("Choose one schedule or event to continue.")
            : undefined;
  const canSubmit = valid && !saving && (!saved || dirty);

  return (
    <form
      id={formId}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      aria-busy={saving}
      onSubmit={(event) => {
        if (!valid) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
    >
      <div
        ref={lockOverscroll}
        inert={saving}
        className="automation-scroll min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none"
      >
        <div className="automation-content automation-editor">
          <TextField
            label={t("Automation name")}
            hideLabel
            appearance="quiet"
            textSize="title"
            weight="medium"
            autoFocus
            disabled={saving}
            value={draft.name}
            onChange={(event) => update("name", event.target.value)}
            placeholder={t("Name (optional)")}
          />
          {stepsOffered ? (
            <SegmentedControl
              label={t("Instructions")}
              value={draft.workRecipe ? "steps" : "prompt"}
              options={[
                { value: "prompt", label: t("One prompt"), disabled: saving },
                { value: "steps", label: t("Steps"), disabled: saving },
              ]}
              onValueChange={(next) =>
                update(
                  "workRecipe",
                  next === "steps"
                    ? (draft.workRecipe ?? {
                        version: 1,
                        steps: [
                          {
                            id: newRecipeStepId(),
                            kind: "task",
                            title: draft.name.trim() || t("Step 1"),
                            request: draft.prompt,
                          },
                        ],
                      })
                    : undefined,
                )
              }
            />
          ) : null}
          {draft.workRecipe ? (
            <RecipeStepsEditor
              steps={draft.workRecipe.steps}
              disabled={saving}
              defaults={{
                machine: routingHost.machineId ? { id: routingHost.machineId } : undefined,
                routingSupported: routingHost.supported,
                cwd: draft.cwd,
                harness: draft.harness,
                modelSettings: draft.modelSettings,
                modelChoice: draft.modelChoice,
              }}
              onChange={(steps) =>
                update("workRecipe", { version: draft.workRecipe!.version, steps })
              }
            />
          ) : (
            <SkillPromptField
              value={draft.prompt}
              harness={draft.harness}
              cwd={draft.cwd}
              onChange={(prompt) => update("prompt", prompt)}
              surface="raised"
              minRows={5}
              label={t("Instructions")}
              placeholder={t("Tell the agent what to do when this automation runs…")}
              frameProps={{ "data-automation-prompt": "" }}
            />
          )}
          <TargetChips
            disabled={saving}
            machine={{
              value: targetId,
              options: machines.map((entry) => ({
                value: entry.id,
                label: isLocalSyncMachine(entry) ? t("This computer") : entry.name,
              })),
              currentLabel: machine ? machineName(machine) : undefined,
              onChange: saved
                ? undefined
                : (id) =>
                    onChange(
                      resolveRunMode(draft, {
                        ...draft,
                        hostMachineId: id,
                        cwd: recents.find((entry) => usableOn(entry.path, id))?.path ?? "",
                        sessionFolderId: "",
                      }),
                    ),
            }}
            project={{
              value: draft.cwd || (background ? GENERAL : ""),
              options: projectOptions,
              currentLabel: draft.cwd
                ? looksLikeProject(draft.cwd)
                  ? projectDisplayNameFrom(draft.cwd, projectLabels)
                  : undefined
                : background
                  ? t("General")
                  : undefined,
              onChange: projectLocked
                ? undefined
                : (value) =>
                    onChange(
                      resolveRunMode(
                        draft,
                        value === GENERAL
                          ? {
                              ...draft,
                              cwd: "",
                              sessionFolderId: "",
                              hostMachineId: machine?.id,
                            }
                          : {
                              ...draft,
                              cwd: value,
                              sessionFolderId: "",
                              hostMachineId: undefined,
                            },
                      ),
                    ),
            }}
            model={
              // A background automation chooses its model in the Run with fields below.
              background ? null : (
                <AutomationModelChoice
                  draft={draft}
                  onChange={onChange}
                  routingHost={routingHost}
                />
              )
            }
            access={
              draft.harness !== "fx" ? (
                <AccessPicker
                  value={draft.runtimeMode}
                  onChange={(runtimeMode) => update("runtimeMode", runtimeMode)}
                />
              ) : null
            }
            workingCopy={
              !background && looksLikeProject(draft.cwd) ? (
                <WorkspacePicker
                  presentation="chip"
                  // The Access chip can read "Auto" beside this one, so name what is automatic.
                  label={
                    worktree === "automatic" ? t("Automatic workspace") : (worktreeLabel ?? "")
                  }
                  worktree={worktree === "worktree"}
                  enabled={!saving}
                  content={
                    <Select
                      label={t("Worktree")}
                      value={worktree}
                      options={[...WORKTREE_OPTIONS]}
                      onValueChange={(value) =>
                        onChange({
                          ...draft,
                          workspaceMode:
                            value === "automatic" ? undefined : (value as "current" | "worktree"),
                          worktreeCwd: "",
                          reuseSession: value === "current" && draft.reuseSession,
                        })
                      }
                    />
                  }
                />
              ) : null
            }
          />
          {background ? (
            <WorkExecutorFields
              routingRole="automation"
              machine={routingHost.machineId ? { id: routingHost.machineId } : undefined}
              routingSupported={routingHost.supported}
              cwd={draft.cwd}
              harness={draft.harness}
              modelSettings={draft.modelSettings}
              executor={draft.workExecutor}
              onExecutorChange={(workExecutor) => update("workExecutor", workExecutor)}
              executorIssue={
                draft.workExecutor?.kind === "crew"
                  ? crewIncompatibility({
                      isolate: draft.workspaceMode === "worktree",
                      modelChoice: draft.modelChoice,
                    })?.reason
                  : undefined
              }
              modelChoice={draft.modelChoice}
              onModelChoiceChange={(modelChoice) => update("modelChoice", modelChoice)}
              fixedModel={<AutomationFixedModel draft={draft} onChange={onChange} />}
              helpers={draft.workHelpers}
              onHelpersChange={(workHelpers) => update("workHelpers", workHelpers)}
              disabled={saving}
            />
          ) : null}
          <AutomationTriggerField draft={draft} machine={machine} onChange={onChange} />
          <AutomationMoreOptions
            draft={draft}
            background={
              !saved && machine && !backgroundRequired(draft)
                ? { machineName: machineName(machine) }
                : undefined
            }
            onChange={onChange}
          />
          {saved ? (
            <AutomationRuns
              runs={runs}
              loading={historyLoading}
              error={historyError}
              draft={draft}
              onRefresh={onRefreshHistory}
              onDecide={
                draft.id && draft.hostMachineId
                  ? async (runId, approve) => {
                      await decideHostAutomationRun(
                        draft.hostMachineId!,
                        draft.id!,
                        runId,
                        approve,
                      );
                      onRefreshHistory();
                    }
                  : undefined
              }
              onOpenTask={onOpenTask}
              onOpenSession={onOpenSession}
            />
          ) : null}
        </div>
      </div>
      <div
        {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "shrink-0 px-3 py-2 sm:px-6")}
      >
        <ModalActions
          start={
            <>
              {saved ? null : (
                <AutomationTemplateMenu
                  disabled={saving}
                  onPick={(template) => onChange(withTemplate(draft, template))}
                />
              )}
              {onDelete ? (
                <Button
                  type="button"
                  variant="ghost"
                  tone="danger"
                  startIcon={<Trash2 className="icon-sm" />}
                  disabled={saving || deleteDisabled}
                  disabledReason={
                    deleteDisabled
                      ? t(
                          "Wait for the current operation to finish before deleting this automation.",
                        )
                      : undefined
                  }
                  onClick={onDelete}
                >
                  {t("Delete")}
                </Button>
              ) : null}
            </>
          }
          reason={reason}
          reasonId={reasonId}
        >
          {!saved || dirty ? (
            <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
              {saved ? t("Reset") : t("Cancel")}
            </Button>
          ) : null}
          {onRun ? (
            <Button
              type="button"
              onClick={onRun}
              loading={running}
              disabled={saving || dirty}
              disabledReason={dirty ? t("Save or reset your changes before running.") : undefined}
              startIcon={<Play className="icon-sm" />}
              variant="secondary"
            >
              {t("Run now")}
            </Button>
          ) : null}
          <Button
            type="submit"
            form={formId}
            variant="primary"
            disabled={!canSubmit}
            aria-describedby={!valid && reason ? reasonId : undefined}
            loading={saving}
          >
            {saved ? t("Save") : t("Create")}
          </Button>
        </ModalActions>
      </div>
    </form>
  );
}
