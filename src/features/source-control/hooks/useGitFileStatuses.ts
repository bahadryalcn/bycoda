import { CheckoutCache } from "../model/checkoutCache";
import { useCallback, useSyncExternalStore } from "react";
import { createStore } from "../../../shared/lib/store";
import { subscribeGitChanged, type GitDiffIndex } from "../../../platform/tauri/fs";
import { fetchGitIndex } from "../model/gitIndexStore";
import { subscribeDirsChanged } from "../../files/public/fileTree";
import { parentPath } from "../../../shared/lib/paths";
import { remotePollDue, reportRemoteLoad } from "../../connections/public/remoteHealth";
import { isRemoteProjectPath } from "../../projects/public/recents";
import { IS_MAC } from "../../../platform/tauri/platform";

export type GitStatusMap = {
  files: Map<string, string>;
  dirs: Map<string, string>;
};

const normalizedStatuses = new WeakMap<Map<string, string>, Map<string, string | null>>();

/** Match decomposed native macOS names without changing the actual operation path. */
export function gitStatusForPath(
  map: Map<string, string> | undefined,
  path: string,
): string | undefined {
  const exact = map?.get(path);
  if (exact !== undefined || !map || !IS_MAC || isRemoteProjectPath(path)) return exact;
  let aliases = normalizedStatuses.get(map);
  if (!aliases) {
    aliases = new Map();
    for (const [key, status] of map) {
      const normalized = key.normalize("NFC");
      aliases.set(normalized, aliases.has(normalized) ? null : status);
    }
    normalizedStatuses.set(map, aliases);
  }
  return aliases.get(path.normalize("NFC")) ?? undefined;
}

const STATUS_PRIORITY: Record<string, number> = {
  modified: 3,
  deleted: 2,
  added: 1,
  untracked: 1,
};

const EMPTY: GitStatusMap = { files: new Map(), dirs: new Map() };

type Entry = {
  cwd: string;
  data: GitStatusMap;
  listeners: ReturnType<typeof createStore<[]>>;
  inFlight: boolean;
  pending: boolean;
  unsubscribeGit: (() => void) | null;
  unsubscribeDirs: (() => void) | null;
  onResume: (() => void) | null;
};

const entries = new CheckoutCache<string, Entry>(
  (entry) => entry.listeners.size > 0 || !!entry.inFlight,
  (entry) => entry.data,
);

function entryFor(cwd: string): Entry {
  const existing = entries.get(cwd);
  if (existing) return existing;
  const entry: Entry = {
    cwd,
    data: EMPTY,
    listeners: createStore(),
    inFlight: false,
    pending: false,
    unsubscribeGit: null,
    unsubscribeDirs: null,
    onResume: null,
  };
  entries.set(cwd, entry);
  return entry;
}

function buildStatusMaps(index: GitDiffIndex, cwd: string): GitStatusMap {
  const files = new Map<string, string>();
  const dirs = new Map<string, string>();
  for (const file of index.files) {
    files.set(file.path, file.status);
    const prio = STATUS_PRIORITY[file.status] ?? 0;
    if (prio === 0) continue;
    let dir = parentPath(file.path);
    while (dir.length > cwd.length) {
      const existing = dirs.get(dir);
      const existingPrio = existing ? (STATUS_PRIORITY[existing] ?? 0) : 0;
      if (prio > existingPrio) {
        dirs.set(dir, file.status);
      } else {
        break;
      }
      dir = parentPath(dir);
    }
  }
  return { files, dirs };
}

function sameMaps(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of b) {
    if (a.get(k) !== v) return false;
  }
  return true;
}

function sameData(a: GitStatusMap, b: GitStatusMap): boolean {
  return sameMaps(a.files, b.files) && sameMaps(a.dirs, b.dirs);
}

function publish(entry: Entry, data: GitStatusMap) {
  if (sameData(entry.data, data)) return;
  entry.data = data;
  entries.refresh(entry.cwd);
  entry.listeners.notify();
}

async function load(entry: Entry, force = false) {
  if (entries.get(entry.cwd) !== entry) return;
  if (entry.inFlight) {
    entry.pending = true;
    return;
  }
  if (!force && document.hidden) return;
  entry.inFlight = true;
  try {
    const index = await fetchGitIndex(entry.cwd);
    publish(entry, buildStatusMaps(index, entry.cwd));
    if (isRemoteProjectPath(entry.cwd)) reportRemoteLoad(entry.cwd, "statuses");
  } catch (error) {
    // On a remote project the decorations stay as they were; the Changes panel
    // is where a connection failure is explained.
    if (!isRemoteProjectPath(entry.cwd)) publish(entry, EMPTY);
    else reportRemoteLoad(entry.cwd, "statuses", error);
  } finally {
    entry.inFlight = false;
    if (entry.pending) {
      entry.pending = false;
      void load(entry, true);
    }
    entries.prune();
  }
}

function start(entry: Entry) {
  if (entry.onResume) return;
  void load(entry, true);
  entry.onResume = () => {
    if (!document.hidden) void load(entry, true);
  };
  window.addEventListener("focus", entry.onResume);
  document.addEventListener("visibilitychange", entry.onResume);
  entry.unsubscribeGit = subscribeGitChanged(entry.onResume, { cwd: entry.cwd });
  // The explorer's own remote refresh fires this every few seconds; skip it
  // while the machine is unreachable.
  entry.unsubscribeDirs = subscribeDirsChanged(() => {
    if (remotePollDue(entry.cwd)) entry.onResume?.();
  }, entry.cwd);
}

function stop(entry: Entry) {
  if (entry.onResume) {
    window.removeEventListener("focus", entry.onResume);
    document.removeEventListener("visibilitychange", entry.onResume);
  }
  entry.unsubscribeGit?.();
  entry.unsubscribeDirs?.();
  entry.onResume = null;
  entry.unsubscribeGit = null;
  entry.unsubscribeDirs = null;
}

export function useGitFileStatuses(cwd: string, enabled: boolean): GitStatusMap {
  const active = enabled && Boolean(cwd) && cwd !== "~";
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!active) return () => undefined;
      const entry = entryFor(cwd);
      const unsubscribe = entry.listeners.subscribe(listener);
      if (entry.listeners.size === 1) start(entry);
      return () => {
        unsubscribe();
        if (entry.listeners.size === 0) stop(entry);
        entries.prune();
      };
    },
    [active, cwd],
  );
  const getSnapshot = useCallback(() => {
    return active ? entryFor(cwd).data : EMPTY;
  }, [active, cwd]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
