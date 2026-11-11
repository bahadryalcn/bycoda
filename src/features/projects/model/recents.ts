import { useMemo, useSyncExternalStore } from "react";
import {
  requirePrivacyMutationToken,
  withRoomPrivacyMutation,
  type PrivacyMutationToken,
} from "../../group-lock/model/roomPrivacyProjection";
import {
  isRemoteProjectPath,
  normalizeProjectPath,
  pathKey,
  prettyCwd,
  sameProjectPath,
  slash,
} from "../../../shared/lib/paths";
export {
  isRemoteProjectPath,
  normalizeProjectPath,
  sameProjectPath,
} from "../../../shared/lib/paths";
import { REMOTE_PATH_PREFIX } from "../../../shared/lib/remotePaths";

const KEY = "bycoda.recentProjects";
const RAIL_ORDER_KEY = "bycoda.projectRailOrder";
const RAIL_PINNED_KEY = "bycoda.projectRailPinned";
const ARCHIVED_KEY = "bycoda.archivedProjects";
const ARCHIVED_CHANGED = "bycoda:archived-projects-changed";
const PROJECT_PATHS_CHANGED = "bycoda:project-paths-changed";
const RAIL_ORDER_CHANGED = "bycoda:project-rail-order-changed";
// The rail lists every remembered project, so this also bounds how many a
// bulk import (history from another tool) can bring in.
const MAX = 200;

export type RecentProject = {
  path: string;
  openedAt: number;
};

export type ArchivedProject = {
  path: string;
  archivedAt: number;
};

function normalize(path: string): string {
  return normalizeProjectPath(path);
}

export function loadRecents(): RecentProject[] {
  try {
    return parseRecents(localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

function parseRecents(raw: string | null): RecentProject[] {
  try {
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: RecentProject[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const rec = item as { path?: unknown; openedAt?: unknown };
      if (typeof rec.path !== "string" || !rec.path) continue;
      const openedAt =
        typeof rec.openedAt === "number" && Number.isFinite(rec.openedAt) ? rec.openedAt : 0;
      out.push({ path: normalize(rec.path), openedAt });
    }
    return out;
  } catch {
    return [];
  }
}

function recentsSnapshot(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** `loadRecents` for render: re-renders the caller when the recent projects are saved. */
export function useRecents(): RecentProject[] {
  const raw = useSyncExternalStore(subscribeProjectPathsChanged, recentsSnapshot, () => null);
  return useMemo(() => parseRecents(raw), [raw]);
}

function save(next: RecentProject[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    notifyProjectPathsChanged();
  } catch {
    // private mode / quota
  }
}

export function rememberProjectInMutation(
  path: string,
  token: PrivacyMutationToken,
): RecentProject[] {
  requirePrivacyMutationToken(token);
  return rememberProjectNow(path);
}

export function rememberProject(path: string): Promise<RecentProject[]> {
  return withRoomPrivacyMutation((token) => rememberProjectInMutation(path, token));
}

function rememberProjectNow(path: string): RecentProject[] {
  const normalized = normalize(path);
  if (normalized === "~") return loadRecents();
  dropArchived(normalized);
  if (loadArchivedProjects().some((item) => sameProjectPath(item.path, normalized)))
    throw new Error("Could not restore the project from archive.");
  const prev = loadRecents().filter((p) => !sameProjectPath(p.path, normalized));
  const next = [{ path: normalized, openedAt: Date.now() }, ...prev].slice(0, MAX);
  save(next);
  if (localStorage.getItem(KEY) !== JSON.stringify(next))
    throw new Error("Could not save recent projects.");
  return next;
}

/** Paths in `after` that were not among the project paths in `before`. */
export function newProjectPaths(before: Iterable<string>, after: readonly string[]): string[] {
  const known = new Set<string>();
  for (const path of before) known.add(pathKey(path));
  return after.filter((path) => !known.has(pathKey(path)));
}

/**
 * Adds projects to the rail without disturbing it: they go after the current
 * ones, newest activity first, stamped with when they were last used rather
 * than now, so a bulk import does not push the projects being worked on down
 * the list. Archived projects stay archived and known ones are left as they are.
 */
export function rememberImportedProjects(
  entries: readonly { path: string; lastUsedAt: number }[],
): RecentProject[] {
  const current = loadRecents();
  const archived = loadArchivedProjects();
  const added: RecentProject[] = [];
  for (const entry of [...entries].sort((a, b) => b.lastUsedAt - a.lastUsedAt)) {
    const path = normalize(entry.path);
    if (
      path === "~" ||
      current.some((item) => sameProjectPath(item.path, path)) ||
      added.some((item) => sameProjectPath(item.path, path)) ||
      archived.some((item) => sameProjectPath(item.path, path))
    ) {
      continue;
    }
    added.push({ path, openedAt: Math.max(0, entry.lastUsedAt) });
  }
  if (added.length === 0) return current;
  const next = [...current, ...added].slice(0, MAX);
  save(next);
  return next;
}

function replacePath(paths: string[], from: string, to: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const next = sameProjectPath(path, from) ? to : path;
    const key = pathKey(next);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }
  return out;
}

/** Replace a renamed project's path everywhere the project rail stores it. */
export function replaceProjectPath(from: string, to: string): RecentProject[] {
  const previous = normalize(from);
  const nextPath = normalize(to);
  if (sameProjectPath(previous, nextPath)) return loadRecents();

  const recents: RecentProject[] = [];
  const seen = new Set<string>();
  for (const item of loadRecents()) {
    const path = sameProjectPath(item.path, previous) ? nextPath : item.path;
    const key = pathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    recents.push({ ...item, path });
  }
  save(recents);
  saveProjectRailOrder(replacePath(loadProjectRailOrder(), previous, nextPath));
  savePinnedProjects(replacePath(loadPinnedProjects(), previous, nextPath));

  const archived = loadArchivedProjects();
  if (archived.some((item) => sameProjectPath(item.path, previous))) {
    const replaced: ArchivedProject[] = [];
    const archivedSeen = new Set<string>();
    for (const item of archived) {
      const path = sameProjectPath(item.path, previous) ? nextPath : item.path;
      const key = pathKey(path);
      if (archivedSeen.has(key)) continue;
      archivedSeen.add(key);
      replaced.push({ ...item, path });
    }
    saveArchived(replaced);
  }
  notifyProjectPathsChanged();
  return recents;
}

/** Rail projects, pins, groups, or their appearance changed in storage. */
export function notifyProjectPathsChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PROJECT_PATHS_CHANGED));
  }
}

