import { createStoredSetting } from "../../../shared/lib/storedSetting";
import { invoke } from "@tauri-apps/api/core";

/** Machines the owner turned off on this computer, by environment id. Turning one
 * off only stops this computer from connecting; the saved credential, learned
 * routes and cached sessions stay, so turning it on again needs no sign-in. */
const CHANGE_EVENT = "bycoda:machines-disabled-change";
const stored = createStoredSetting<readonly string[]>({
  key: "bycoda.disabledMachines",
  fallback: [],
  event: CHANGE_EVENT,
  storageEvents: true,
  parse: (raw) => {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  },
  serialize: (value) => JSON.stringify(value),
});

export const loadDisabledMachines = stored.load;
export const subscribeDisabledMachines = stored.subscribe;

function syncNativeDisabledMachines(): void {
  try {
    void Promise.resolve(
      invoke("remote_set_disabled_machines", { environmentIds: stored.load() }),
    ).catch(() => undefined);
  } catch {
    // Browser fixtures have no native transport.
  }
}
let nativeSyncStarted = false;
/** Mirrors the off list into native transport admission from now on. Importing this
 * module has no side effect; remote recovery starts this, and so does any change. */
export function startNativeDisabledMachinesSync(): void {
  if (nativeSyncStarted) return;
  nativeSyncStarted = true;
  stored.subscribe(syncNativeDisabledMachines);
  // Native starts with nothing turned off, so an empty list needs no call.
  if (stored.load().length > 0) syncNativeDisabledMachines();
}

export function isMachineEnabled(environmentId: string): boolean {
  return !stored.load().includes(environmentId);
}

const disabledListeners = new Set<(environmentId: string) => void>();

/** Told once each time a machine goes from on to off here (not for a repeated off, nor from
 * another window), so whatever it holds open can be closed. */
export function subscribeMachineTurnedOff(listener: (environmentId: string) => void) {
  disabledListeners.add(listener);
  return () => {
    disabledListeners.delete(listener);
  };
}

export function setMachineEnabled(environmentId: string, enabled: boolean): void {
  startNativeDisabledMachinesSync();
  const wasEnabled = isMachineEnabled(environmentId);
  const rest = stored.load().filter((id) => id !== environmentId);
  stored.save(enabled ? rest : [...rest, environmentId]);
  if (!enabled && wasEnabled) disabledListeners.forEach((listener) => listener(environmentId));
}
