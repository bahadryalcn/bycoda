import { listDir, type FsEntry } from "../../../platform/tauri/fs";
import { classifyRemoteError, isConnectionFailure } from "../../connections/model/remoteFailure";
import { reportRemoteConnection } from "../../connections/model/remoteHealth";
import { isRemoteProjectPath } from "../../projects/model/recents";
import { pathSegments } from "./fileName";
import { joinPath, parentPath, pathKey } from "../../../shared/lib/paths";

const expandedByProject = new Map<string, Set<string>>();
const selectedByProject = new Map<string, string | null>();
const dirs = new Map<string, FsEntry[]>();
const verifiedListings = new WeakMap<FsEntry[], number>();
const listingKeys = new WeakMap<FsEntry[], number>();
const pollBackoff = new Map<string, { misses: number; nextAt: number }>();

function listingKey(entries: FsEntry[]): number {
  const cached = listingKeys.get(entries);
  if (cached !== undefined) return cached;
  let hash = entries.length;
  for (const entry of entries) {
    const value = `${entry.name}\0${entry.path}\0${+entry.isDir}${+entry.ignored}`;
    for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  }
  listingKeys.set(entries, hash);
  return hash;
}
/** Hash fast-path plus exact field comparison: collisions cannot hide a change. */
function sameListing(a: FsEntry[], b: FsEntry[]): boolean {
  return (
    a.length === b.length &&
    listingKey(a) === listingKey(b) &&
    a.every((entry, i) => {
      const next = b[i];
      return (
        entry.name === next.name &&
        entry.path === next.path &&
        entry.isDir === next.isDir &&
        entry.ignored === next.ignored
      );
    })
  );
}
const listeners = new Set<
  (roots?: readonly string[], listingsChanged?: readonly string[]) => void
>();
const activeRoots = new Map<string, number>();
const pendingRoots = new Set<string>();
let refreshAll = false;
let contentChange = false;
const dirReads = new Map<string, Promise<FsEntry[]>>();
const dirEpochs = new Map<string, object>();

const REFRESH_MS = 150;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshing = false;
let refreshAgain = false;

export function loadExpanded(cwd: string): Set<string> {
  const saved = expandedByProject.get(cwd);
  return saved ? new Set(saved) : new Set([cwd]);
}

export function saveExpanded(cwd: string, expanded: Set<string>) {
  expandedByProject.set(cwd, new Set(expanded));
  pruneHiddenDirs(cwd);
}

function visibleToRoot(root: string): (path: string) => boolean {
  const rootKey = pathKey(root);
  const expanded = new Set([...loadExpanded(root)].map(pathKey));
  return (path) => {
    if (!dirBelongsToRoot(path, root)) return false;
    let ancestor = pathKey(path);
    if (ancestor !== rootKey && !expanded.has(rootKey)) return false;
    while (ancestor !== rootKey) {
      if (!expanded.has(ancestor)) return false;
      const parent = parentPath(ancestor);
      if (!parent || parent === ancestor) return false;
      ancestor = pathKey(parent);
    }
    return true;
  };
}

function pruneHiddenDirs(root: string) {
  const visible = visibleToRoot(root);
  const otherViews = [...activeRoots.keys()].filter((other) => other !== root).map(visibleToRoot);
  for (const path of new Set([...dirs.keys(), ...dirReads.keys(), ...dirEpochs.keys()])) {
    if (
      dirBelongsToRoot(path, root) &&
      !visible(path) &&
      !otherViews.some((isVisible) => isVisible(path))
    ) {
      dirs.delete(path);
      dirReads.delete(path);
      dirEpochs.delete(path);
      pollBackoff.delete(path);
    }
  }
}

export function loadSelected(cwd: string): string | null {
  return selectedByProject.get(cwd) ?? null;
}

export function saveSelected(cwd: string, path: string | null) {
  selectedByProject.set(cwd, path);
}

/** Cached `listDir` — same path stays instant when the tree remounts. */
export function peekDir(path: string): FsEntry[] | null {
  return dirs.get(path) ?? null;
}

/** Time of the last successful owner read for the currently cached listing. */
export function verifiedDirAt(path: string): number | undefined {
  const listing = dirs.get(path);
  return listing ? verifiedListings.get(listing) : undefined;
}

export function listCachedDir(path: string): Promise<FsEntry[]> {
  const hit = dirs.get(path);
  if (hit) return Promise.resolve(hit);
  const pending = dirReads.get(path);
  if (pending) return pending;
  return readDir(path);
}

