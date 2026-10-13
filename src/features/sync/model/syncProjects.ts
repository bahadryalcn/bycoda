import { pathKey } from "../../../shared/lib/paths";
import { parseRemotePath } from "../../connections/model/remoteProjects";
import {
  loadProjectGroupAssignments,
  saveProjectGroupAssignments,
} from "../../projects/model/projectGroups";
import {
  isLocalProject,
  isRemoteProjectPath,
  knownProjectPaths,
  loadArchivedProjects,
  loadPinnedProjects,
  loadProjectRailOrder,
  loadRecents,
  looksLikeProject,
  normalizeProjectPath,
  notifyProjectPathsChanged,
  savePinnedProjects,
  saveProjectRailOrder,
} from "../../projects/model/recents";
import { dismissedProjectIds, dismissProjectIds } from "./syncAutoAdded";
import { localMachineId } from "./syncMachineId";
import { hasPulled, knownRecordIds, knownRecordValue, queueLocalChange } from "./syncPeerState";
import {
  canonicalHostPath,
  folderName,
  hostProjectId,
  isLocationProjectId,
  machineProjectId,
  machineProjectIdPrefix,
} from "./syncProjectId";
import type {
  SyncProjectPathValue,
  SyncProjectValue,
  SyncRailLayoutValue,
  SyncRecord,
} from "./syncProtocol";

// Versioned: state written for the older name-based project ids is left behind unread.
const PROJECT_ID_KEY = "bycoda.sync.localProjectIds.v3";
const KNOWN_PATHS_KEY = "bycoda.sync.remoteProjectPaths.v2";
const HOST_ENVIRONMENT_KEY = "bycoda.sync.localHostEnvironmentId";
const RAIL_LAYOUT_ID = "rail";

/** Records which host serves this machine's filesystem: it names this
 * machine's folders in their project ids, and another desktop connected to
 * that host can open them remotely. The last known value is kept while the
 * local host is briefly unreachable. */
export function setLocalHostEnvironmentId(environmentId: string): void {
  try {
    if (localStorage.getItem(HOST_ENVIRONMENT_KEY) !== environmentId)
      localStorage.setItem(HOST_ENVIRONMENT_KEY, environmentId);
  } catch {
    // ignored; folders keep their machine-based ids until it can be stored
  }
}

function localHostEnvironmentId(): string | undefined {
  try {
    return localStorage.getItem(HOST_ENVIRONMENT_KEY) || undefined;
  } catch {
    return undefined;
  }
}

function loadProjectIds(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PROJECT_ID_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

function saveProjectIds(ids: Record<string, string>): void {
  try {
    const json = JSON.stringify(ids);
    if (localStorage.getItem(PROJECT_ID_KEY) !== json) localStorage.setItem(PROJECT_ID_KEY, json);
  } catch {
    // ignored; the ids are derived again on the next capture
  }
}

/** A project's id is where its folder is: the host serving that machine plus
 * the path there. A local folder and the same folder opened as `remote://`
 * on another desktop therefore share one id, and same-named folders on two
 * machines stay two projects. A desktop without a host of its own names its
 * folders by its machine id until it has one. */
export function projectIdForPath(path: string): string | undefined {
  if (isRemoteProjectPath(path)) {
    const remote = parseRemotePath(path);
    return remote ? hostProjectId(remote.environmentId, remote.hostPath) : undefined;
  }
  const environmentId = localHostEnvironmentId();
  return environmentId
    ? hostProjectId(environmentId, path)
    : machineProjectId(localMachineId(), path);
}

export type RemoteOnlyProject = {
  projectId: string;
  /** The folder's name, for display. */
  name: string;
  path: string;
  /** The host serving the machine the folder is on, when it has one. */
  hostEnvironmentId?: string;
};

type KnownProjectPath = { path: string; archived: boolean; hostEnvironmentId?: string };
type KnownProjectPaths = Record<string, KnownProjectPath>;

function loadKnownProjectPaths(): KnownProjectPaths {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KNOWN_PATHS_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as KnownProjectPaths)
      : {};
  } catch {
    return {};
  }
}

function saveKnownProjectPaths(value: KnownProjectPaths): void {
  try {
    localStorage.setItem(KNOWN_PATHS_KEY, JSON.stringify(value));
  } catch {
    // ignored; re-learned on the next pull
  }
}

