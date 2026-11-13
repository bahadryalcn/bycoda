import { t } from "../../../shared/i18n";
import { type FormEvent, useMemo, useState } from "react";
import { useSprintBoard } from "../model/sprintClient";
import { taskMatchesProject, type TaskProjectScope } from "../model/taskBoardScope";
import { TASK_MACHINE_ERROR } from "../model/taskClient";
import { backgroundMachineFor } from "../../automations/public/hostMachines";
import type { RemoteMachine } from "../../connections";
import { parseRemotePath } from "../../connections/public/remoteProjects";
import { isProjectLockedIn, type LockSnapshot } from "../../group-lock/public/lockState";
import { looksLikeProject, type RecentProject } from "../../projects/public/recents";
import {
  defaultSessionChoice,
  firstEnabledHarness,
  modelsFor,
  preferredModelId,
} from "../../sessions/public/models";
import type { GoalSettings } from "../model/hostGoals";
import {
  type BoardGoal,
  cancelGoal,
  createGoal,
  deleteGoal,
  type GoalDraft,
  goalKey,
  newGoalDraft,
  updateGoal,
} from "../model/goalClient";
import type { BackgroundSessionTarget } from "../model/backgroundSession";
import type { PlanningRecovery, TaskBoardOperations } from "./useTaskBoardOperations";

export const ALL_GOALS = "all";

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
  const report = (reason: unknown) =>
    setError(reason instanceof Error ? reason.message : String(reason));
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
    if (draft?.creation?.pending || draft?.creation?.busy) {
      setError("Check the previous epic creation before opening another draft.");
      return;
    }
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

  const create = async (event: FormEvent, resolvedDraft = draft) => {
    event.preventDefault();
    if (saving || !resolvedDraft) return;
    setSaving(true);
    try {
      const saved = await createGoal(capable, resolvedDraft);
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
            t("Epic created. Sprint assignment failed: {p0}", {
              p0: reason instanceof Error ? reason.message : String(reason),
            }),
          );
          refresh().catch(report);
          return;
        }
      }
      setError(null);
      refresh().catch(report);
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
        title: t("Delete epic"),
        message: t("Delete the epic “{p0}”? Its tasks stay on the board.", { p0: goal.title }),
        confirmLabel: t("Delete"),
      }))
    )
      return;
    if (filter === goalKey(goal.machineId, goal.id)) setFilter(ALL_GOALS);
    act(
      { id: `goal:${goalKey(goal.machineId, goal.id)}` },
      () => deleteGoal(goal),
      () => removeGoal(goal),
    ).catch(report);
  };

  const cancel = (goal: BoardGoal) => {
    confirm({
      title: t("Cancel epic"),
      message: t("Cancel the epic “{p0}”? Its running tasks are stopped; their branches stay.", {
        p0: goal.title,
      }),
      confirmLabel: t("Cancel epic"),
    })
      .then((ok) => (ok ? actOn(goal, () => cancelGoal(goal)) : undefined))
      .catch(report);
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
      refresh().catch(report);
    } catch (reason) {
      setSettingsError(reason instanceof Error ? reason.message : String(reason));
      refresh().catch(report);
    } finally {
      setSaving(false);
    }
  };

  return {
    goals,
    report,
    draft,
    setDraft: (next: GoalDraft | null) => {
      if (saving || draft?.creation?.pending || draft?.creation?.busy) {
        setError("Check the previous epic creation before changing or closing its draft.");
        return;
      }
      setDraft(next);
    },
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
