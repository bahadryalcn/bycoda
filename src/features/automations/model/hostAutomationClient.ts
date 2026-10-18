import { invoke } from "@tauri-apps/api/core";
import { remoteRequest } from "../../connections/model/connections";
import { isLocalSyncMachine } from "../../connections/model/localSync";
import {
  isRemoteProvider,
  type HostProject,
  type RemoteMachine,
} from "../../connections/model/protocol";
import { parseRemotePath, remotePath } from "../../connections/model/remoteProjects";
import { pathKey } from "../../../shared/lib/paths";
import type { AutomationSchedule } from "./automationSchedule";
import { collectMachineResults, type LastGoodLists, type MachineResult } from "./machineResults";
import { invalidateMachineSnapshot, machineCapabilities, machineProjects } from "./machineSnapshot";
import {
  createAutomationTrigger,
  type Automation,
  type AutomationDraft,
  type AutomationRun,
} from "./automations";
import {
  HOST_AUTOMATIONS,
  type HostAutomation,
  type HostAutomationInput,
  type HostAutomationRun,
} from "./hostAutomations";

export const BACKGROUND_TRIGGER_ERROR =
  "A background automation runs on one schedule. Remove the other triggers.";
export const BACKGROUND_MACHINE_ERROR =
  "This project’s machine isn’t connected, or its bycoda Host needs an update.";

export type HostSchedulePreview = { timeZone: string; nextRunAt: number };

export async function previewHostAutomation(machineId: string, schedule: AutomationSchedule) {
  const preview = await remoteRequest<HostSchedulePreview>(machineId, "automations.preview", {
    schedule,
  });
  if (!preview || typeof preview.timeZone !== "string" || !Number.isFinite(preview.nextRunAt))
    throw new Error("Host schedule preview unavailable");
  // Validate the host's IANA zone before the render path formats its instant.
  new Intl.DateTimeFormat(undefined, { timeZone: preview.timeZone }).format(preview.nextRunAt);
  return preview;
}

/** Machines whose host does background work on its own, this computer's
 * included. `capability` is what the host must advertise: automations unless
 * another kind of background work is asked for. */
/** What each saved machine answered: whether its host does this kind of
 * background work, is too old for it, or could not be reached. Names use
 * "this computer" for the local host. */
export type MachineReach = {
  capable: RemoteMachine[];
  outdated: string[];
  unreachable: string[];
  /** The machines behind `unreachable`, for keeping their last-known cards. */
  unreachableMachines: RemoteMachine[];
  /** Actual probe failures, retained for the board retry notice. */
  unreachableErrors?: Record<string, string>;
};

