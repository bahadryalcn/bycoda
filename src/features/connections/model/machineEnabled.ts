import { createStoredSetting } from "../../../shared/lib/storedSetting";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../../../shared/i18n";
import { toast } from "../../../shared/ui/ToastRegion";

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

const NATIVE_SYNC_TOAST_ID = "machines-native-sync";
const NATIVE_SYNC_RETRY_MS = 5_000;
/** Machines native transport has accepted as off. Until it does, a machine that is off
 * here is still admitted natively, so its switch reads "Turning off…". */
let confirmedDisabled = new Set<string>();
let syncRetry: ReturnType<typeof setTimeout> | undefined;
const nativeListeners = new Set<() => void>();

function isNativeRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function syncNativeDisabledMachines(): void {
  clearTimeout(syncRetry);
  syncRetry = undefined;
  const ids = stored.load();
  const key = JSON.stringify(ids);
  void (async () => {
    let failed = false;
    try {
      await invoke("remote_set_disabled_machines", { environmentIds: ids });
    } catch {
      failed = true;
    }
    // A newer change started its own sync; this answer no longer describes the list.
    if (JSON.stringify(stored.load()) !== key) return;
    if (failed && isNativeRuntime()) {
      toast.show({
        id: NATIVE_SYNC_TOAST_ID,
        tone: "warning",
        title: t("Couldn’t turn off this machine yet"),
        message: t("Retrying…"),
        durationMs: null,
      });
      syncRetry = setTimeout(syncNativeDisabledMachines, NATIVE_SYNC_RETRY_MS);
      return;
    }
    // Browser fixtures have no native transport, so there is nothing to confirm there.
    confirmedDisabled = new Set(ids);
    toast.dismiss(NATIVE_SYNC_TOAST_ID);
    nativeListeners.forEach((listener) => listener());
  })();
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

/** Off here, but native transport has not yet confirmed it stopped admitting the machine. */
export function isMachineTurningOff(environmentId: string): boolean {
  return !isMachineEnabled(environmentId) && !confirmedDisabled.has(environmentId);
}

/** Told when the off list changes here or native transport confirms it. */
export function subscribeMachineSwitch(listener: () => void): () => void {
  const stopStored = subscribeDisabledMachines(listener);
  nativeListeners.add(listener);
  return () => {
    stopStored();
    nativeListeners.delete(listener);
  };
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
  // Turning on forgets an earlier confirmation, so a later off waits for native again.
  if (enabled) confirmedDisabled.delete(environmentId);
  const rest = stored.load().filter((id) => id !== environmentId);
  stored.save(enabled ? rest : [...rest, environmentId]);
  if (!enabled && wasEnabled) disabledListeners.forEach((listener) => listener(environmentId));
}
