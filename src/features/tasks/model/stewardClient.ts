import { remoteRequest } from "../../connections/model/connections";
import { isLocalSyncMachine } from "../../connections/model/localSync";
import {
  isRemoteProvider,
  type HostProject,
  type RemoteMachine,
} from "../../connections/model/protocol";
import {
  backgroundMachineFor,
  backgroundMachines,
  hostProjectCwd,
  hostProjectFor,
} from "../../automations/model/hostAutomationClient";
import {
  collectMachineResults,
  type LastGoodLists,
  type MachineResult,
} from "../../automations/model/machineResults";
import { machineProjects } from "../../automations/model/machineSnapshot";
import type { AutomationScheduleKind } from "../../automations/model/automationSchedule";
import type { HarnessId, RuntimeMode } from "../../sessions/model/session";
import { projectName } from "../../../shared/lib/paths";
import {
  DEFAULT_MAX_OPEN,
  DEFAULT_MAX_PROPOSALS,
  HOST_STEWARDS,
  type HostSteward,
  type HostStewardInput,
  type StewardRunStatus,
} from "./hostStewards";
import { TASK_AGENT_ERROR, TASK_MACHINE_ERROR, type BoardTask } from "./taskClient";

/** A host steward as this desktop shows it: on its machine, for its project. */
export type BoardSteward = HostSteward & {
  machineId: string;
  machineName: string;
  /** How this desktop addresses the steward's project. */
  cwd: string;
  /** The machine did not answer; this is what it last reported. */
  stale?: boolean;
};

/** What the steward form edits. A draft with an ID edits that steward. */
export type StewardDraft = {
  id?: string;
  cwd: string;
  focus: string;
  scheduleKind: AutomationScheduleKind;
  minute: number;
  time: string;
  dayOfWeek: number;
  harness: HarnessId;
  model: string;
  modelSettings: Record<string, string>;
  runtimeMode: RuntimeMode;
  maxProposals: number;
  maxOpen: number;
  autoStart: boolean;
  /** Merge the tasks it creates once their checks pass. */
  autoMerge: boolean;
  enabled: boolean;
};

export const STEWARD_STATUS_LABELS: Record<StewardRunStatus, string> = {
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  skipped: "Skipped",
  cancelled: "Stopped",
};

/** Machines whose host runs stewards, this computer's included. */
export function stewardMachines(fresh = false): Promise<RemoteMachine[]> {
  return backgroundMachines(HOST_STEWARDS, fresh);
}

export function newStewardDraft(cwd: string, harness: HarnessId, model: string): StewardDraft {
  return {
    cwd,
    focus: "",
    scheduleKind: "daily",
    minute: 0,
    time: "09:00",
    dayOfWeek: 1,
    harness,
    model,
    modelSettings: {},
    runtimeMode: "auto",
    maxProposals: DEFAULT_MAX_PROPOSALS,
    maxOpen: DEFAULT_MAX_OPEN,
    autoStart: false,
    autoMerge: false,
    enabled: true,
  };
}

export function draftFromSteward(steward: BoardSteward): StewardDraft {
  return {
    id: steward.id,
    cwd: steward.cwd,
    focus: steward.focus,
    scheduleKind: steward.scheduleKind,
    minute: steward.minute,
    time: steward.time,
    dayOfWeek: steward.dayOfWeek,
    harness: steward.harness,
    model: steward.model,
    modelSettings: steward.modelSettings,
    runtimeMode: steward.runtimeMode,
    maxProposals: steward.maxProposals,
    maxOpen: steward.maxOpen,
    autoStart: steward.autoStart,
    autoMerge: steward.autoMerge === true,
    enabled: steward.enabled,
  };
}

/** What the host stores for a draft. Throws when the draft's agent cannot run
 * on a host. */
export function hostStewardFromDraft(
  draft: StewardDraft,
  id: string,
  projectId: string,
): HostStewardInput {
  if (!isRemoteProvider(draft.harness)) throw new Error(TASK_AGENT_ERROR);
  return {
    id,
    projectId,
    enabled: draft.enabled,
    harness: draft.harness,
    model: draft.model,
    modelSettings: draft.modelSettings,
    runtimeMode: draft.runtimeMode,
    scheduleKind: draft.scheduleKind,
    minute: draft.minute,
    time: draft.time,
    dayOfWeek: draft.dayOfWeek,
    focus: draft.focus.trim(),
    maxProposals: draft.maxProposals,
    maxOpen: draft.maxOpen,
    autoStart: draft.autoStart,
    ...(draft.autoMerge ? { autoMerge: true } : {}),
  };
}