function railProjectIds(): Set<string> {
  const ids = new Set<string>();
  for (const item of [...loadRecents(), ...loadArchivedProjects()]) {
    if (!looksLikeProject(item.path)) continue;
    const id = projectIdForPath(item.path);
    if (id) ids.add(id);
  }
  return ids;
}

/** Projects sync must not put on the rail: ones the user took off it,
 * including removals the next capture has not stored yet. */
function removedProjectIds(onRail: ReadonlySet<string>): Set<string> {
  const removed = dismissedProjectIds();
  for (const id of Object.values(loadProjectIds())) if (!onRail.has(id)) removed.add(id);
  return removed;
}

function offeredProjects(): [string, KnownProjectPath][] {
  const onRail = railProjectIds();
  const removed = removedProjectIds(onRail);
  return Object.entries(loadKnownProjectPaths()).filter(
    ([projectId, entry]) =>
      !onRail.has(projectId) &&
      !removed.has(projectId) &&
      !!entry &&
      typeof entry.path === "string" &&
      looksLikeProject(entry.path) &&
      !entry.archived,
  );
}

let knownHostEnvironments: ReadonlySet<string> | undefined;

/** The host environments of the machines saved on this desktop. */
export function setKnownHostEnvironments(environmentIds: Iterable<string>): void {
  knownHostEnvironments = new Set(environmentIds);
}

/**
 * Folders that a saved machine's current host holds, from its sync records or
 * this rail. A record for the same folder under an environment no saved
 * machine has came from that machine's previous host, which was reinstalled.
 */
function currentHostFolders(known: ReadonlySet<string>): Set<string> {
  const folders = new Set<string>();
  for (const entry of Object.values(loadKnownProjectPaths())) {
    if (
      entry?.hostEnvironmentId &&
      known.has(entry.hostEnvironmentId) &&
      typeof entry.path === "string"
    )
      folders.add(canonicalHostPath(entry.path));
  }
  for (const item of [...loadRecents(), ...loadArchivedProjects()]) {
    const remote = parseRemotePath(item.path);
    if (remote && known.has(remote.environmentId)) folders.add(canonicalHostPath(remote.hostPath));
  }
  return folders;
}

/** Synced projects on another machine (not archived there) that are not on
 * this machine's rail or in its archive, and that the user has not removed
 * from it. */