export async function probeMachines(
  capability: string = HOST_AUTOMATIONS,
  fresh = false,
): Promise<MachineReach> {
  const machines = await invoke<RemoteMachine[]>("remote_machines");
  const reach: MachineReach = {
    capable: [],
    outdated: [],
    unreachable: [],
    unreachableMachines: [],
    unreachableErrors: {},
  };
  const answers = await Promise.all(
    (Array.isArray(machines) ? machines : []).map(async (machine) => {
      try {
        // Shared with every other board and notification round in flight.
        const advertised = await machineCapabilities(machine, fresh);
        return { machine, capable: advertised.includes(capability) };
      } catch (error) {
        return {
          machine,
          capable: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  for (const { machine, capable, error } of answers) {
    const name = isLocalSyncMachine(machine) ? "this computer" : machine.name;
    if (capable) reach.capable.push(machine);
    else if (capable === false) reach.outdated.push(name);
    else {
      reach.unreachable.push(name);
      reach.unreachableMachines.push(machine);
      reach.unreachableErrors![machine.id] = error ?? "The machine is not reachable.";
    }
  }
  return reach;
}

export async function backgroundMachines(
  capability: string = HOST_AUTOMATIONS,
  fresh = false,
): Promise<RemoteMachine[]> {
  return (await probeMachines(capability, fresh)).capable;
}

/** The machine that would run a background automation for the project at
 * `cwd`: the project's own machine, or this computer's host for a local one. */
export function backgroundMachineFor(
  machines: readonly RemoteMachine[],
  cwd: string,
): RemoteMachine | undefined {
  const remote = parseRemotePath(cwd);
  return remote
    ? machines.find((machine) => machine.environmentId === remote.environmentId)
    : machines.find(isLocalSyncMachine);
}

/** How this desktop addresses a host project: a plain path when the host is
 * this computer, a `remote://` path otherwise. */
export function hostProjectCwd(machine: RemoteMachine, project: HostProject): string {
  return isLocalSyncMachine(machine) ? project.cwd : remotePath(machine.environmentId, project.cwd);
}

/** The host's record of the project at `cwd`, registered there if it is new
 * to that host. */
export async function hostProjectFor(machine: RemoteMachine, cwd: string): Promise<HostProject> {
  const hostPath = parseRemotePath(cwd)?.hostPath ?? cwd;
  const projects = await machineProjects(machine);
  const known = projects.find((entry) => pathKey(entry.cwd) === pathKey(hostPath));
  if (known) return known;
  const opened = await remoteRequest<HostProject>(machine.id, "projects.open", {
    cwd: hostPath,
  });
  invalidateMachineSnapshot(machine.id);
  return opened;
}

export function automationFromHost(
  machine: RemoteMachine,
  cwd: string,
  host: HostAutomation,
): Automation {
  return {
    id: host.id,
    name: host.name,
    prompt: host.prompt,
    harness: host.harness,
    model: host.model,
    modelSettings: host.modelSettings,
    cwd,
    workspaceMode: "current",
    reuseSession: false,
    runtimeMode: host.runtimeMode,
    triggerKind: "time",
    triggerEvent: "",
    scheduleKind: host.scheduleKind,
    minute: host.minute,
    time: host.time,
    dayOfWeek: host.dayOfWeek,
    triggers: [
      createAutomationTrigger("time", host.scheduleKind, {
        id: `${host.id}:time`,
        scheduleKind: host.scheduleKind,
        minute: host.minute,
        time: host.time,
        dayOfWeek: host.dayOfWeek,
      }),
    ],
    missedRunGraceMinutes: 720,
    maxRunMinutes: host.maxRunMinutes,
    maxRunsPerDay: host.maxRunsPerDay,
    enabled: host.enabled,
    nextRunAt: host.nextRunAt,
    lastRunAt: host.lastRunAt,
    lastRunStatus: host.lastRunStatus,
    lastRunError: host.lastRunError,
    lastSessionId: host.lastSessionId,
    createdAt: host.createdAt,
    updatedAt: host.updatedAt,
    host: {
      machineId: machine.id,
      machineName: isLocalSyncMachine(machine) ? "this computer" : machine.name,
      projectId: host.projectId,
      ...(host.needsInput ? { needsInput: true } : {}),
    },
  };
}

/** What the host stores for a draft. Throws when the draft uses something a
 * background automation cannot do. */
export function hostAutomationFromDraft(
  draft: AutomationDraft,
  id: string,
  projectId: string,
): HostAutomationInput {
  const [trigger, ...others] = draft.triggers;
  if (!trigger || trigger.kind !== "time" || others.length > 0)
    throw new Error(BACKGROUND_TRIGGER_ERROR);
  if (!isRemoteProvider(draft.harness)) throw new Error("This agent cannot run in the background.");
  return {
    id,
    name: draft.name,
    prompt: draft.prompt,
    projectId,
    harness: draft.harness,
    model: draft.model,
    modelSettings: draft.modelSettings,
    runtimeMode: draft.runtimeMode,
    scheduleKind: trigger.scheduleKind,
    minute: trigger.minute,
    time: trigger.time,
    dayOfWeek: trigger.dayOfWeek,
    maxRunMinutes: draft.maxRunMinutes,
    maxRunsPerDay: draft.maxRunsPerDay,
    enabled: draft.enabled,
  };
}

const lastHostAutomations: LastGoodLists<Automation> = new Map();

/** Each machine's background automations. A machine that does not answer keeps
 * its last successful list, flagged stale; `down` machines are not asked. */
export function listHostAutomationResults(
  machines: readonly RemoteMachine[],
  down: readonly RemoteMachine[] = [],
): Promise<MachineResult<Automation>[]> {
  return collectMachineResults(
    lastHostAutomations,
    machines,
    async (machine) => {
      const [automations, projects] = await Promise.all([
        remoteRequest<HostAutomation[]>(machine.id, "automations.list"),
        machineProjects(machine),
      ]);
      return automations.flatMap((automation) => {
        const project = projects.find((entry) => entry.id === automation.projectId);
        return project
          ? [automationFromHost(machine, hostProjectCwd(machine, project), automation)]
          : [];
      });
    },
    (automation) =>
      automation.host ? { ...automation, host: { ...automation.host, stale: true } } : automation,
    down,
  );
}

/** Every machine's background automations, last-known ones included. */
export async function listHostAutomations(
  machines: readonly RemoteMachine[],
): Promise<Automation[]> {
  return (await listHostAutomationResults(machines)).flatMap((result) => result.data);
}

export async function saveHostAutomation(
  machines: readonly RemoteMachine[],
  draft: AutomationDraft,
): Promise<Automation> {
  const machine = backgroundMachineFor(machines, draft.cwd);
  if (!machine) throw new Error(BACKGROUND_MACHINE_ERROR);
  const project = await hostProjectFor(machine, draft.cwd);
  const saved = await remoteRequest<HostAutomation>(
    machine.id,
    "automations.save",
    {
      automation: hostAutomationFromDraft(draft, draft.id ?? crypto.randomUUID(), project.id),
    },
    false,
    true,
  );
  return automationFromHost(machine, hostProjectCwd(machine, project), saved);
}

export async function deleteHostAutomation(automation: Automation): Promise<void> {
  if (!automation.host) return;
  await remoteRequest(
    automation.host.machineId,
    "automations.delete",
    { automationId: automation.id },
    false,
    true,
  );
}

export function listHostAutomationRuns(automation: Automation): Promise<AutomationRun[]> {
  if (!automation.host) return Promise.resolve([]);
  return remoteRequest<HostAutomationRun[]>(automation.host.machineId, "automations.runs", {
    automationId: automation.id,
  });
}

export async function runHostAutomationNow(automation: Automation): Promise<void> {
  if (!automation.host) return;
  await remoteRequest(
    automation.host.machineId,
    "automations.runNow",
    { automationId: automation.id },
    false,
    true,
  );
}
