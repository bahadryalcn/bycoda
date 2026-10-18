import { useEffect, useSyncExternalStore } from "react";
import {
  installPendingUpdate,
  probeForUpdate,
  readAppVersion,
  type UpdaterSnapshot,
} from "./updater";

// All update entry points share one probe, download and progress snapshot.
let snapshot: UpdaterSnapshot = { phase: "idle", currentVersion: "…" };
let notes = "";
let checking = false;
let installing = false;
let consumers = 0;
let timer: ReturnType<typeof setInterval> | undefined;
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

async function probe() {
  if (checking || installing || snapshot.phase === "downloading") return;
  checking = true;
  const request = generation;
  try {
    const currentVersion = await readAppVersion();
    if (request !== generation) return;
    const update = await probeForUpdate();
    if (request !== generation || installing) return;
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
      void probe();
      timer = setInterval(() => void probe(), 30 * 60 * 1000);
    }
    return () => {
      consumers -= 1;
      if (!consumers) {
        clearInterval(timer);
        generation += 1;
        checking = false;
      }
    };
  }, []);
  return { snapshot: current, notes, setSnapshot: setAppUpdateSnapshot };
}