export function remoteOnlyProjects(): RemoteOnlyProject[] {
  const ownEnvironmentId = localHostEnvironmentId();
  const known = knownHostEnvironments;
  const current = known
    ? currentHostFolders(ownEnvironmentId ? new Set([...known, ownEnvironmentId]) : known)
    : undefined;
  return (
    offeredProjects()
      // A folder on this machine's own host is adopted as a local project instead.
      .filter(([, entry]) => !ownEnvironmentId || entry.hostEnvironmentId !== ownEnvironmentId)
      // A previous host's copy of a folder its machine's current host also has.
      .filter(
        ([, entry]) =>
          !known ||
          !current ||
          !entry.hostEnvironmentId ||
          known.has(entry.hostEnvironmentId) ||
          !current.has(canonicalHostPath(entry.path)),
      )
      .map(([projectId, entry]) => ({
        projectId,
        name: folderName(entry.path),
        path: entry.path,
        ...(entry.hostEnvironmentId ? { hostEnvironmentId: entry.hostEnvironmentId } : {}),
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.projectId.localeCompare(b.projectId))
  );
}

/** Synced projects whose folder is on this machine (their record names this
 * machine's own host) but that are not on its rail or in its archive: another
 * desktop opened the folder remotely. Excludes ones the user removed here. */
export function locallyAdoptableProjects(): { projectId: string; path: string }[] {
  const ownEnvironmentId = localHostEnvironmentId();
  if (!ownEnvironmentId) return [];
  return offeredProjects()
    .filter(([, entry]) => entry.hostEnvironmentId === ownEnvironmentId)
    .map(([projectId, entry]) => ({ projectId, path: entry.path }));
}

/** This machine's full pathKey→projectId map, for callers that need to turn
 * a `projectGroupAssignments` or appearance key into the sync id for that
 * same project. Covers local folders and `remote://` rail projects. */
export function localProjectIdsByPath(): Record<string, string> {
  return loadProjectIds();
}

/** The reverse lookup: which rail pathKey (if any) this machine has for a
 * given projectId. Used to apply an incoming record, which only carries the
 * projectId. */
export function localPathKeyForProjectId(projectId: string): string | undefined {
  for (const [key, id] of Object.entries(loadProjectIds())) {
    if (id === projectId) return key;
  }
  return undefined;
}

/** Hide an unopened suggestion on this desktop without touching its source. */
export function dismissRemoteProject(projectId: string): void {
  if (!offeredProjects().some(([id]) => id === projectId)) return;
  dismissProjectIds([projectId]);
  notifyProjectPathsChanged();
}

/** The local path (as stored) this machine has for a projectId, if any. */
export function localPathForProjectId(projectId: string): string | undefined {
  const key = localPathKeyForProjectId(projectId);
  if (!key) return undefined;
  return knownProjectPaths().find((path) => pathKey(path) === key);
}

function pathsToIds(paths: readonly string[]): string[] {
  const ids = loadProjectIds();
  return paths.flatMap((path) => {
    const id = ids[pathKey(path)];
    return id ? [id] : [];
  });
}

/** The last host layout, without ids that can never resolve again: those of
 * the older name-based scheme, and this desktop's own machine-based ids once
 * it has a host. */
function lastHostLayout(
  machineId: string,
  hostEnvironmentId: string | undefined,
): SyncRailLayoutValue {
  const raw = knownRecordValue(machineId, "railLayout", RAIL_LAYOUT_ID) as
    | Partial<SyncRailLayoutValue>
    | null
    | undefined;
  const ownMachinePrefix = machineProjectIdPrefix(localMachineId());
  const ids = (list: unknown): string[] =>
    Array.isArray(list)
      ? list.filter(
          (item): item is string =>
            typeof item === "string" &&
            isLocationProjectId(item) &&
            !(hostEnvironmentId && item.startsWith(ownMachinePrefix)),
        )
      : [];
  return { order: ids(raw?.order), pinned: ids(raw?.pinned) };
}

/** Merges the local rail order/pins into the last host layout so that, when
 * nothing changed locally, the result equals the host layout exactly. Ids
 * this machine does not own keep their host positions. */
export function mergeRailLayout(
  host: SyncRailLayoutValue,
  localOrderIds: readonly string[],
  localPinnedIds: readonly string[],
  owned: ReadonlySet<string>,
): SyncRailLayoutValue {
  const localOrder = localOrderIds.filter(
    (id, i) => owned.has(id) && localOrderIds.indexOf(id) === i,
  );
  const hostSet = new Set(host.order);
  const localInHost = localOrder.filter((id) => hostSet.has(id));
  const inLocal = new Set(localInHost);
  const queue = [...localInHost];
  const order = host.order.map((id) => (owned.has(id) && inLocal.has(id) ? queue.shift()! : id));
  for (const id of localOrder) if (!hostSet.has(id)) order.push(id);

  const localPinned = new Set(localPinnedIds.filter((id) => owned.has(id)));
  const pinned = host.pinned.filter((id) => !owned.has(id) || localPinned.has(id));
  const pinnedSet = new Set(pinned);
  for (const id of localPinnedIds) {
    if (localPinned.has(id) && !pinnedSet.has(id)) {
      pinned.push(id);
      pinnedSet.add(id);
    }
  }
  return { order, pinned };
}

const railOwnedKey = (machineId: string) => `bycoda.sync.railOwned.v2:${machineId}`;

/** Ids whose rail slot this machine has already taken over from the peer. */
function loadRailOwned(machineId: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(railOwnedKey(machineId)) ?? "[]");
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    return new Set();
  }
}

function saveRailOwned(machineId: string, ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(railOwnedKey(machineId), JSON.stringify([...ids]));
  } catch {
    // ignored; the ids are adopted again next capture, which is idempotent
  }
}

function idsToPaths(ids: readonly string[]): string[] {
  return ids.flatMap((id) => {
    const path = localPathForProjectId(id);
    return path ? [path] : [];
  });
}

