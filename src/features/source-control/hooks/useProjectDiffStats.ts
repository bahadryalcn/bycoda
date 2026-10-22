import { useCallback, useSyncExternalStore } from "react";
import { gitDiffStats, subscribeGitChanged, type GitDiffStats } from "../../../platform/tauri/fs";
import { currentGitChangeHint, peekFullGitIndex } from "../model/gitIndexStore";
import {
  ACTIVE_PROJECT_REFRESH_MS,
  BACKGROUND_PROJECT_REFRESH_MS,
} from "../model/gitRefreshPolicy";

type Entry = {
  cwd: string;
  stats: GitDiffStats | null;
  listeners: Set<() => void>;
  activeListeners: Set<() => void>;
  inFlight: boolean;
  pending: boolean;
  epoch: number;
  loadedAt: number;
  attemptedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  unsubscribeGit: (() => void) | null;
  onResume: (() => void) | null;
  onGitChanged: (() => void) | null;
};

const entries = new Map<string, Entry>();

function interval(entry: Entry) {
  return entry.activeListeners.size > 0 ? ACTIVE_PROJECT_REFRESH_MS : BACKGROUND_PROJECT_REFRESH_MS;
}

function schedule(entry: Entry) {
  if (entry.timer !== null) clearTimeout(entry.timer);
  entry.timer = null;
  if (!entry.listeners.size || entry.inFlight || document.hidden) return;
  const age = Date.now() - Math.max(entry.loadedAt, entry.attemptedAt);
  entry.timer = setTimeout(() => void load(entry), Math.max(0, interval(entry) - age));
}

function entryFor(cwd: string): Entry {
  const existing = entries.get(cwd);
  if (existing) return existing;
  const entry: Entry = {
    cwd,
    stats: null,
    listeners: new Set(),
    activeListeners: new Set(),
    inFlight: false,
    pending: false,
    epoch: 0,
    loadedAt: 0,
    attemptedAt: 0,
    timer: null,
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
  if (document.hidden) {
    entry.pending ||= force;
    schedule(entry);
    return;
  }
  if (entry.inFlight) {
    entry.pending ||= force;
    return;
  }
  if (
    !force &&
    (entry.stats !== null || entry.attemptedAt > 0) &&
    Date.now() - Math.max(entry.loadedAt, entry.attemptedAt) < interval(entry)
  ) {
    schedule(entry);
    return;
  }
  const cached = peekFullGitIndex(entry.cwd);
  if (!force && cached && Date.now() - cached.at < interval(entry)) {
    applyProjectDiffStats(
      entry.cwd,
      {
        files: cached.value.files.length + (cached.value.conflicts?.length ?? 0),
        additions: cached.value.additions,
        deletions: cached.value.deletions,
      },
      cached.at,
    );
    return;
  }
  entry.pending = false;
  entry.inFlight = true;
  const epoch = entry.epoch;
  try {
    const stats = await gitDiffStats(entry.cwd);
    if (epoch === entry.epoch) {
      entry.loadedAt = Date.now();
      publish(entry, stats);
    }
  } catch {
    // Keep the last successful snapshot and wait out the normal retry interval.
  } finally {
    entry.attemptedAt = Date.now();
    entry.inFlight = false;
    if (entry.pending && entry.listeners.size > 0) {
      entry.pending = false;
      void load(entry, true);
    } else schedule(entry);
  }
}

/** Push stats from a fuller git index (diff pane) so the title-bar badge cannot lag behind. */
export function applyProjectDiffStats(cwd: string, stats: GitDiffStats, readAt = Date.now()) {
  if (!cwd || cwd === "~") return;
  const entry = entryFor(cwd);
  entry.epoch += 1;
  entry.loadedAt = readAt;
  publish(entry, stats);
  schedule(entry);
}

function start(entry: Entry) {
  if (entry.onResume) return;
  entry.onResume = () => {
    if (!document.hidden) void load(entry, entry.pending);
    else schedule(entry);
  };
  entry.onGitChanged = () => {
    const cached = currentGitChangeHint()?.observed ? peekFullGitIndex(entry.cwd) : null;
    if (cached) {
      applyProjectDiffStats(
        entry.cwd,
        {
          files: cached.value.files.length + (cached.value.conflicts?.length ?? 0),
          additions: cached.value.additions,
          deletions: cached.value.deletions,
        },
        cached.at,
      );
    } else void load(entry, true);
  };
  window.addEventListener("focus", entry.onResume);
  document.addEventListener("visibilitychange", entry.onResume);
  entry.unsubscribeGit = subscribeGitChanged(entry.onGitChanged, { cwd: entry.cwd });
  void load(entry);
}

function stop(entry: Entry) {
  if (entry.timer !== null) clearTimeout(entry.timer);
  entry.timer = null;
  if (entry.onResume) {
    window.removeEventListener("focus", entry.onResume);
    document.removeEventListener("visibilitychange", entry.onResume);
  }
  entry.unsubscribeGit?.();
  entry.onResume = null;
  entry.onGitChanged = null;
  entry.unsubscribeGit = null;
}

function subscribeEntry(cwd: string, listener: () => void, foreground = false): () => void {
  const entry = entryFor(cwd);
  entry.listeners.add(listener);
  if (foreground) entry.activeListeners.add(listener);
  if (entry.listeners.size === 1) start(entry);
  else void load(entry);
  return () => {
    entry.listeners.delete(listener);
    entry.activeListeners.delete(listener);
    if (entry.listeners.size === 0) stop(entry);
    else schedule(entry);
  };
}

export function useProjectDiffStats(
  cwd: string,
  enabled: boolean,
  foreground = true,
): GitDiffStats | null {
  const active = enabled && Boolean(cwd) && cwd !== "~";
  const subscribe = useCallback(
    (listener: () => void) =>
      active ? subscribeEntry(cwd, listener, foreground) : () => undefined,
    [active, cwd, foreground],
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
