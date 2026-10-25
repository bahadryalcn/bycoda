import { invoke } from "@tauri-apps/api/core";
import {
  cachedRemoteCapabilities,
  loadRemoteCapabilities,
  remoteRequest,
} from "../../connections/model/connections";
import type { RemoteMachine } from "../../connections/model/protocol";
import { subscribeLockRecordChanges } from "../../group-lock/model/groupLock";
import { subscribeProjectPathsChanged } from "../../projects/model/recents";
import { isLocalSyncMachine } from "../../connections/model/localSync";
import {
  isApplyingRemote,
  recordSyncStatus,
  startSyncLoop,
  SYNC_UNSUPPORTED_MESSAGE,
} from "./syncClient";
import { setLocalHostEnvironmentId } from "./syncProjects";
import { createSyncWindowOwner } from "./syncWindowOwner";
import { setRemoteOpenTargets } from "./syncRemoteProjects";
import {
  readRemoteConnection,
  subscribeRemoteRecovered,
} from "../../connections/model/remoteHealth";

export function collectSyncMachineIds(machines: readonly RemoteMachine[]): string[] {
  return machines.map((machine) => machine.id);
}

/** Older hosts don't know the sync methods and would answer "Unsupported host method". */
export function machineSupportsSync(capabilities: string[] | undefined): boolean {
  return !!capabilities?.includes("sync");
}

export { SYNC_UNSUPPORTED_MESSAGE };

/** Records why a machine is skipped, so the UI can say so instead of showing nothing. */
export function recordCapabilityStatus(
  machineId: string,
  capabilities: string[] | undefined,
): void {
  if (capabilities === undefined) {
    recordSyncStatus(machineId, {
      state: "unlinked",
      lastError: "Could not read the host's capabilities",
    });
  } else if (!machineSupportsSync(capabilities)) {
    recordSyncStatus(machineId, { state: "unsupported", lastError: SYNC_UNSUPPORTED_MESSAGE });
  }
}

export const UNSUPPORTED_RECHECK_MS = 5 * 60_000;
export const NUDGE_DEBOUNCE_MS = 500;

/** Whether a machine's capabilities must be (re)loaded: never seen, or
 * advertised without "sync" and not checked in the last few minutes. */
export function shouldLoadCapabilities(
  capabilities: string[] | undefined,
  lastCheckedAt: number | undefined,
  now: number,
): boolean {
  if (capabilities === undefined) return true;
  if (machineSupportsSync(capabilities)) return false;
  return lastCheckedAt === undefined || now - lastCheckedAt >= UNSUPPORTED_RECHECK_MS;
}

/** Trailing-edge debounce; `cancel` drops a pending call. */
export function createDebouncer(run: () => void, delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    trigger() {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        run();
      }, delayMs);
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

/** Forwards a library change event unless sync itself caused it: applying
 * host records (or capturing) rewrites local storage, and nudging on that
 * echo would start a new cycle after every cycle. */
export function createLocalChangeHandler(nudge: () => void): () => void {
  return () => {
    if (!isApplyingRemote()) nudge();
  };
}

/** Splits the saved machines into this desktop's own host (the one serving
 * its filesystem) and the machines another desktop's projects can be opened on. */
export function syncMachineRoles(machines: readonly RemoteMachine[]): {
  hostEnvironmentId?: string;
  openable: RemoteMachine[];
} {
  const hostEnvironmentId = machines.find(isLocalSyncMachine)?.environmentId;
  const seen = new Set<string>();
  const openable = machines.filter((machine) => {
    if (isLocalSyncMachine(machine) || machine.environmentId === hostEnvironmentId) return false;
    if (seen.has(machine.environmentId)) return false;
    seen.add(machine.environmentId);
    return true;
  });
  return { ...(hostEnvironmentId ? { hostEnvironmentId } : {}), openable };
}

function applyMachineRoles(machines: readonly RemoteMachine[]): void {
  const { hostEnvironmentId, openable } = syncMachineRoles(machines);
  if (hostEnvironmentId) setLocalHostEnvironmentId(hostEnvironmentId);
  setRemoteOpenTargets(
    openable.map((machine) => ({
      environmentId: machine.environmentId,
      name: machine.name,
      request: (method, params, userInitiated) =>
        remoteRequest(machine.id, method, params, false, userInitiated),
    })),
  );
}

const lastCapabilityCheck = new Map<string, number>();

