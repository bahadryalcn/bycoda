import { remoteRequest } from "../../connections/public/connections";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { RemoteMachine } from "../../connections";
import { invoke } from "@tauri-apps/api/core";
import { backgroundMachines } from "../../automations/model/hostAutomationClient";
import { machineCapabilities } from "../../automations/public/hostMachines";
import {
  HOST_SETTINGS,
  parseHostSettingsState,
  type HostSettings,
  type HostSettingsState,
} from "./hostSettings";

/** One machine's work limits and today's usage, as this desktop shows them. */
export type MachineLimits = HostSettingsState & {
  machineId: string;
  machineName: string;
  stale?: boolean;
  pendingRefresh?: boolean;
};

/** Machines whose host keeps work limits, this computer's included. Older
 * hosts are not among them. */
export function settingsMachines(fresh = false): Promise<RemoteMachine[]> {
  return backgroundMachines(HOST_SETTINGS, fresh);
}

/** One machine whose host keeps work limits, asked alone so an unreachable
 * other machine never delays it; undefined when it is unknown or older. */
export async function settingsMachine(machineId: string): Promise<RemoteMachine | undefined> {
  const machines = await invoke<RemoteMachine[]>("remote_machines");
  const machine = machines?.find((candidate) => candidate.id === machineId);
  if (!machine) return undefined;
  return (await machineCapabilities(machine)).includes(HOST_SETTINGS) ? machine : undefined;
}

function machineLimits(machine: RemoteMachine, state: HostSettingsState): MachineLimits {
  return {
    ...state,
    machineId: machine.id,
    machineName: isLocalSyncMachine(machine) ? "this computer" : machine.name,
  };
}

/** A failed read rejects so the query can retain its last answer as stale. */
export async function listMachineLimits(
  machines: readonly RemoteMachine[],
): Promise<MachineLimits[]> {
  const results = await Promise.all(
    machines.map(async (machine) => {
      const state = parseHostSettingsState(
        await remoteRequest<unknown>(machine.id, "host.settings.get"),
      );
      if (!state) throw new Error("The machine sent settings this app cannot read.");
      return [machineLimits(machine, state)];
    }),
  );
  return results.flat();
}

/** Saves the fields given on the machine; returns its limits as they are now. */
export async function saveMachineLimits(
  machine: RemoteMachine,
  settings: Partial<HostSettings>,
): Promise<MachineLimits> {
  const state = parseHostSettingsState(
    await remoteRequest<unknown>(machine.id, "host.settings.save", { settings }, false, true),
  );
  if (!state) throw new Error("The machine sent settings this app cannot read.");
  return machineLimits(machine, state);
}

/** The board's notice for machines whose daily agent time is used up, or null. */
export function dailyLimitNotice(
  limits: readonly (Pick<MachineLimits, "machineName" | "limitReached"> &
    Pick<Partial<MachineLimits>, "usageUncertain">)[],
): string | null {
  const notices = limits
    .filter((entry) => entry.limitReached)
    .map((entry) =>
      entry.usageUncertain
        ? `Daily agent time on ${entry.machineName} is incomplete; queued work waits until tomorrow.`
        : `Daily agent time on ${entry.machineName} is used up; queued work resumes tomorrow.`,
    );
  return notices.length ? notices.join(" ") : null;
}
