import { userPresent } from "../../../shared/lib/userPresence";
import { remoteMachinesAdvertising, remoteRequest } from "./connections";
import { isMachineEnabled } from "./machineEnabled";
import { environmentForMachine } from "./remoteLifecycle";
import { readRemoteConnection } from "./remoteHealth";

export const OWNER_ACTIVE_CAPABILITY = "assistant.ownerActive";
/** Below the Host's two-minute device-activity window, so steady use never lapses. */
export const OWNER_ACTIVE_MS = 60_000;

type OwnerActivityDeps = {
  active: () => boolean;
  machines: () => { id: string }[];
  /** Whether a machine is connected and turned on here; only those are sent to, so a down or off one is never dialed. */
  reachable: (machine: { id: string }) => boolean;
  send: (machineId: string) => Promise<unknown>;
};

const defaults: OwnerActivityDeps = {
  active: () => userPresent(),
  machines: () => remoteMachinesAdvertising(OWNER_ACTIVE_CAPABILITY),
  reachable: ({ id }) => {
    const environmentId = environmentForMachine(id);
    return (
      environmentId !== undefined &&
      isMachineEnabled(environmentId) &&
      readRemoteConnection(environmentId).status === "connected"
    );
  },
  send: (machineId) => remoteRequest(machineId, "assistant.ownerActive", {}),
};

/**
 * While the owner uses this window, tells every other connected Host so its availability
 * reads Here instead of Away for a computer nobody is touching. Only Hosts that advertised
 * the capability in this session and are connected and on are told; a machine that is down
 * is skipped without a dial and is reported again on the next tick once it reconnects. A
 * failed report is dropped, the next one retries.
 */
export function reportOwnerActivity(deps: OwnerActivityDeps = defaults): void {
  if (!deps.active()) return;
  for (const machine of deps.machines()) {
    if (!deps.reachable(machine)) continue;
    deps.send(machine.id).catch(() => undefined);
  }
}

/** Starts the periodic report; returns the stop function. */
export function startOwnerActivityReports(deps: OwnerActivityDeps = defaults): () => void {
  const timer = setInterval(() => reportOwnerActivity(deps), OWNER_ACTIVE_MS);
  return () => clearInterval(timer);
}
