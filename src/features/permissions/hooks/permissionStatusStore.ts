import {
  listenSystemPermissionsChanged,
  systemPermissionsStatus,
  type SystemPermissionsReport,
} from "../../../platform/tauri/systemPermissions";

export type PermissionStatusSnapshot = {
  report: SystemPermissionsReport | undefined;
  loading: boolean;
  failed: boolean;
};

const INITIAL: PermissionStatusSnapshot = { report: undefined, loading: true, failed: false };
const SETUP_POLL_MS = 1000;

let snapshot = INITIAL;
let generation = 0;
let inFlight: { generation: number; done: Promise<void> } | undefined;
let subscribers = 0;
let setupWatchers = 0;
let detach: (() => void) | undefined;
let timer: number | undefined;
const listeners = new Set<() => void>();

function publish(next: PermissionStatusSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

/**
 * Reads the whole OS permission report once. Focus and setup-poll reads join a
 * read that is still current; an explicit recheck (`force`) always starts a new
 * one so it cannot return a probe that began before the owner acted in the OS.
 * A failed read clears the report: a stale grant must never imply access.
 */
export function readPermissionStatus(force = false): Promise<void> {
  if (!force && inFlight && inFlight.generation === generation) return inFlight.done;
  const request = ++generation;
  if (!snapshot.loading) publish({ ...snapshot, loading: true });
  const done = (async () => {
    try {
      const report = await systemPermissionsStatus();
      if (request === generation) publish({ report, loading: false, failed: false });
    } catch {
      if (request === generation) publish({ report: undefined, loading: false, failed: true });
    } finally {
      if (inFlight?.done === done) inFlight = undefined;
    }
  })();
  inFlight = { generation: request, done };
  return done;
}

function readQuietly() {
  void readPermissionStatus();
}

function sync() {
  const active = subscribers > 0;
  if (active && !detach) {
    // One focus listener and one native-change subscription serve every consumer.
    window.addEventListener("focus", readQuietly);
    const dispose = listenSystemPermissionsChanged((report) => {
      generation++;
      publish({ report, loading: false, failed: false });
    });
    detach = () => {
      window.removeEventListener("focus", readQuietly);
      dispose();
    };
    readQuietly();
  } else if (!active && detach) {
    detach();
    detach = undefined;
    // Drop replies to reads still in flight and start the next mount from a fresh read.
    generation++;
    inFlight = undefined;
    snapshot = INITIAL;
  }
  const polling = active && setupWatchers > 0;
  if (polling && timer === undefined) {
    timer = window.setInterval(readQuietly, SETUP_POLL_MS);
    readQuietly();
  } else if (!polling && timer !== undefined) {
    window.clearInterval(timer);
    timer = undefined;
  }
}

export function subscribePermissionStatus(listener: () => void) {
  listeners.add(listener);
  subscribers++;
  sync();
  return () => {
    listeners.delete(listener);
    subscribers--;
    sync();
  };
}

/** Polling runs only while at least one setup sheet watches for the grant. */
export function watchPermissionSetup() {
  setupWatchers++;
  sync();
  return () => {
    setupWatchers--;
    sync();
  };
}

export function getPermissionStatusSnapshot() {
  return snapshot;
}
