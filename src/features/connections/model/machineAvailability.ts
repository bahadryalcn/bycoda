import { useSyncExternalStore } from "react";
import {
  knownRemoteMachine,
  remoteMachinesLoaded,
  subscribeRemoteMachineList,
} from "./connections";
import { isMachineEnabled, subscribeMachineSwitch } from "./machineEnabled";
import {
  announceRemoteRecovery,
  readRemoteConnection,
  remotePollDue as connectionPollDue,
  subscribeChanges,
} from "./remoteHealth";
import { parseRemotePath } from "./remoteProjects";

/** Why the machine behind a remote project cannot be asked anything right now. */
export type MachineUnavailableReason =
  /** This computer has no saved machine for the project's environment. */
  | "not-added"
  /** The machine refused this computer's pairing or its identity changed: pair again. */
  | "pairing-refused"
  /** SSH needs a password or a host-key decision, or native admission was blocked. */
  | "needs-sign-in"
  /** The machine or its Host did not answer; recovery runs in the background. */
  | "offline"
  /** The owner turned the machine off on this computer. */
  | "turned-off";

/** Whether views of a project may read from its machine. A local project, and a remote one
 * whose state is not known yet (`connecting`), may: the first read is how it becomes known. */
export type MachineAvailability =
  | { available: true; connecting: boolean }
  | { available: false; reason: MachineUnavailableReason };

const AVAILABLE: MachineAvailability = { available: true, connecting: false };
const CONNECTING: MachineAvailability = { available: true, connecting: true };
const UNAVAILABLE = Object.fromEntries(
  (["not-added", "pairing-refused", "needs-sign-in", "offline", "turned-off"] as const).map(
    (reason) => [reason, { available: false, reason }],
  ),
) as Record<MachineUnavailableReason, MachineAvailability>;

/** Environments last seen unavailable, so their views reload once they are available again. */
const blocked = new Set<string>();

/** One answer for every view, derived from the saved machine list, the machine switch and
 * the shared connection state. Returns one stable object per outcome. */
export function readMachineAvailability(cwd: string | undefined): MachineAvailability {
  const environmentId = cwd ? parseRemotePath(cwd)?.environmentId : undefined;
  if (!environmentId) return AVAILABLE;
  const result = availabilityOf(environmentId);
  if (!result.available && !blocked.has(environmentId)) {
    blocked.add(environmentId);
    watchBlocked();
  }
  return result;
}

/**
 * Whether a view of a project shows the shared notice instead of its content. `hasData` is
 * the view's own answer to "did I already load something for this project". An offline
 * machine is usually a brief drop or a Host restart, so a view with data keeps it (dimmed, with
 * its reconnect notice) and only an empty one shows the notice. A machine this computer
 * cannot ask at all (not added, pairing refused, sign-in, off) always shows it: what it
 * once answered must not keep looking current.
 */
export function machineHidesView(availability: MachineAvailability, hasData: boolean): boolean {
  if (availability.available) return false;
  return !(availability.reason === "offline" && hasData);
}

function availabilityOf(environmentId: string): MachineAvailability {
  if (remoteMachinesLoaded() && !knownRemoteMachine(environmentId)) return UNAVAILABLE["not-added"];
  if (!isMachineEnabled(environmentId)) return UNAVAILABLE["turned-off"];
  switch (readRemoteConnection(environmentId).status) {
    case "connected":
    case "outdated-host":
      return AVAILABLE;
    case "connecting":
      return CONNECTING;
    case "identity-mismatch":
      return UNAVAILABLE["pairing-refused"];
    case "needs-auth":
    case "host-key":
    case "connection-blocked":
      return UNAVAILABLE["needs-sign-in"];
    case "unreachable":
    case "host-not-running":
      return UNAVAILABLE.offline;
  }
}

/** Calls `listener` whenever any machine's availability may have changed. */
export function subscribeAvailability(listener: () => void): () => void {
  const stopHealth = subscribeChanges(listener);
  const stopList = subscribeRemoteMachineList(listener);
  const stopSwitch = subscribeMachineSwitch(listener);
  return () => {
    stopHealth();
    stopList();
    stopSwitch();
  };
}

/** `readMachineAvailability` for a component; re-renders only when the outcome changes. */
export function useMachineAvailability(cwd: string | undefined): MachineAvailability {
  const read = () => readMachineAvailability(cwd);
  // A local project is always available and needs no subscription.
  const remote = !!cwd && !!parseRemotePath(cwd);
  return useSyncExternalStore(remote ? subscribeAvailability : subscribeNothing, read, read);
}
const subscribeNothing = () => () => undefined;

/** Whether a background poll of this project should run now: never while its machine is
 * unavailable, and slowed while it was recently unreachable (see `remoteHealth`). */
export function remotePollDue(cwd: string): boolean {
  return readMachineAvailability(cwd).available && connectionPollDue(cwd);
}

/** A machine that became available again (added, paired, turned on, answering) lets every
 * view of it reload through the shared recovery event, as a reconnect does. */
function resumeAvailable() {
  for (const environmentId of Array.from(blocked)) {
    if (!availabilityOf(environmentId).available) continue;
    blocked.delete(environmentId);
    announceRemoteRecovery(environmentId);
  }
}
/** Started by the first unavailable machine, so importing this module has no side effect. */
let watching = false;
function watchBlocked() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  subscribeAvailability(resumeAvailable);
}

/** For tests. */
export function resetMachineAvailability(): void {
  blocked.clear();
}
