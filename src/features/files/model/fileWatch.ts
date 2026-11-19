import { statFiles, statFilesSettled } from "../../../platform/tauri/fs";
import { editorPathsEqual } from "../../search/model/search";

const MAX_PATHS = 64;
/** Paths whose unavailable stat was already reported, so every poll stays quiet until it recovers. */
const unavailableReported = new Set<string>();

function reportUnavailable(path: string, reason: unknown) {
  if (unavailableReported.has(path)) return;
  unavailableReported.add(path);
  console.warn("File change check unavailable", path, reason);
}

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();
const mtimes = new Map<string, number | null | undefined>();
const unobserved = new Set<string>();
let inFlight = false;
let queued: string[] | "all" | null = null;

/** Watch a currently open file and reconcile it after the first mtime sample. */
export function watchFile(path: string, onChange: Listener): () => void {
  let set = listeners.get(path);
  if (!set) {
    set = new Set();
    listeners.set(path, set);
    mtimes.set(path, undefined);
    unobserved.add(path);
  }
  set.add(onChange);
  if (typeof document === "undefined" || !document.hidden) {
    void poll([path]);
  }
  return () => {
    set.delete(onChange);
    if (set.size > 0) return;
    listeners.delete(path);
    mtimes.delete(path);
    unobserved.delete(path);
    unavailableReported.delete(path);
  };
}

/** Re-stat watched paths now (agent edit / shell / window focus). */
export function nudgeWatchedFiles(paths?: string[]) {
  if (listeners.size === 0) return;
  if (typeof document !== "undefined" && document.hidden) return;
  const watched = watchedPaths(paths);
  if (watched.length > 0) void poll(paths ? watched : "all");
}

/**
 * Reload open editors even when mtime looks unchanged (git restore can
 * rewrite a file in the same second as the last save).
 */
export function invalidateWatchedFiles(paths?: string[]) {
  if (listeners.size === 0) return;
  const watched = watchedPaths(paths);
  for (const path of watched) {
    mtimes.set(path, undefined);
    // The direct notification below already reconciles the editor. The poll
    // only needs to establish its new baseline, not notify a second time.
    unobserved.delete(path);
    listeners.get(path)?.forEach((listener) => listener());
  }
  if (watched.length > 0 && (typeof document === "undefined" || !document.hidden)) {
    void poll(paths ? watched : "all");
  }
}

function watchedPaths(paths?: string[]): string[] {
  if (!paths) return [...listeners.keys()];
  const watched: string[] = [];
  for (const path of paths) {
    for (const key of listeners.keys()) {
      if (editorPathsEqual(key, path) && !watched.includes(key)) {
        watched.push(key);
      }
    }
  }
  return watched;
}

/** Update the mtime baseline after our own save so we do not reload it. */
export async function syncWatchedMtime(path: string): Promise<void> {
  if (!listeners.has(path)) return;
  try {
    const [stat] = await statFiles([path]);
    if (stat && listeners.has(path)) {
      mtimes.set(path, stat.mtimeMs);
      unobserved.delete(path);
    }
  } catch {
    /* next nudge will retry */
  }
}

async function poll(paths: string[] | "all") {
  if (inFlight) {
    if (paths === "all" || queued === "all") {
      queued = "all";
      return;
    }
    const next = queued == null ? [...paths] : [...queued, ...paths];
    queued = [...new Set(next)];
    return;
  }

  const list =
    paths === "all" ? [...listeners.keys()] : paths.filter((path) => listeners.has(path));
  if (list.length === 0) return;

  inFlight = true;
  try {
    for (let i = 0; i < list.length; i += MAX_PATHS) {
      const batch = list.slice(i, i + MAX_PATHS);
      const stats = await statFilesSettled(batch);
      for (const stat of stats) {
        if (!listeners.has(stat.path)) continue;
        if ("unavailable" in stat) {
          // Its machine could not answer, which is not a deletion: keep the
          // baseline (and a pending first observation) until it answers again.
          reportUnavailable(stat.path, stat.unavailable);
          continue;
        }
        unavailableReported.delete(stat.path);
        const previous = mtimes.get(stat.path);
        const firstObservation = unobserved.delete(stat.path);
        mtimes.set(stat.path, stat.mtimeMs);
        // The file may have changed after its initial read but before the
        // watcher established this baseline. Reconcile on the first sample so
        // that race cannot leave an open editor permanently stale.
        if (!firstObservation && (previous === undefined || previous === stat.mtimeMs)) continue;
        listeners.get(stat.path)?.forEach((listener) => listener());
      }
    }
  } catch {
    /* next nudge will retry */
  } finally {
    inFlight = false;
    const next = queued;
    queued = null;
    if (next) void poll(next === "all" ? "all" : next);
  }
}

if (typeof document !== "undefined") {
  window.addEventListener("focus", () => {
    if (!document.hidden) nudgeWatchedFiles();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) nudgeWatchedFiles();
  });
}
