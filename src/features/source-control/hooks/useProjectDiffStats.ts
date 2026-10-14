import { useCallback, useSyncExternalStore } from "react";
import { gitDiffStats, subscribeGitChanged, type GitDiffStats } from "../../../platform/tauri/fs";

type Entry = {
  cwd: string;
  stats: GitDiffStats | null;
  listeners: Set<() => void>;
  inFlight: boolean;
  pending: boolean;
  epoch: number;
  loadedAt: number;
  unsubscribeGit: (() => void) | null;
  onResume: (() => void) | null;
  onGitChanged: (() => void) | null;
};

const entries = new Map<string, Entry>();
const RESUME_TTL_MS = 30_000;

function entryFor(cwd: string): Entry {
  const existing = entries.get(cwd);
  if (existing) return existing;
  const entry: Entry = {
    cwd,
    stats: null,
    listeners: new Set(),
    inFlight: false,
    pending: false,
    epoch: 0,
    loadedAt: 0,
    unsubscribeGit: null,
    onResume: null,
    onGitChanged: null,
  };
  entries.set(cwd, entry);
  return entry;
}

function publish(entry: Entry, stats: GitDiffStats | null) {
  if (
    entry.stats?.files === stats?.files &&
    entry.stats?.additions === stats?.additions &&
    entry.stats?.deletions === stats?.deletions
  ) {
    return;
  }
  entry.stats = stats;
  for (const listener of entry.listeners) listener();
}

async function load(entry: Entry, force = false) {
  if (entry.inFlight) {
    entry.pending = true;
    return;
  }
  if (!force && document.hidden) return;
  entry.inFlight = true;
  const epoch = entry.epoch;
  try {
    const stats = await gitDiffStats(entry.cwd);
    if (epoch === entry.epoch) {
      entry.loadedAt = Date.now();
      publish(entry, stats);
    }
  } catch {
    if (epoch === entry.epoch) {
      entry.loadedAt = Date.now();
      publish(entry, null);
    }
  } finally {
    entry.inFlight = false;
    if (entry.pending) {
      entry.pending = false;
      void load(entry, true);
    }
  }
}

/** Push stats from a fuller git index (diff pane) so the title-bar badge cannot lag behind. */
export function applyProjectDiffStats(cwd: string, stats: GitDiffStats) {
  if (!cwd || cwd === "~") return;
  const entry = entryFor(cwd);
  entry.epoch += 1;
  entry.loadedAt = Date.now();
  publish(entry, stats);
}

function start(entry: Entry) {
  if (entry.onResume) return;
  if (!entry.inFlight && Date.now() - entry.loadedAt >= RESUME_TTL_MS) {
    void load(entry, true);
  }
  entry.onResume = () => {
    if (!document.hidden && !entry.inFlight && Date.now() - entry.loadedAt >= RESUME_TTL_MS) {
      void load(entry, true);
    }
  };
  entry.onGitChanged = () => void load(entry, true);
  window.addEventListener("focus", entry.onResume);
  document.addEventListener("visibilitychange", entry.onResume);
  entry.unsubscribeGit = subscribeGitChanged(entry.onGitChanged, { cwd: entry.cwd });
}

function stop(entry: Entry) {
  if (entry.onResume) {
    window.removeEventListener("focus", entry.onResume);
    document.removeEventListener("visibilitychange", entry.onResume);
  }
  entry.unsubscribeGit?.();
  entry.onResume = null;
  entry.onGitChanged = null;
  entry.unsubscribeGit = null;
}

function subscribeEntry(cwd: string, listener: () => void): () => void {
  const entry = entryFor(cwd);
  entry.listeners.add(listener);
  if (entry.listeners.size === 1) start(entry);
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0) stop(entry);
  };
}

export function useProjectDiffStats(cwd: string, enabled: boolean): GitDiffStats | null {
  const active = enabled && Boolean(cwd) && cwd !== "~";
  const subscribe = useCallback(
    (listener: () => void) => (active ? subscribeEntry(cwd, listener) : () => undefined),
    [active, cwd],
  );
  const getSnapshot = useCallback(() => {
    return active ? entryFor(cwd).stats : null;
  }, [active, cwd]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * The same per-project stats as `useProjectDiffStats`, for several projects at
 * once. It shares each project's entry, so a project already shown in the rail
 * costs no extra git call; only projects not yet watched start loading.
 */
export function useProjectsDiffStats(
  cwds: readonly string[],
  enabled: boolean,
): (GitDiffStats | null)[] {
  const paths = cwds.filter((cwd) => enabled && Boolean(cwd) && cwd !== "~");
  const key = JSON.stringify(paths);
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribers = paths.map((cwd) => subscribeEntry(cwd, listener));
      return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
    },
    // `key` stands in for `paths`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  // Callers read the changed-file count, so that alone drives re-renders.
  const getSnapshot = useCallback(
    () =>
      paths
        .map((cwd) => {
          const stats = entryFor(cwd).stats;
          return stats ? `${stats.files}` : "-";
        })
        .join(","),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return cwds.map((cwd) => (enabled && Boolean(cwd) && cwd !== "~" ? entryFor(cwd).stats : null));
}