export function subscribeProjectPathsChanged(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(PROJECT_PATHS_CHANGED, onChange);
  return () => window.removeEventListener(PROJECT_PATHS_CHANGED, onChange);
}

/** Drops a project from the rail: its recent entry, saved order slot, and pin. */
function dropFromRail(path: string): RecentProject[] {
  const normalized = normalize(path);
  const next = loadRecents().filter((item) => !sameProjectPath(item.path, normalized));
  save(next);
  saveProjectRailOrder(
    loadProjectRailOrder().filter((entry) => !sameProjectPath(entry, normalized)),
  );
  savePinnedProjects(loadPinnedProjects().filter((entry) => !sameProjectPath(entry, normalized)));
  return next;
}

/** Removes a project from the rail and from the archive (Delete). */
export function forgetProject(path: string): RecentProject[] {
  dropArchived(path);
  return dropFromRail(path);
}

/** Removes a project from the rail and files it in the archive (Archive). */
export function archiveProject(path: string): RecentProject[] {
  const normalized = normalize(path);
  if (!looksLikeProject(normalized)) return loadRecents();
  const recents = dropFromRail(normalized);
  const rest = loadArchivedProjects().filter((item) => !sameProjectPath(item.path, normalized));
  saveArchived([{ path: normalized, archivedAt: Date.now() }, ...rest]);
  return recents;
}

/**
 * Archived-project read with its outcome. `unavailable` means the stored value
 * could not be read or is not a list, which is different from a genuinely empty
 * archive; callers must not present it as "No archived projects".
 */
export type ArchivedProjectsRead = { state: "ready" | "unavailable"; items: ArchivedProject[] };

export function readArchivedProjects(): ArchivedProjectsRead {
  try {
    const raw = localStorage.getItem(ARCHIVED_KEY);
    if (!raw) return { state: "ready", items: [] };
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { state: "unavailable", items: [] };
    const out: ArchivedProject[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const rec = item as { path?: unknown; archivedAt?: unknown };
      if (typeof rec.path !== "string" || !rec.path) continue;
      const path = normalize(rec.path);
      const key = pathKey(path);
      if (seen.has(key) || !looksLikeProject(path)) continue;
      seen.add(key);
      const archivedAt =
        typeof rec.archivedAt === "number" && Number.isFinite(rec.archivedAt) ? rec.archivedAt : 0;
      out.push({ path, archivedAt });
    }
    return { state: "ready", items: out };
  } catch {
    return { state: "unavailable", items: [] };
  }
}

export function loadArchivedProjects(): ArchivedProject[] {
  return readArchivedProjects().items;
}

export function subscribeArchivedProjects(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(ARCHIVED_CHANGED, onChange);
  return () => window.removeEventListener(ARCHIVED_CHANGED, onChange);
}

