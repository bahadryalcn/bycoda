import type { ModelRoutingItemChoice } from "../../../shared/model/host-contracts/model-routing";
import { defaultModelSettings, resolveModel } from "../../sessions/public/models";
import { classifyCommandFailure, remoteRequest } from "../../connections/public/connections";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import {
  isRemoteProvider,
  type HostProject,
  type RemoteMachine,
} from "../../connections/public/protocol";

import { parseRemotePath } from "../../connections/public/remoteProjects";
import {
  backgroundMachines,
  hostProjectCwd,
  hostProjectFor,
  machineCapabilities,
  machineProjects,
} from "../../automations/public/hostMachines";
import {
  collectMachineResults,
  type LastGoodLists,
  type MachineResult,
} from "../../automations/model/machineResults";
import { sharedMachineListReads } from "../../automations/model/machineListReads";
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
import { taskClientErrors } from "./taskClientErrors";
import {
  requireTaskContinuation,
  requireTaskAccount,
  requireTaskWorkspaces,
  taskMachineFor,
  requireTaskHarnessCapabilities,
} from "./taskClient";
import type { TaskWorkspace } from "./taskWorkspace";
import type { TaskRunBudget } from "./taskBudget";

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
  pendingRefresh?: boolean;
  settingsSupported?: boolean;
};