async function syncCapableMachines(machines: readonly RemoteMachine[]): Promise<RemoteMachine[]> {
  const checked = await Promise.all(
    machines.map(async (machine) => {
      let capabilities = cachedRemoteCapabilities(machine.environmentId);
      const now = Date.now();
      if (shouldLoadCapabilities(capabilities, lastCapabilityCheck.get(machine.id), now)) {
        lastCapabilityCheck.set(machine.id, now);
        capabilities =
          (await loadRemoteCapabilities(machine.environmentId).catch(() => undefined)) ??
          capabilities;
      }
      recordCapabilityStatus(machine.id, capabilities);
      return machineSupportsSync(capabilities) ? machine : undefined;
    }),
  );
  return checked.filter((machine): machine is RemoteMachine => !!machine);
}

let started = false;

/**
 * Starts this desktop's side of project/group sync: links to a Bycoda
 * Host running on this same machine when there is one (a no-op most of the
 * time), then runs the sync loop against every saved machine whose host
 * advertises the "sync" capability. Safe to call more than once; only the
 * first call does anything.
 */
export function startAppSync(): () => void {
  if (started) return () => {};
  started = true;
  let machines: readonly RemoteMachine[] = [];
  let stopped = false;
  let refreshing: Promise<void> | undefined;
  const refreshMachines = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (refreshing) return refreshing;
    refreshing = invoke<RemoteMachine[]>("remote_machines")
      .then((value) => {
        if (stopped) return [];
        const all = Array.isArray(value) ? value : [];
        if (!stopped) applyMachineRoles(all);
        return syncCapableMachines(all);
      })
      .then((value) => {
        if (!stopped) machines = value;
      })
      .catch(() => undefined)
      .finally(() => {
        refreshing = undefined;
      });
    return refreshing;
  };
  const ownership = createSyncWindowOwner(() => wake());
  const loop = startSyncLoop(
    () => collectSyncMachineIds(machines),
    (machineId) => (method, params) => remoteRequest(machineId, method, params),
    (machineId) => machines.find((machine) => machine.id === machineId)?.environmentId,
    ownership.isOwner,
    refreshMachines,
  );
  // A host that was not up yet at launch is linked on a later refresh.
  let localLinked = false;
  const connectLocalHost = () =>
    invoke<unknown>("local_host_connect")
      .then((machine) => {
        if (machine) localLinked = true;
      })
      .catch(() => undefined);
  const nudger = createDebouncer(() => loop.nudge(), NUDGE_DEBOUNCE_MS);
  const channel = (() => {
    try {
      return typeof BroadcastChannel === "undefined"
        ? undefined
        : new BroadcastChannel("bycoda-library-sync");
    } catch {
      return undefined;
    }
  })();
  const onLocalChange = createLocalChangeHandler(() => {
    nudger.trigger();
    channel?.postMessage("changed");
  });
  if (channel)
    channel.onmessage = (event) => {
      if (event.data === "changed" && ownership.isOwner()) nudger.trigger();
    };
  const unsubscribePaths = subscribeProjectPathsChanged(onLocalChange);
  const unsubscribeLock = subscribeLockRecordChanges(onLocalChange);
  const wake = () => {
    if (stopped || !ownership.isOwner()) return;
    void (localLinked ? refreshMachines() : connectLocalHost().then(refreshMachines)).then(() => {
      if (!stopped) loop.nudge();
    });
  };
  const unsubscribeRecovered = subscribeRemoteRecovered(() => {
    if (!ownership.isOwner()) return;
    void refreshMachines().then(() => {
      if (stopped) return;
      for (const machine of machines) {
        if (readRemoteConnection(machine.environmentId).status === "connected")
          loop.recover(machine.id);
      }
    });
  });
  const onVisibility = () => {
    if (!document.hidden) wake();
  };
  window.addEventListener("focus", wake);
  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", onVisibility);
  const interval = setInterval(() => {
    if (!ownership.isOwner()) return;
    if (localLinked) void refreshMachines();
    else void connectLocalHost().then(refreshMachines);
  }, 30_000);
  return () => {
    started = false;
    stopped = true;
    loop.stop();
    ownership.stop();
    channel?.close();
    nudger.cancel();
    unsubscribePaths();
    unsubscribeLock();
    unsubscribeRecovered();
    window.removeEventListener("focus", wake);
    window.removeEventListener("online", wake);
    document.removeEventListener("visibilitychange", onVisibility);
    clearInterval(interval);
  };
}
