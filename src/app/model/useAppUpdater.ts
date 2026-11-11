import { useEffect, useSyncExternalStore } from "react";
import { subscribeUpdateChannel } from "../../features/settings/model/updateChannel";
import { isUpdatePromptSnoozed } from "./updatePrompt";
import {
  nextUpdateProbeDelayMs,
  pendingUpdateProbeWaitMs,
  subscribeUpdateProbeBackoff,
} from "./updateProbeBackoff";
import {
  installPendingUpdate,
  probeForUpdate,
  readAppVersion,
  type UpdaterSnapshot,
} from "./updater";

// All update entry points share one probe, download and progress snapshot.
let snapshot: UpdaterSnapshot = { phase: "idle", currentVersion: "…" };
let notes = "";
let startupChecked = false;
let startupPromptVersion: string | null = null;

export function claimStartupUpdatePrompt(): boolean {
  if (!startupPromptVersion || snapshot.availableVersion !== startupPromptVersion) return false;
  startupPromptVersion = null;
  return !isUpdatePromptSnoozed();
}

let checking = false;
let installing = false;
let consumers = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let stopChannel: (() => void) | undefined;
let stopBackoff: (() => void) | undefined;
let generation = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getSnapshot = () => snapshot;

export function setAppUpdateSnapshot(next: UpdaterSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function armProbeTimer(delay = nextUpdateProbeDelayMs()) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    // Re-arm first: a probe that is skipped or disabled settles no check.
    armProbeTimer();
    void probe();
  }, delay);
}

async function probe(explicit = false) {
  if (checking || installing || snapshot.phase === "downloading") return;
  checking = true;
  const request = generation;
  try {
    const currentVersion = await readAppVersion();
    if (request !== generation) return;
    const update = await probeForUpdate(explicit);
    if (request !== generation || installing) return;
    if (!startupChecked) {
      startupChecked = true;
      startupPromptVersion = update?.version ?? null;
    }
    if (update) {
      notes = update.body?.trim() ?? "";
      setAppUpdateSnapshot({
        phase: "available",
        currentVersion,
        availableVersion: update.version,
      });
    } else {
      setAppUpdateSnapshot({ phase: "current", currentVersion });
    }
  } catch {
    // A failed background check must not hide an already discovered update.
  } finally {
    if (request === generation) checking = false;
  }
}

export async function installAppUpdate(onSnapshot: (next: UpdaterSnapshot) => void) {
  if (installing) return;
  installing = true;
  try {
    const next = await installPendingUpdate((progress) => {
      setAppUpdateSnapshot(progress);
      onSnapshot(progress);
    });
    if (next) {
      setAppUpdateSnapshot(next);
      onSnapshot(next);
    }
  } finally {
    installing = false;
  }
}

export function useAppUpdater() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    consumers += 1;
    if (consumers === 1) {
      // A remount inside a failure wait keeps that wait instead of probing again.
      const wait = pendingUpdateProbeWaitMs();
      armProbeTimer(wait || undefined);
      if (!wait) void probe();
      // Every settled check, background or explicit, restarts the wait from its outcome.
      stopBackoff = subscribeUpdateProbeBackoff(() => armProbeTimer());
      // Switching the update channel is the user's own check of other feeds: it answers
      // right away. probe() never rejects; the handler keeps that true if it changes.
      stopChannel = subscribeUpdateChannel(() => {
        probe(true).catch(() => {});
      });
    }
    return () => {
      consumers -= 1;
      if (!consumers) {
        clearTimeout(timer);
        stopChannel?.();
        stopBackoff?.();
        generation += 1;
        checking = false;
      }
    };
  }, []);
  return { snapshot: current, notes, setSnapshot: setAppUpdateSnapshot };
}
