import { invoke } from "@tauri-apps/api/core";
import { t } from "../../../shared/i18n";
import { machineCapabilities } from "../../automations/public/hostMachines";
import { isMachineEnabled } from "./machineEnabled";
import { isLocalSyncMachine } from "./localSync";
import type { RemoteMachine } from "./protocol";
import { presentRemoteError } from "./remoteFailure";
import { localizeConnectionReason, type RemoteConnectionState } from "./remoteConnection";
import { readRemoteConnection, recordRemoteConnection } from "./remoteHealth";

/** Every Host Settings can offer: this computer's, plus the saved machines that are turned on. */
export type SettingsHosts = {
  /** This computer's Host. Its link can still be revoked; requests then fail until the owner reconnects. */
  local?: RemoteMachine;
  /** Why this computer's Host is not available. */
  localError?: string;
  /** Other saved machines that are turned on, whether or not they answer right now. */
  remotes: RemoteMachine[];
};

/** The saved machines that are turned on, other than this computer's own link. */
export function enabledRemotes(
  machines: readonly RemoteMachine[],
  enabled: (environmentId: string) => boolean = isMachineEnabled,
): RemoteMachine[] {
  return machines.filter(
    (machine) => !isLocalSyncMachine(machine) && enabled(machine.environmentId),
  );
}

/**
 * Reads the inventory only. It never asks a machine anything, so one slow or failing machine
 * cannot delay the list; `probeSettingsHost` learns each machine's state afterwards.
 */
export async function loadSettingsHosts(): Promise<SettingsHosts> {
  const [local, saved] = await Promise.allSettled([
    invoke<RemoteMachine | null>("local_host_connect"),
    invoke<RemoteMachine[]>("remote_machines"),
  ]);
  const hosts: SettingsHosts = {
    remotes: enabledRemotes(
      saved.status === "fulfilled" && Array.isArray(saved.value) ? saved.value : [],
    ),
  };
  if (local.status === "fulfilled" && local.value) hosts.local = local.value;
  else
    hosts.localError =
      local.status === "rejected"
        ? presentRemoteError(local.reason, { explicit: true })
        : t("This computer's Host is not connected.");
  return hosts;
}

/**
 * Asks one machine for its capabilities (shared and cached with every other caller) so the live
 * connection store learns its state. Resolves true once the store knows the state; false when
 * the probe ended without teaching it anything (a lone timeout). Never rejects.
 */
export async function probeSettingsHost(machine: RemoteMachine): Promise<boolean> {
  try {
    await machineCapabilities(machine);
    recordRemoteConnection(machine.environmentId);
  } catch (error) {
    recordRemoteConnection(machine.environmentId, error);
  }
  return readRemoteConnection(machine.environmentId).status !== "connecting";
}

/** What a Settings page may do with a Host, from what this computer last learned about it. */
export type SettingsHostStatus =
  | "connected"
  /** Not known yet: its probe is still running. */
  | "checking"
  | "offline"
  /** The machine refused this computer's credential or its identity changed. */
  | "pair-again"
  | "update-needed";

export type SettingsHostEntry = {
  /** The machine's saved id; also the picker value. */
  id: string;
  /** Present for a machine in the inventory; this computer's has none while its Host is down. */
  machine?: RemoteMachine;
  isLocal: boolean;
  name: string;
  status: SettingsHostStatus;
  /** Why it is not connected, in words fit for the user. */
  reason?: string;
};

/** The id the picker uses for this computer while its Host has no machine record. */
export const LOCAL_SETTINGS_HOST_ID = "settings-host:this-computer";

/**
 * The status of one machine. `unanswered` marks a probe that ended without the store learning
 * anything, which reads as offline rather than as "checking" forever.
 */
export function settingsHostStatus(
  state: RemoteConnectionState,
  unanswered = false,
): { status: SettingsHostStatus; reason?: string } {
  switch (state.status) {
    case "connected":
      return { status: "connected" };
    case "connecting":
      return unanswered
        ? { status: "offline", reason: t("The machine did not answer.") }
        : { status: "checking" };
    case "outdated-host":
      return { status: "update-needed", reason: state.error };
    case "identity-mismatch":
      return { status: "pair-again", reason: state.error };
    default:
      return { status: "offline", reason: state.error };
  }
}

/**
 * This computer first, then every saved machine, each with its live state. `read` and
 * `unanswered` default to the connection store so a caller only passes what it renders from.
 */
export function settingsHostEntries(
  hosts: SettingsHosts,
  unanswered: ReadonlySet<string> = new Set(),
  read: (environmentId: string) => RemoteConnectionState = readRemoteConnection,
): SettingsHostEntry[] {
  const entry = (machine: RemoteMachine, isLocal: boolean): SettingsHostEntry => ({
    id: machine.id,
    machine,
    isLocal,
    name: isLocal ? t("This computer") : machine.name,
    ...settingsHostStatus(read(machine.environmentId), unanswered.has(machine.id)),
  });
  return [
    hosts.local
      ? entry(hosts.local, true)
      : {
          id: LOCAL_SETTINGS_HOST_ID,
          isLocal: true,
          name: t("This computer"),
          status: "offline" as const,
          reason: hosts.localError,
        },
    ...hosts.remotes.map((machine) => entry(machine, false)),
  ];
}

/**
 * The machine the choice names. `choice` undefined is this computer; a choice that is no longer
 * saved is `missing`, never replaced by another machine.
 */
export function chooseSettingsHost(
  entries: readonly SettingsHostEntry[],
  choice: string | undefined,
): { entry?: SettingsHostEntry; missing: boolean } {
  if (choice === undefined)
    return { entry: entries.find((entry) => entry.isLocal), missing: false };
  const entry = entries.find((candidate) => candidate.id === choice);
  return { entry, missing: !entry };
}

export type SettingsHostOption = {
  value: string;
  label: string;
  disabled?: boolean;
  /** The machine's live state; absent for a machine that was removed. */
  status?: SettingsHostStatus;
};

const STATUS_TAG: Record<SettingsHostStatus, () => string | undefined> = {
  connected: () => undefined,
  checking: () => t("Checking…"),
  offline: () => t("Offline"),
  "pair-again": () => t("Pair again"),
  "update-needed": () => t("Update needed"),
};

/** One option per entry; a machine that is not connected carries its state after its name. */
export function settingsHostOptions(entries: readonly SettingsHostEntry[]): SettingsHostOption[] {
  return entries.map((entry) => {
    const tag = STATUS_TAG[entry.status]();
    return {
      value: entry.id,
      label: tag ? `${entry.name} · ${tag}` : entry.name,
      status: entry.status,
    };
  });
}

/** The words for a Host that cannot be used right now, or undefined for a connected one. */
export function settingsHostUnavailableMessage(entry: SettingsHostEntry): string | undefined {
  switch (entry.status) {
    case "connected":
    case "checking":
      return undefined;
    case "pair-again":
      return entry.isLocal
        ? t("This computer's connection to its Host was revoked.")
        : t("{p0} no longer accepts this computer. Pair it again from Settings → Connections.", {
            p0: entry.name,
          });
    case "update-needed":
      return t("{p0} needs a Host update.", { p0: entry.name });
    case "offline":
      return [
        t("{p0} is offline.", { p0: entry.name }),
        entry.reason ? localizeConnectionReason(entry.reason) : undefined,
      ]
        .filter(Boolean)
        .join(" ");
  }
}