function applyRailOrder(order: readonly string[]): void {
  const synced = idsToPaths(order);
  const included = new Set(synced.map(pathKey));
  saveProjectRailOrder([
    ...synced,
    ...loadProjectRailOrder().filter((path) => !included.has(pathKey(path))),
  ]);
}

/** A project whose id moved to another rail path (a `remote://` entry for a
 * folder on this machine replaced by the folder itself, or back) keeps its
 * group, so the next assignment capture does not read the move as the user
 * taking it out of the group. */
function carryAssignments(previous: Record<string, string>, next: Record<string, string>): void {
  const previousKeyById = new Map(Object.entries(previous).map(([key, id]) => [id, key]));
  const moved = Object.entries(next).flatMap(([key, id]) => {
    const oldKey = previousKeyById.get(id);
    return oldKey && oldKey !== key ? [[oldKey, key] as const] : [];
  });
  if (moved.length === 0) return;
  const assignments = loadProjectGroupAssignments();
  let changed = false;
  for (const [oldKey, key] of moved) {
    if (!assignments[oldKey] || assignments[key]) continue;
    assignments[key] = assignments[oldKey];
    changed = true;
  }
  if (changed) saveProjectGroupAssignments(assignments);
}

/** Queues this machine's rail projects and current rail layout (as project
 * ids) for the given peer. A project's projectPath record is stored under its
 * id, so the machine that holds the folder and a desktop that opened it
 * remotely describe it with one record. The holder keeps it current; a
 * desktop that opened it remotely only announces a folder the host has no
 * record of, so the holder learns of a folder it never opened itself.
 * Safe to call often: queueLocalChange drops any op whose value already
 * matches what the host has. */
export function captureLocalProjectChanges(machineId: string): void {
  const railPaths = [
    ...loadRecents().map((item) => item.path),
    ...loadArchivedProjects().map((item) => item.path),
  ];
  const archived = new Set(loadArchivedProjects().map((item) => pathKey(item.path)));
  const hostEnvironmentId = localHostEnvironmentId();
  const owners: Record<string, string> = {};
  const claimed = new Set<string>();
  const claim = (path: string): string | undefined => {
    const key = pathKey(path);
    if (key in owners) return undefined;
    const projectId = projectIdForPath(path);
    if (!projectId || claimed.has(projectId)) return undefined;
    claimed.add(projectId);
    owners[key] = projectId;
    return projectId;
  };
  for (const path of railPaths.filter(isLocalProject)) {
    const projectId = claim(path);
    if (!projectId) continue;
    const projectValue: SyncProjectValue = { id: projectId, createdAt: 0 };
    queueLocalChange(machineId, "project", projectId, projectValue);
    // `archived` is the state on the machine that holds the folder, and only
    // that machine writes it: what another desktop archives stays its own.
    const pathValue: SyncProjectPathValue = {
      projectId,
      path: normalizeProjectPath(path),
      archived: archived.has(pathKey(path)),
      ...(hostEnvironmentId ? { hostEnvironmentId } : { machineId: localMachineId() }),
    };
    queueLocalChange(machineId, "projectPath", projectId, pathValue);
  }
  for (const path of railPaths) {
    if (!isRemoteProjectPath(path) || !looksLikeProject(path)) continue;
    const projectId = claim(path);
    if (!projectId) continue;
    const remote = parseRemotePath(path);
    if (!remote || remote.environmentId === hostEnvironmentId || archived.has(pathKey(path)))
      continue;
    if (knownRecordValue(machineId, "projectPath", projectId) != null) continue;
    const projectValue: SyncProjectValue = { id: projectId, createdAt: 0 };
    queueLocalChange(machineId, "project", projectId, projectValue);
    const pathValue: SyncProjectPathValue = {
      projectId,
      hostEnvironmentId: remote.environmentId,
      path: remote.hostPath,
      archived: false,
    };
    queueLocalChange(machineId, "projectPath", projectId, pathValue);
  }
  const previous = loadProjectIds();
  carryAssignments(previous, owners);
  dismissProjectIds(Object.values(previous).filter((id) => !claimed.has(id)));
  saveProjectIds(owners);
  if (hostEnvironmentId) {
    // Records pushed while this desktop had no host describe the same folders
    // under ids nothing resolves any more.
    const ownMachinePrefix = machineProjectIdPrefix(localMachineId());
    for (const id of knownRecordIds(machineId, "projectPath")) {
      if (id.startsWith(ownMachinePrefix)) queueLocalChange(machineId, "projectPath", id, null);
    }
  }
  // An empty or smaller local layout must not replace a host layout this machine has not read yet.
  if (!hasPulled(machineId)) return;
  const host = lastHostLayout(machineId, hostEnvironmentId);
  // A project that just appeared here takes the slot and pin the host already
  // has for it; only later edits made on this machine count as local changes.
  const railOwned = loadRailOwned(machineId);
  const inHost = new Set([...host.order, ...host.pinned]);
  const adopted = new Set([...claimed].filter((id) => !railOwned.has(id) && inHost.has(id)));
  const owned = adopted.size > 0 ? new Set([...claimed].filter((id) => !adopted.has(id))) : claimed;
  const layout = mergeRailLayout(
    host,
    pathsToIds(loadProjectRailOrder()),
    pathsToIds(loadPinnedProjects()),
    owned,
  );
  if (adopted.size > 0) {
    applyRailOrder(layout.order);
    const pins = loadPinnedProjects();
    const pinnedKeys = new Set(pins.map(pathKey));
    const newPins = idsToPaths(layout.pinned.filter((id) => adopted.has(id))).filter(
      (path) => !pinnedKeys.has(pathKey(path)),
    );
    if (newPins.length > 0) savePinnedProjects([...pins, ...newPins]);
  }
  if (claimed.size !== railOwned.size || [...claimed].some((id) => !railOwned.has(id))) {
    saveRailOwned(machineId, claimed);
  }
  queueLocalChange(machineId, "railLayout", RAIL_LAYOUT_ID, layout);
}

