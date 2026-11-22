import { useCallback, useSyncExternalStore } from "react";
import { createStore } from "../../../shared/lib/store";
import { gitDiffStats, subscribeGitChanged, type GitDiffStats } from "../../../platform/tauri/fs";
import { currentGitChangeHint, peekFullGitIndex } from "../model/gitIndexStore";
import {
  readMachineAvailability,
  subscribeAvailability,
  useMachineAvailability,
} from "../../connections/public/machineAvailability";
import { parseRemotePath } from "../../connections/public/remoteProjects";
import {
  ACTIVE_PROJECT_REFRESH_MS,
  BACKGROUND_PROJECT_REFRESH_MS,
} from "../model/gitRefreshPolicy";

type Entry = {
  cwd: string;
  machineId: string | null;
  stats: GitDiffStats | null;
  listeners: ReturnType<typeof createStore<[]>>;
  activeListeners: Set<() => void>;
  inFlight: boolean;
  /** An explicit refresh or Git change still needs a read, even after unsubscription. */
  pending: boolean;
  epoch: number;
  loadedAt: number;
  attemptedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  unsubscribeGit: (() => void) | null;
  onResume: (() => void) | null;
  onGitChanged: (() => void) | null;
};

type ReadQueue = {
  running: number;
  scheduled: boolean;
  waiting: Set<Entry>;
};

const MAX_READS_PER_MACHINE = 4;
const entries = new Map<string, Entry>();
const queues = new Map<string | null, ReadQueue>();

function interval(entry: Entry) {
  return entry.activeListeners.size > 0 ? ACTIVE_PROJECT_REFRESH_MS : BACKGROUND_PROJECT_REFRESH_MS;
}

function schedule(entry: Entry) {
  if (entry.timer !== null) clearTimeout(entry.timer);
  entry.timer = null;
  if (!entry.listeners.size || entry.inFlight || document.hidden) return;
  if (queues.get(entry.machineId)?.waiting.has(entry)) return;
  const age = Date.now() - Math.max(entry.loadedAt, entry.attemptedAt);
  entry.timer = setTimeout(() => requestLoad(entry), Math.max(0, interval(entry) - age));
}

function entryFor(cwd: string): Entry {
  const existing = entries.get(cwd);
  if (existing) return existing;
  const entry: Entry = {
    cwd,
    machineId: parseRemotePath(cwd)?.environmentId ?? null,
    stats: null,
    listeners: createStore(),
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
  entry.listeners.notify();
}

function requestLoad(entry: Entry, force = false, manualRefresh = false) {
  entry.pending ||= force && (!entry.inFlight || !manualRefresh);
  if (document.hidden) {
    schedule(entry);
    return;
  }
  if (entry.inFlight) return;
  let queue = queues.get(entry.machineId);
  if (!queue) {
    queue = { running: 0, scheduled: false, waiting: new Set() };
    queues.set(entry.machineId, queue);
  }
  queue.waiting.add(entry);
  schedule(entry);
  drainSoon(entry.machineId, queue);
}

function drainSoon(machineId: Entry["machineId"], queue: ReadQueue) {
  if (queue.scheduled) return;
  queue.scheduled = true;
  // Collect subscriptions from the same commit before choosing which checkouts start.
  queueMicrotask(() => {
    queue.scheduled = false;
    for (const foreground of [true, false]) {
      for (const entry of queue.waiting) {
        if (queue.running >= MAX_READS_PER_MACHINE) return;
        if (entry.activeListeners.size > 0 !== foreground) continue;
        queue.waiting.delete(entry);
        if (!entry.listeners.size || !readMachineAvailability(entry.cwd).available) continue;
        if (!shouldRead(entry)) continue;
        queue.running += 1;
        void read(entry)
          .finally(() => {
            queue.running -= 1;
            drainSoon(machineId, queue);
          })
          .catch(() => {});
      }
    }
    if (queue.running === 0) queues.delete(machineId);
  });
}

function shouldRead(entry: Entry) {
  if (document.hidden) return false;
  const force = entry.pending;
  if (
    !force &&
    (entry.stats !== null || entry.attemptedAt > 0) &&
    Date.now() - Math.max(entry.loadedAt, entry.attemptedAt) < interval(entry)
  ) {
    schedule(entry);
    return false;
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
    return false;
  }
  return true;
}

async function read(entry: Entry) {
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
      requestLoad(entry);
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
    if (!document.hidden) requestLoad(entry);
    else schedule(entry);
  };
  entry.onGitChanged = () => {
    const hint = currentGitChangeHint();
    const cached = hint?.observed ? peekFullGitIndex(entry.cwd) : null;
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
    } else requestLoad(entry, true, hint?.refresh);
  };
  window.addEventListener("focus", entry.onResume);
  document.addEventListener("visibilitychange", entry.onResume);
  entry.unsubscribeGit = subscribeGitChanged(entry.onGitChanged, { cwd: entry.cwd });
  requestLoad(entry);
}

function stop(entry: Entry) {
  queues.get(entry.machineId)?.waiting.delete(entry);
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
  const unsubscribe = entry.listeners.subscribe(listener);
  if (foreground) entry.activeListeners.add(listener);
  if (entry.listeners.size === 1) start(entry);
  else requestLoad(entry);
  return () => {
    unsubscribe();
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
  // The last counts stay shown, but a machine that cannot be asked is not read.
  const readable = useMachineAvailability(cwd).available;
  const subscribe = useCallback(
    (listener: () => void) =>
      active && readable ? subscribeEntry(cwd, listener, foreground) : () => undefined,
    [active, readable, cwd, foreground],
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
  // Reads only machines that can be asked; a list of many projects checks each one. The
  // subscription re-renders when one of them changes, so its reads stop or resume with it.
  const readable = (cwd: string) => readMachineAvailability(cwd).available;
  const readableKey = () => cwds.map((cwd) => (readable(cwd) ? "1" : "0")).join("");
  useSyncExternalStore(subscribeAvailability, readableKey, readableKey);
  const paths = cwds.filter((cwd) => enabled && Boolean(cwd) && cwd !== "~" && readable(cwd));
  const key = JSON.stringify(paths);
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribers = Array.from(new Set(paths), (cwd) => subscribeEntry(cwd, listener));
      return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
    },
    // `key` stands in for `paths`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  // The overview totals all three fields. Equal values preserve its snapshot.
  const getSnapshot = useCallback(
    () =>
      paths
        .map((cwd) => {
          const stats = entryFor(cwd).stats;
          return stats ? `${stats.files}:${stats.additions}:${stats.deletions}` : "-";
        })
        .join(","),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return cwds.map((cwd) => (enabled && Boolean(cwd) && cwd !== "~" ? entryFor(cwd).stats : null));
}