function saveArchived(next: ArchivedProject[]) {
  try {
    localStorage.setItem(ARCHIVED_KEY, JSON.stringify(next));
    notifyProjectPathsChanged();
  } catch {
    // private mode / quota
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(ARCHIVED_CHANGED));
  }
}

function dropArchived(path: string) {
  const normalized = normalize(path);
  const prev = loadArchivedProjects();
  const next = prev.filter((item) => !sameProjectPath(item.path, normalized));
  if (next.length === prev.length) return;
  saveArchived(next);
}

/** Most recently opened project, if any. Used to restore the folder on launch. */
export function lastProjectPath(): string | null {
  for (const item of loadRecents()) {
    if (looksLikeProject(item.path)) return item.path;
  }
  return null;
}

export type ProjectRailSections = {
  pinned: RecentProject[];
  projects: RecentProject[];
};

function readPathList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (typeof item !== "string" || !item) continue;
      const path = normalize(item);
      const normalized = pathKey(path);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(path);
    }
    return out;
  } catch {
    return [];
  }
}

function savePathList(key: string, paths: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(paths));
  } catch {
    // private mode / quota
  }
}

export function loadProjectRailOrder(): string[] {
  return readPathList(RAIL_ORDER_KEY);
}

export function saveProjectRailOrder(order: string[]) {
  const next = order.map(normalize);
  const previous = loadProjectRailOrder();
  if (next.length === previous.length && next.every((path, index) => path === previous[index]))
    return;
  savePathList(RAIL_ORDER_KEY, next);
  // Not a rail-wide announcement (see `commitProjectRailOrder`): only `useProjectRailLayout` listens.
  if (typeof window !== "undefined") window.dispatchEvent(new Event(RAIL_ORDER_CHANGED));
}

export function loadPinnedProjects(): string[] {
  return readPathList(RAIL_PINNED_KEY);
}

export function savePinnedProjects(pinned: string[]) {
  savePathList(RAIL_PINNED_KEY, pinned.map(normalize));
  notifyProjectPathsChanged();
}

export function toggleProjectPin(path: string): void {
  const pinned = loadPinnedProjects();
  savePinnedProjects(
    pinned.some((item) => sameProjectPath(item, path))
      ? pinned.filter((item) => !sameProjectPath(item, path))
      : [...pinned, path],
  );
}

/** Every project path we still remember — rail, pins, saved order, archive. */
export function knownProjectPaths(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const paths = [
    ...loadRecents().map((item) => item.path),
    ...loadProjectRailOrder(),
    ...loadPinnedProjects(),
    ...loadArchivedProjects().map((item) => item.path),
  ];
  for (const path of paths) {
    const key = pathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalize(path));
  }
  return out;
}

/** All projects for the rail, keyed by normalized path. */
export function collectRailProjects(
  recents: RecentProject[],
  currentCwd: string,
): Map<string, RecentProject> {
  return collectRailProjectsAt(recents, currentCwd, Date.now());
}

/** `collectRailProjects` with the time a not-yet-remembered current folder counts as opened. */
function collectRailProjectsAt(
  recents: RecentProject[],
  currentCwd: string,
  now: number,
): Map<string, RecentProject> {
  const map = new Map<string, RecentProject>();
  for (const item of recents) {
    if (!looksLikeProject(item.path)) continue;
    const path = normalize(item.path);
    map.set(pathKey(path), { path, openedAt: item.openedAt });
  }
  if (currentCwd && looksLikeProject(currentCwd)) {
    const path = normalize(currentCwd);
    const key = pathKey(path);
    if (!map.has(key)) {
      map.set(key, { path, openedAt: now });
    }
  }
  return map;
}

/** Append new projects to the saved order without moving existing entries. */
export function syncProjectRailOrder(
  order: string[],
  projects: Map<string, RecentProject>,
): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const path of order) {
    const key = pathKey(path);
    const project = projects.get(key);
    if (!project || seen.has(key)) continue;
    seen.add(key);
    next.push(project.path);
  }
  const newcomers = [...projects.entries()]
    .filter(([key]) => !seen.has(key))
    .sort(([, a], [, b]) => b.openedAt - a.openedAt)
    .map(([, project]) => project.path);
  return [...next, ...newcomers];
}

export function projectRailSections(
  recents: RecentProject[],
  currentCwd: string,
  order: string[],
  pinnedPaths: string[],
): ProjectRailSections {
  return projectRailSectionsAt(recents, currentCwd, order, pinnedPaths, Date.now());
}