function readDir(path: string, previous?: FsEntry[]): Promise<FsEntry[]> {
  const epoch = {};
  dirEpochs.set(path, epoch);
  const read = listDir(path)
    .then(
      (entries) => {
        if (dirEpochs.get(path) === epoch) {
          const cached = previous && sameListing(previous, entries) ? previous : entries;
          dirs.set(path, cached);
          verifiedListings.set(cached, Date.now());
        }
        if (dirEpochs.get(path) === epoch) reportRemoteConnection(path, "files");
        return entries;
      },
      (error: unknown) => {
        if (dirEpochs.get(path) === epoch && previous && keepsLastListing(path, error)) {
          dirs.set(path, previous);
        }
        if (dirEpochs.get(path) === epoch) reportRemoteConnection(path, "files", error);
        throw error;
      },
    )
    .finally(() => {
      if (dirReads.get(path) === read) dirReads.delete(path);
    });
  dirReads.set(path, read);
  return read;
}

/** A folder on a machine that cannot be reached keeps showing what it last held. */
const keepsLastListing = (path: string, error: unknown) =>
  isRemoteProjectPath(path) && isConnectionFailure(classifyRemoteError(error));

export function refreshDir(path: string): Promise<FsEntry[]> {
  pollBackoff.delete(path);
  const previous = dirs.get(path);
  dirs.delete(path);
  return readDir(path, previous);
}

export function forgetDir(path: string) {
  for (const key of new Set([...dirs.keys(), ...dirReads.keys(), ...dirEpochs.keys()])) {
    if (dirBelongsToRoot(key, path)) {
      dirs.delete(key);
      dirReads.delete(key);
      dirEpochs.delete(key);
      pollBackoff.delete(key);
    }
  }
}

export function dirBelongsToRoot(path: string, root: string): boolean {
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "");
  const base = normalize(root);
  const name = normalize(path);
  return name === base || name.startsWith(`${base}/`);
}

/** Poll only visible cached folders within the requested roots. */
export async function refreshCachedDirs(
  roots?: readonly string[],
  pollOnly = false,
): Promise<string[]> {
  for (const root of activeRoots.keys()) pruneHiddenDirs(root);
  const paths = [...dirs.keys()].filter(
    (path) => !roots || roots.some((root) => dirBelongsToRoot(path, root)),
  );
  const changed: string[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, paths.length) }, async () => {
      while (cursor < paths.length) {
        const path = paths[cursor++];
        // A preceding worker may have yielded while this subtree was collapsed.
        if (!dirs.has(path)) continue;
        const backoff = pollBackoff.get(path);
        if (pollOnly && backoff && backoff.nextAt > Date.now()) continue;
        const previousEntries = dirs.get(path);
        const read = refreshDir(path);
        const epoch = dirEpochs.get(path);
        try {
          const next = await read;
          if (dirEpochs.get(path) !== epoch) continue;
          const unchanged = !!previousEntries && sameListing(previousEntries, next);
          if (!unchanged) changed.push(path);
          const misses = unchanged ? Math.min((backoff?.misses ?? 0) + 1, 4) : 0;
          const base = isRemoteProjectPath(path) ? 5000 : 3000;
          pollBackoff.set(path, {
            misses,
            nextAt: Date.now() + Math.min(30_000, base * 2 ** misses),
          });
          // An unchanged listing keeps its array identity, so per-directory
          // subscribers (`peekDir` snapshots) see no change.
        } catch (error) {
          if (dirEpochs.get(path) !== epoch) continue;
          if (!keepsLastListing(path, error)) {
            forgetDir(path);
            changed.push(path);
          }
        }
      }
    }),
  );
  return changed;
}

export function subscribeDirsChanged(
  listener: (roots?: readonly string[], listingsChanged?: readonly string[]) => void,
  root?: string,
): () => void {
  const notify = (paths?: readonly string[], listingsChanged?: readonly string[]) => {
    if (!root || !paths || paths.some((path) => dirBelongsToRoot(path, root)))
      listener(paths, listingsChanged);
  };
  listeners.add(notify);
  if (root) activeRoots.set(root, (activeRoots.get(root) ?? 0) + 1);
  return () => {
    listeners.delete(notify);
    if (root) {
      const count = (activeRoots.get(root) ?? 1) - 1;
      if (count) activeRoots.set(root, count);
      else {
        activeRoots.delete(root);
        const remainingViews = [...activeRoots.keys()].map(visibleToRoot);
        for (const path of new Set([...dirs.keys(), ...dirReads.keys(), ...dirEpochs.keys()])) {
          if (
            dirBelongsToRoot(path, root) &&
            !remainingViews.some((isVisible) => isVisible(path))
          ) {
            dirs.delete(path);
            dirReads.delete(path);
            dirEpochs.delete(path);
            pollBackoff.delete(path);
          }
        }
      }
    }
  };
}