/** What the goal form edits. */
export type GoalDraft = {
  /** Shared by form copies so edits cannot lose an unresolved create receipt. */
  creation?: {
    id: string;
    pending?: {
      machine: RemoteMachine;
      projects: HostProject[];
      input: HostGoalInput;
      fingerprint: string;
    };
    busy?: boolean;
  };
  crewDefinitionId?: string;
  finalReview?: boolean;
  budget?: TaskRunBudget;
  isolate?: boolean;
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
  modelChoice?: ModelRoutingItemChoice;
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

export function newGoalDraft(
  cwd: string,
  harness: HarnessId,
  model: string,
  routingSupported = false,
): GoalDraft {
  return {
    creation: { id: crypto.randomUUID() },
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
    ...(routingSupported ? { modelChoice: { kind: "default" as const } } : {}),
    modelSettings: defaultModelSettings(resolveModel(harness, model)),
    runtimeMode: "auto",
    maxRunMinutes: 0,
    approvePlan: false,

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
  if (!isRemoteProvider(draft.harness)) throw new Error(taskClientErrors.agent());
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
    ...(draft.modelChoice ? { modelChoice: draft.modelChoice } : {}),
    model: draft.model,
    modelSettings: draft.modelSettings,
    runtimeMode: draft.runtimeMode,
    ...(draft.crewDefinitionId ? { crewDefinitionId: draft.crewDefinitionId } : {}),
    maxRunMinutes: draft.maxRunMinutes,
    ...(typeof draft.isolate === "boolean" ? { isolate: draft.isolate } : {}),
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
const boardGoalReads = sharedMachineListReads<BoardGoal>();

/** Keeps a machine's last-known goals in step with a mutation its host
 * acknowledged, so a later failed read cannot show the earlier state again. */
export function rememberBoardGoal(goal: BoardGoal, removed = false): void {
  const known = lastBoardGoals.get(goal.machineId);
  if (!known) return;
  const others = known.filter((entry) => entry.id !== goal.id);
  lastBoardGoals.set(goal.machineId, removed ? others : [...others, goal]);
}

/** Each machine's goals. A machine that does not answer keeps its last
 * successful list, flagged stale; `down` machines are not asked. */
export function listBoardGoalResults(
  machines: readonly RemoteMachine[],
  down: readonly RemoteMachine[] = [],
): Promise<MachineResult<BoardGoal>[]> {
  return collectMachineResults(
    lastBoardGoals,
    machines,
    // The board, the daily summary and the background notifier share one request per machine.
    (machine) => boardGoalReads.read(machine, readBoardGoals),
    (goal) => ({ ...goal, stale: true }),
    down,
  );
}

async function readBoardGoals(machine: RemoteMachine): Promise<BoardGoal[]> {
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
}

/** Sends a goal write and drops the shared reads of its machine, even when the outcome
 * is unknown, so no later reader joins a list read that began before the write. */
async function writeGoal<T>(machineId: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } finally {
    boardGoalReads.invalidate(machineId);
  }
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
  const creation = (draft.creation ??= { id: crypto.randomUUID() });
  if (creation.busy) throw new Error(taskClientErrors.epicChecking());
  creation.busy = true;
  // Freeze form values before any asynchronous capability or project lookup.
  const snapshot = structuredClone({ ...draft, creation: undefined });
  const fingerprint = JSON.stringify(snapshot);
  let firstDispatch = false;
  try {
    if (creation.pending) {
      const pending = creation.pending;
      const original = machines.find(
        (machine) =>
          machine.id === pending.machine.id &&
          machine.environmentId === pending.machine.environmentId,
      );
      if (!original) throw new Error(taskClientErrors.epicReconnect());
      const goals = await remoteRequest<HostGoal[]>(original.id, "goals.list");
      if (!Array.isArray(goals)) throw new Error(taskClientErrors.epicUnchecked());
      const recovered = goals.find((goal) => goal.id === creation.id);
      if (recovered) {
        if (JSON.stringify(recovered.projectIds) !== JSON.stringify(pending.input.projectIds))
          throw new Error(taskClientErrors.epicScope());
        return boardGoalsFromHost(pending.machine, pending.projects, [recovered])[0];
      }
      // Absence cannot settle an in-flight server request. Keep its identity and
      // payload; expectedAbsent makes a retry race safe on the Host.
      if (fingerprint !== pending.fingerprint) throw new Error(taskClientErrors.epicUnresolved());
      const created = await writeGoal(original.id, () =>
        remoteRequest<HostGoal>(
          original.id,
          "goals.create",
          { goal: { ...pending.input, expectedAbsent: true } },
          false,
          true,
        ),
      );
      if (!created || created.id !== creation.id)
        throw new Error(taskClientErrors.epicAcknowledgement());
      return boardGoalsFromHost(pending.machine, pending.projects, [created])[0];
    }
    draft = snapshot;
    if (!draft.cwds.length) throw new Error(taskClientErrors.chooseProject());
    if (draft.cwds.some((cwd) => !sameGoalMachine(draft.cwds[0], cwd)))
      throw new Error(taskClientErrors.goalMachine());
    const machine = taskMachineFor(machines, draft.cwds[0], draft.machineId);
    await requireTaskAccount(machine, draft.providerAccountId);
    await requireTaskHarnessCapabilities(machine, draft);
    if (draft.finalReview && !(await machineCapabilities(machine)).includes(HOST_GOAL_FINAL_REVIEW))
      throw new Error(taskClientErrors.goalVerifyHost());
    if (
      draft.isolate === false &&
      !(await machineCapabilities(machine)).includes(HOST_DIRECT_GOALS)
    )
      throw new Error(taskClientErrors.goalDirectHost());
    await requireTaskContinuation(machine, draft.continueUntilDone);
    await requireTaskWorkspaces(
      machine,
      Boolean(draft.workspaces || draft.maxRunningTasks || draft.manualStart),
    );
    const projects = [];
    for (const cwd of draft.cwds) projects.push(await hostProjectFor(machine, cwd));
    const lead = projects[draft.cwds.indexOf(draft.leadCwd)] ?? projects[0];
    const input = hostGoalFromDraft(
      draft,
      creation.id,
      projects.map((project) => project.id),
      lead.id,
    );
    creation.pending = {
      machine: structuredClone(machine),
      projects,
      input: structuredClone(input),
      fingerprint,
    };
    firstDispatch = true;
    const created = await writeGoal(machine.id, () =>
      remoteRequest<HostGoal>(
        machine.id,
        "goals.create",
        {
          goal: { ...input, expectedAbsent: true },
        },
        false,
        true,
      ),
    );
    if (!created || created.id !== creation.id)
      throw new Error(taskClientErrors.epicAcknowledgement());
    return boardGoalsFromHost(machine, projects, [created])[0];
  } catch (error) {
    // A definite pre-dispatch refusal permits edits; unknown failures retain
    // the original Host and payload until a read recovers the accepted goal.
    if (firstDispatch && classifyCommandFailure(error) !== "uncertain")
      creation.pending = undefined;
    throw error;
  } finally {
    creation.busy = false;
  }
}

function goalRequest<T = unknown>(
  goal: BoardGoal,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return writeGoal(goal.machineId, () =>
    remoteRequest<T>(goal.machineId, method, { goalId: goal.id, ...params }, false, true),
  );
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