/** One machine's stewards on the board. A steward whose project the host no
 * longer has is left out. */
export function boardStewardsFromHost(
  machine: RemoteMachine,
  projects: readonly HostProject[],
  stewards: readonly HostSteward[],
): BoardSteward[] {
  return stewards.flatMap((steward) => {
    const project = projects.find((entry) => entry.id === steward.projectId);
    return project
      ? [
          {
            ...steward,
            machineId: machine.id,
            machineName: isLocalSyncMachine(machine) ? "this computer" : machine.name,
            cwd: hostProjectCwd(machine, project),
          },
        ]
      : [];
  });
}

/** The steward's project as the desktop names it. */
export function stewardProjectName(steward: Pick<BoardSteward, "cwd">): string {
  return projectName(steward.cwd);
}

/** A task the owner may decline: a to-do suggestion a steward made. */
export function isStewardProposal(task: Pick<BoardTask, "source" | "status">): boolean {
  return task.source === "steward" && task.status === "todo";
}

const lastBoardStewards: LastGoodLists<BoardSteward> = new Map();

/** Each machine's stewards. A machine that does not answer keeps its last
 * successful list, flagged stale; `down` machines are not asked. */
export function listBoardStewardResults(
  machines: readonly RemoteMachine[],
  down: readonly RemoteMachine[] = [],
): Promise<MachineResult<BoardSteward>[]> {
  return collectMachineResults(
    lastBoardStewards,
    machines,
    async (machine) => {
      const [stewards, projects] = await Promise.all([
        remoteRequest<HostSteward[]>(machine.id, "stewards.list"),
        machineProjects(machine),
      ]);
      return boardStewardsFromHost(machine, projects, stewards);
    },
    (steward) => ({ ...steward, stale: true }),
    down,
  );
}

/** Saves the draft on the machine that owns its project. */
export async function saveSteward(
  machines: readonly RemoteMachine[],
  draft: StewardDraft,
): Promise<BoardSteward> {
  const machine = backgroundMachineFor(machines, draft.cwd);
  if (!machine) throw new Error(TASK_MACHINE_ERROR);
  const project = await hostProjectFor(machine, draft.cwd);
  const saved = await remoteRequest<HostSteward>(
    machine.id,
    "stewards.save",
    {
      steward: hostStewardFromDraft(draft, draft.id ?? crypto.randomUUID(), project.id),
    },
    false,
    true,
  );
  return boardStewardsFromHost(machine, [project], [saved])[0];
}

function stewardRequest<T = unknown>(steward: BoardSteward, method: string): Promise<T> {
  return remoteRequest<T>(steward.machineId, method, { stewardId: steward.id }, false, true);
}

/** Keep desktop bindings while replacing host fields, including optional run
 * metadata or errors that disappeared from the authoritative response. */
function updatedSteward(steward: BoardSteward, updated: HostSteward): BoardSteward {
  return {
    ...updated,
    machineId: steward.machineId,
    machineName: steward.machineName,
    cwd: steward.cwd,
    stale: undefined,
  };
}

export async function setStewardEnabled(
  steward: BoardSteward,
  enabled: boolean,
): Promise<BoardSteward> {
  const updated = await remoteRequest<HostSteward>(
    steward.machineId,
    "stewards.save",
    {
      steward: hostStewardFromDraft(
        { ...draftFromSteward(steward), enabled },
        steward.id,
        steward.projectId,
      ),
    },
    false,
    true,
  );
  return updatedSteward(steward, updated);
}

export async function runStewardNow(steward: BoardSteward): Promise<BoardSteward> {
  return updatedSteward(steward, await stewardRequest<HostSteward>(steward, "stewards.runNow"));
}

export function deleteSteward(steward: BoardSteward): Promise<unknown> {
  return stewardRequest(steward, "stewards.delete");
}

/** Declines a steward's to-do suggestion: the host deletes it and the steward
 * does not propose it again. */
export function declineProposal(task: BoardTask): Promise<unknown> {
  return remoteRequest(task.machineId, "stewards.decline", { taskId: task.id }, false, true);
}