const listingListeners = new Set<() => void>();

/**
 * Per-directory readers (`peekDir(path)` as a snapshot) subscribe here; a
 * directory whose listing array is unchanged produces no re-render.
 */
export function subscribeDirListings(listener: () => void): () => void {
  listingListeners.add(listener);
  return () => {
    listingListeners.delete(listener);
  };
}

/** Tell listing subscribers the dir cache was replaced (e.g. after `refreshDir`). */
export function announceDirListings() {
  for (const listener of [...listingListeners]) listener();
}

/** Reload the explorer cache after an agent/shell write (debounced). */
export function notifyDirsChanged(root?: string, pollOnly = false, forcePoll = false) {
  if (typeof document !== "undefined" && document.hidden) return;
  // Resume verifies the listing immediately without pretending its content changed.
  if (forcePoll) {
    for (const path of pollBackoff.keys()) {
      if (!root || dirBelongsToRoot(path, root)) pollBackoff.delete(path);
    }
  }
  if (root) pendingRoots.add(root);
  else refreshAll = true;
  if (!pollOnly) contentChange = true;
  scheduleRefresh();
}

function scheduleRefresh() {
  if (refreshTimer != null) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void runRefresh();
  }, REFRESH_MS);
}

async function runRefresh() {
  if (refreshing) {
    refreshAgain = true;
    return;
  }
  refreshing = true;
  try {
    const roots = refreshAll ? [...activeRoots.keys()] : [...pendingRoots];
    const unscoped = refreshAll && roots.length === 0;
    const content = contentChange;
    refreshAll = false;
    contentChange = false;
    pendingRoots.clear();
    const changed = await refreshCachedDirs(unscoped ? undefined : roots, !content);
    if (changed.length || unscoped || content) {
      for (const listener of listeners)
        listener(unscoped ? undefined : content ? roots : changed, unscoped ? undefined : changed);
      announceDirListings();
    }
  } finally {
    refreshing = false;
    if (refreshAgain) {
      refreshAgain = false;
      scheduleRefresh();
    }
  }
}

/** Folder to create into, given the explorer selection. */
export function createParentOf(cwd: string, selectedPath: string | null): string {
  if (!selectedPath || selectedPath === cwd) return cwd;
  const parent = parentPath(selectedPath);
  const entry = peekDir(parent)?.find((e) => e.path === selectedPath);
  if (entry?.isDir) return selectedPath;
  if (entry && !entry.isDir) return parent;
  if (peekDir(selectedPath)) return selectedPath;
  return parent;
}

/** Directories whose children change when creating `name` under `parent`. */
export function dirsTouchedByCreate(parent: string, name: string): string[] {
  const segments = pathSegments(name);
  const out = [parent];
  let cur = parent;
  for (let i = 0; i < segments.length - 1; i++) {
    cur = joinPath(cur, segments[i]);
    out.push(cur);
  }
  return out;
}

export function dirsTouchedByMove(from: string, to: string): string[] {
  const fromParent = parentPath(from);
  const toParent = parentPath(to);
  return fromParent === toParent ? [fromParent] : [fromParent, toParent];
}

/** Folders with more visible entries than this render in chunks. */
export const TREE_WINDOW_THRESHOLD = 300;
export const TREE_WINDOW_CHUNK = 200;

/**
 * Bounded rendering for one folder: the first `limit` entries, plus any entry
 * that is, or contains, a `mustShow` path (selection, rename, drag target).
 * Original order is kept; `hidden` counts what was cut.
 */
export function windowEntries(
  entries: readonly FsEntry[],
  limit: number,
  mustShow: readonly (string | null | undefined)[],
): { shown: FsEntry[]; hidden: number } {
  if (entries.length <= TREE_WINDOW_THRESHOLD || limit >= entries.length)
    return { shown: entries as FsEntry[], hidden: 0 };
  const targets = mustShow
    .filter((path): path is string => !!path)
    .map((path) => path.replace(/\\/g, "/"));
  const shown: FsEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (i < limit) {
      shown.push(entry);
      continue;
    }
    if (!targets.length) continue;
    const base = entry.path.replace(/\\/g, "/");
    if (targets.some((path) => path === base || path.startsWith(`${base}/`))) shown.push(entry);
  }
  return { shown, hidden: entries.length - shown.length };
}