function projectRailSectionsAt(
  recents: RecentProject[],
  currentCwd: string,
  order: string[],
  pinnedPaths: string[],
  now: number,
): ProjectRailSections {
  const projects = collectRailProjectsAt(recents, currentCwd, now);
  const syncedOrder = syncProjectRailOrder(order, projects);
  const pinnedSet = new Set(pinnedPaths.map(pathKey));
  const pinned: RecentProject[] = [];
  const unpinned: RecentProject[] = [];
  for (const path of syncedOrder) {
    const key = pathKey(path);
    const item = projects.get(key);
    if (!item) continue;
    if (pinnedSet.has(key)) pinned.push(item);
    else unpinned.push(item);
  }
  return { pinned, projects: unpinned };
}

/** Recents plus the current folder when it is a project not yet remembered. */
export function projectRailItems(recents: RecentProject[], currentCwd: string): RecentProject[] {
  return railItemsAt(recents, currentCwd, loadProjectRailOrder(), loadPinnedProjects(), Date.now());
}

function railItemsAt(
  recents: RecentProject[],
  currentCwd: string,
  order: string[],
  pinnedPaths: string[],
  now: number,
): RecentProject[] {
  const projects = collectRailProjectsAt(recents, currentCwd, now);
  const { pinned, projects: unpinned } = projectRailSectionsAt(
    recents,
    currentCwd,
    syncProjectRailOrder(order, projects),
    pinnedPaths,
    now,
  );
  return [...pinned, ...unpinned];
}

/**
 * `projectRailItems` with the saved order and pins given (see `useProjectRailLayout`), so
 * render reads no store. A current folder that is not remembered yet counts as opened after
 * every recent project, which is where `Date.now()` puts it, without reading the clock.
 */
export function projectRailItemsFrom(
  recents: RecentProject[],
  currentCwd: string,
  layout: ProjectRailLayout,
): RecentProject[] {
  const newest = recents.reduce((latest, item) => Math.max(latest, item.openedAt), 0);
  return railItemsAt(recents, currentCwd, layout.order, layout.pinned, newest + 1);
}

export type ProjectRailLayout = { order: string[]; pinned: string[] };

let layoutCache: { key: string; layout: ProjectRailLayout } | null = null;

/** The saved order and pins, with one object identity while the stored text is unchanged. */
function projectRailLayoutSnapshot(): ProjectRailLayout {
  let key = "";
  try {
    key = `${localStorage.getItem(RAIL_ORDER_KEY)}
${localStorage.getItem(RAIL_PINNED_KEY)}`;
  } catch {
    /* storage unavailable: nothing saved */
  }
  if (layoutCache?.key !== key)
    layoutCache = {
      key,
      layout: { order: loadProjectRailOrder(), pinned: loadPinnedProjects() },
    };
  return layoutCache.layout;
}

const NO_LAYOUT: ProjectRailLayout = { order: [], pinned: [] };

function subscribeProjectRailLayout(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const stop = subscribeProjectPathsChanged(onChange);
  window.addEventListener(RAIL_ORDER_CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    stop();
    window.removeEventListener(RAIL_ORDER_CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The saved rail order and pins for render: re-renders the caller when either is saved. */
export function useProjectRailLayout(): ProjectRailLayout {
  return useSyncExternalStore(
    subscribeProjectRailLayout,
    projectRailLayoutSnapshot,
    () => NO_LAYOUT,
  );
}

/** True if this looks like a user project, not an app bundle or system root. */
/** Projects on another machine use `remote://<host id>/<host path>` keys. They
 * appear in the rail like any project, but are never folders on this computer. */
export const REMOTE_PROJECT_PREFIX = REMOTE_PATH_PREFIX;

/** A project folder on this computer: safe to index, search, or run git and
 * terminals in. Use `looksLikeProject` where a remote project also counts. */
export function isLocalProject(path: string): boolean {
  return looksLikeProject(path) && !isRemoteProjectPath(path);
}

/** A local folder the project terminal can start in. Home is not a project
 * (never indexed), but a shell there needs no indexing. */
export function canOpenTerminalIn(path: string): boolean {
  return isLocalProject(path) || (!!path && prettyCwd(path) === "~");
}

export function looksLikeProject(path: string): boolean {
  if (!path || path === "/" || path === "~") return false;
  // Provider plugin references are links, not filesystem projects. Keep the
  // app's remote filesystem keys, but reject other URI schemes.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(slash(path)) && !isRemoteProjectPath(path)) return false;
  const normalized = slash(path).replace(/\/+$/, "") || "/";
  if (/^[A-Za-z]:$/.test(normalized) || normalized === "/") return false;
  // Home itself arrives expanded (`/Users/me`), so the `~` check above misses
  // it. Indexing it walks `~/Library`, which trips the OS consent prompt.
  if (prettyCwd(path) === "~") return false;
  if (path.includes(".app/") || path.includes(".app\\")) return false;
  return true;
}
