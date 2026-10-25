import { remoteRequest } from "../../connections/model/connections";
import { isLocalSyncMachine } from "../../connections/model/localSync";
import {
  isRemoteProvider,
  type HostProject,
  type RemoteMachine,
} from "../../connections/model/protocol";
import { parseRemotePath } from "../../connections/model/remoteProjects";
import {
  backgroundMachines,
  hostProjectCwd,
  hostProjectFor,
} from "../../automations/model/hostAutomationClient";
import {
  collectMachineResults,
  type LastGoodLists,
  type MachineResult,
} from "../../automations/model/machineResults";
import { machineCapabilities, machineProjects } from "../../automations/model/machineSnapshot";
import type { HarnessId, RuntimeMode } from "../../sessions/model/session";
import {
  defaultProviderAccountId,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";
import { projectName } from "../../../shared/lib/paths";
import {
  HOST_DIRECT_GOALS,
  HOST_GOAL_FINAL_REVIEW,
  HOST_GOALS,
  MAX_GOAL_PROJECTS,
  type HostGoal,
  type HostGoalInput,
} from "./hostGoals";
import {
  TASK_AGENT_ERROR,
  requireTaskContinuation,
  requireTaskAccount,
  requireTaskWorkspaces,
  taskMachineFor,
  requireTaskHarnessCapabilities,
} from "./taskClient";
import type { TaskWorkspace } from "./taskWorkspace";
import type { TaskRunBudget } from "./taskBudget";

export const GOAL_MACHINE_ERROR = "A goal’s projects must all be on one machine.";

/** A goal's project as this desktop addresses it. */
export type BoardGoalProject = { id: string; cwd: string; name: string };

/** A host goal as this desktop shows it: on its machine, with its projects. */
export type BoardGoal = HostGoal & {
  finalReviewSupported?: boolean;
  machineId: string;
  machineName: string;
  /** The goal's projects the host still has, in the goal's order. */
  projects: BoardGoalProject[];
  /** The machine did not answer; this is what it last reported. */
  stale?: boolean;
  settingsSupported?: boolean;
};

/** What the goal form edits. */
export type GoalDraft = {
  finalReview?: boolean;
  budget?: TaskRunBudget;
  isolate: boolean;
  workspaces?: Record<string, TaskWorkspace>;
  maxRunningTasks?: number;
  manualStart?: boolean;
  machineId?: string;
  title: string;
  prompt: string;
  /** The projects, all on one machine; the first is the lead unless
   * `leadCwd` says otherwise. */
  cwds: string[];
  leadCwd: string;
  harness: HarnessId;
  providerAccountId?: string;
  model: string;
  modelSettings: Record<string, string>;
  runtimeMode: RuntimeMode;
  maxRunMinutes: number;
  approvePlan: boolean;
  review: boolean;
  /** Merge every task once its checks pass, without waiting for approval. */
  autoMerge: boolean;
  continueUntilDone: boolean;
};

/** Machines whose host carries out goals, this computer's included. */
export function goalMachines(fresh = false): Promise<RemoteMachine[]> {
  return backgroundMachines(HOST_GOALS, fresh);
}

export function newGoalDraft(cwd: string, harness: HarnessId, model: string): GoalDraft {
  return {
    finalReview: true,
    title: "",
    prompt: "",
    cwds: [cwd],
    leadCwd: cwd,
    harness,
    model,
    ...(!parseRemotePath(cwd) &&
    supportsProviderAccounts(harness) &&
    defaultProviderAccountId(harness) !== "default"
      ? { providerAccountId: defaultProviderAccountId(harness) }
      : {}),
    modelSettings: {},
    runtimeMode: "auto",
    maxRunMinutes: 0,
    approvePlan: false,
    isolate: false,
    review: false,
    autoMerge: false,
    continueUntilDone: true,
  };
}

/** Whether two projects are on the same machine: both on this computer, or
 * both on the same remote environment. */
export function sameGoalMachine(a: string, b: string): boolean {
  return parseRemotePath(a)?.environmentId === parseRemotePath(b)?.environmentId;
}

/** Adds a project to the draft, or removes it. A project on another machine
 * than the ones already chosen is not added; the lead moves to the first
 * project left when its own is removed. */
export function toggleGoalProject(draft: GoalDraft, cwd: string): GoalDraft {
  if (draft.cwds.includes(cwd)) {
    const cwds = draft.cwds.filter((entry) => entry !== cwd);
    return {
      ...draft,
      cwds,
      leadCwd: draft.leadCwd === cwd ? (cwds[0] ?? "") : draft.leadCwd,
    };
  }
  if (draft.cwds.length >= MAX_GOAL_PROJECTS) return draft;
  if (draft.cwds.length && !sameGoalMachine(draft.cwds[0], cwd)) return draft;
  return {
    ...draft,
    cwds: [...draft.cwds, cwd],
    leadCwd: draft.leadCwd || cwd,
  };
}

/** What the host stores for a draft. Throws when the draft's agent cannot run
 * on a host. */
export function hostGoalFromDraft(
  draft: GoalDraft,
  id: string,
  projectIds: string[],
  leadProjectId: string,
): HostGoalInput {
  if (!isRemoteProvider(draft.harness)) throw new Error(TASK_AGENT_ERROR);
  return {
    id,
    ...(draft.finalReview ? { finalReview: true } : {}),
    ...(draft.budget ? { budget: draft.budget } : {}),
    title: draft.title,
    prompt: draft.prompt,
    projectIds,
    leadProjectId,
    harness: draft.harness,
    ...(draft.providerAccountId === undefined
      ? {}
      : { providerAccountId: draft.providerAccountId }),
    model: draft.model,
    modelSettings: draft.modelSettings,
    runtimeMode: draft.runtimeMode,
    maxRunMinutes: draft.maxRunMinutes,
    ...(draft.isolate === false ? { isolate: false } : {}),
    ...(draft.workspaces
      ? {
          workspaces: Object.fromEntries(
            draft.cwds.flatMap((cwd, index) =>
              draft.workspaces?.[cwd] ? [[projectIds[index], draft.workspaces[cwd]]] : [],
            ),
          ),
        }
      : {}),
    ...(draft.maxRunningTasks ? { maxRunningTasks: draft.maxRunningTasks } : {}),
    ...(draft.manualStart ? { manualStart: true } : {}),
    verifyDefaults: { review: draft.review },
    approvePlan: draft.approvePlan,
    ...(draft.continueUntilDone ? { continueUntilDone: true } : {}),
    ...(draft.autoMerge && draft.isolate !== false ? { autoMerge: true } : {}),
  };
}

export function boardGoalsFromHost(
  machine: RemoteMachine,
  projects: readonly HostProject[],
  goals: readonly HostGoal[],
): BoardGoal[] {
  return goals.map((goal) => ({
    ...goal,
    machineId: machine.id,
    machineName: isLocalSyncMachine(machine) ? "this computer" : machine.name,
    projects: goal.projectIds.flatMap((id) => {
      const project = projects.find((entry) => entry.id === id);
      return project
        ? [
            {
              id,
              cwd: hostProjectCwd(machine, project),
              name: project.name || projectName(project.cwd),
            },
          ]
        : [];
    }),
  }));
}

const lastBoardGoals: LastGoodLists<BoardGoal> = new Map();

/** Each machine's goals. A machine that does not answer keeps its last
 * successful list, flagged stale; `down` machines are not asked. */
export function listBoardGoalResults(
  machines: readonly RemoteMachine[],
  down: readonly RemoteMachine[] = [],
): Promise<MachineResult<BoardGoal>[]> {
  return collectMachineResults(
    lastBoardGoals,
    machines,
    async (machine) => {
      const [goals, projects, capabilities] = await Promise.all([
        remoteRequest<HostGoal[]>(machine.id, "goals.list"),
        machineProjects(machine),
        machineCapabilities(machine),
      ]);
      return boardGoalsFromHost(machine, projects, goals).map((goal) => ({
        ...goal,
        settingsSupported: capabilities.includes("goals.settings"),
        finalReviewSupported: capabilities.includes(HOST_GOAL_FINAL_REVIEW),
      }));
    },
    (goal) => ({ ...goal, stale: true }),
    down,
  );
}

/** Every machine's goals, last-known ones included. */
export async function listBoardGoals(machines: readonly RemoteMachine[]): Promise<BoardGoal[]> {
  return (await listBoardGoalResults(machines)).flatMap((result) => result.data);
}

/** Creates the goal on the machine that has its projects; its planner starts
 * right away. */
export async function createGoal(
  machines: readonly RemoteMachine[],
  draft: GoalDraft,
): Promise<BoardGoal> {
  if (!draft.cwds.length) throw new Error("Choose at least one project.");
  if (draft.cwds.some((cwd) => !sameGoalMachine(draft.cwds[0], cwd)))
    throw new Error(GOAL_MACHINE_ERROR);
  const machine = taskMachineFor(machines, draft.cwds[0], draft.machineId);
  await requireTaskAccount(machine, draft.providerAccountId);
  await requireTaskHarnessCapabilities(machine, draft);
  if (draft.finalReview && !(await machineCapabilities(machine)).includes(HOST_GOAL_FINAL_REVIEW))
    throw new Error("Update the selected host to verify the completed goal.");
  if (draft.isolate === false && !(await machineCapabilities(machine)).includes(HOST_DIRECT_GOALS))
    throw new Error(
      "Update the selected host to run goal tasks directly in the selected checkout.",
    );
  await requireTaskContinuation(machine, draft.continueUntilDone);
  await requireTaskWorkspaces(
    machine,
    Boolean(draft.workspaces || draft.maxRunningTasks || draft.manualStart),
  );
  const projects = [];
  for (const cwd of draft.cwds) projects.push(await hostProjectFor(machine, cwd));
  const lead = projects[draft.cwds.indexOf(draft.leadCwd)] ?? projects[0];
  const created = await remoteRequest<HostGoal>(
    machine.id,
    "goals.create",
    {
      goal: hostGoalFromDraft(
        draft,
        crypto.randomUUID(),
        projects.map((project) => project.id),
        lead.id,
      ),
    },
    false,
    true,
  );
  return boardGoalsFromHost(machine, projects, [created])[0];
}

function goalRequest<T = unknown>(
  goal: BoardGoal,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return remoteRequest<T>(goal.machineId, method, { goalId: goal.id, ...params }, false, true);
}

/** Replace host-owned fields so a successful response can clear old errors,
 * plans or planner metadata while keeping this desktop's project bindings. */
async function updatedGoal(
  goal: BoardGoal,
  method: string,
  params: Record<string, unknown> = {},
): Promise<BoardGoal> {
  const updated = await goalRequest<HostGoal>(goal, method, params);
  return {
    ...updated,
    machineId: goal.machineId,
    machineName: goal.machineName,
    projects: goal.projects,
    settingsSupported: goal.settingsSupported,
    finalReviewSupported: goal.finalReviewSupported,
    stale: undefined,
  };
}

export function approveGoal(goal: BoardGoal): Promise<BoardGoal> {
  return updatedGoal(goal, "goals.approve");
}

export function recheckGoalFinalReview(goal: BoardGoal): Promise<BoardGoal> {
  return updatedGoal(goal, "goals.final-review.recheck", { expectedUpdatedAt: goal.updatedAt });
}

export function updateGoal(
  goal: BoardGoal,
  settings: import("./hostGoals").GoalSettings,
): Promise<BoardGoal> {
  return updatedGoal(goal, "goals.update", { settings, expectedUpdatedAt: goal.updatedAt });
}

export function replanGoal(goal: BoardGoal, feedback: string): Promise<BoardGoal> {
  return updatedGoal(goal, "goals.replan", feedback.trim() ? { feedback: feedback.trim() } : {});
}

export function cancelGoal(goal: BoardGoal): Promise<BoardGoal> {
  return updatedGoal(goal, "goals.cancel");
}

/** `withTasks` also deletes the goal's tasks, discarding unmerged branches. */
export function deleteGoal(goal: BoardGoal, withTasks = false): Promise<unknown> {
  return goalRequest(goal, "goals.delete", withTasks ? { withTasks: true } : {});
}

/** The key a goal and its tasks share on the board. */
export function goalKey(machineId: string, goalId: string): string {
  return `${machineId}:${goalId}`;
}