/** The id a projectPath record's own fields give it. A record stored under
 * any other id (the older name-based scheme) is not trusted. */
function recordProjectId(value: SyncProjectPathValue): string | undefined {
  if (typeof value.path !== "string" || !value.path) return undefined;
  if (typeof value.hostEnvironmentId === "string" && value.hostEnvironmentId)
    return hostProjectId(value.hostEnvironmentId, value.path);
  if (typeof value.machineId === "string" && value.machineId)
    return machineProjectId(value.machineId, value.path);
  return undefined;
}

/** Applies incoming projectPath/railLayout records. Every project folder the
 * host knows is remembered, so the rail can offer the ones missing here:
 * opened remotely when their host is connected to this desktop, adopted as a
 * local project when the folder is on this machine, otherwise a placeholder. */
export function applyRemoteProjectRecords(machineId: string, records: readonly SyncRecord[]): void {
  const known = loadKnownProjectPaths();
  const ownMachinePrefix = machineProjectIdPrefix(localMachineId());
  let knownChanged = false;
  for (const record of records) {
    if (record.table === "projectPath") {
      if (!isLocationProjectId(record.id) || record.id.startsWith(ownMachinePrefix)) continue;
      const value = record.value as SyncProjectPathValue | null;
      if (!value) {
        if (record.id in known) {
          delete known[record.id];
          knownChanged = true;
        }
        continue;
      }
      if (recordProjectId(value) !== record.id) continue;
      known[record.id] = {
        path: value.path,
        archived: value.archived === true,
        ...(value.hostEnvironmentId ? { hostEnvironmentId: value.hostEnvironmentId } : {}),
      };
      knownChanged = true;
    } else if (record.table === "railLayout") {
      const value = record.value as SyncRailLayoutValue | null;
      if (!value || !Array.isArray(value.order) || !Array.isArray(value.pinned)) continue;
      applyRailOrder(value.order);
      // A pin of a project the layout does not cover (no id here, or not pushed yet) is kept.
      const ids = loadProjectIds();
      const covered = new Set([...value.order, ...value.pinned]);
      const keptPins = loadPinnedProjects().filter((path) => {
        const id = ids[pathKey(path)];
        return !id || !covered.has(id);
      });
      savePinnedProjects([...idsToPaths(value.pinned), ...keptPins]);
    }
    // "project" records carry only an id, nothing to apply locally.
  }
  if (knownChanged) {
    saveKnownProjectPaths(known);
    notifyProjectPathsChanged();
  }
  void machineId;
}
