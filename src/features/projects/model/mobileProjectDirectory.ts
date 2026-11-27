import type { DesktopConcealedGroups, DesktopProjectDirectory } from "../../connections";
import { getGroupLockView } from "../../group-lock/model/groupLock";
import { NOTHING_LOCKED, type LockSnapshot } from "../../group-lock/model/lockState";
import { pathKey, projectKey, projectName } from "../../../shared/lib/paths";
import { projectDisplayName } from "./projectNames";
import {
  loadTabGroupLabels,
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupMascot,
} from "../../workspace/model/tabGroups";
import { projectMascot } from "./projectMascots";
import {
  loadProjectGroupAssignments,
  projectGroupColor,
  projectGroupParentId,
  projectGroupWorkspaceRoot,
  type ProjectGroup,
} from "./projectGroups";
import {
  isLocalProject,
  loadArchivedProjects,
  loadPinnedProjects,
  loadRecents,
  projectRailItems,
} from "./recents";
import { loadSessionFolders } from "../../sessions/public/sessionFolders";
import { loadSessionOrder } from "../../sessions/public/sessionOrder";
import { DIRECTORY_STORAGE_PREFIXES, directoryStorageGeneration } from "./directoryStorageSignal";

/** Projects the desktop can already show; this does not unlock or change any group. */
export function projectMobileDirectory(input: {
  paths: readonly string[];
  groups: readonly ProjectGroup[];
  assignments: Record<string, string>;
  lock: LockSnapshot;
  /** Groups the owner hid; they are listed by name only, apart from password-locked ones. */
  hiddenGroupIds?: ReadonlySet<string>;
  labels?: Record<string, string>;
  /** Rail pins; only ungrouped projects show as pinned, as on the desktop rail. */
  pinned?: readonly string[];
}): DesktopProjectDirectory {
  const labels = input.labels ?? loadTabGroupLabels();
  const colors = loadTabGroupColors();
  const customColors = loadTabGroupCustomColors();
  const mascots = loadTabGroupMascots();
  const groups = input.groups.filter((group) => !input.lock.lockedGroupIds.has(group.id));
  const groupIds = new Set(groups.map((group) => group.id));
  const workspaceGroups = new Map(
    groups.flatMap((group) => {
      const root = projectGroupWorkspaceRoot(group);
      return root ? [[pathKey(root), group.id] as const] : [];
    }),
  );
  const seen = new Set<string>();
  const pinned = new Set((input.pinned ?? []).map(pathKey));
  const projects: DesktopProjectDirectory["projects"] = [];
  const paths = [
    ...input.paths,
    ...groups.flatMap((group) => {
      const root = projectGroupWorkspaceRoot(group);
      return root ? [root] : [];
    }),
  ];
  for (const cwd of paths) {
    const key = pathKey(cwd);
    if (!isLocalProject(cwd) || seen.has(key) || input.lock.lockedProjectKeys.has(key)) continue;
    seen.add(key);
    const assigned = input.assignments[key] ?? workspaceGroups.get(key);
    const folders = loadSessionFolders(cwd).map(
      ({ id, name, sessionIds, collapsed, ordered, parentId, pinned }) => ({
        id,
        name,
        sessionIds,
        collapsed,
        ordered,
        parentId,
        pinned,
      }),
    );
    const order = loadSessionOrder(cwd);
    const seed = projectName(cwd);
    const mascot = projectMascot(seed, resolveTabGroupMascot(projectKey(cwd), mascots));
    projects.push({
      cwd,
      name: projectDisplayName(cwd, labels),
      appearance: {
        color: resolveTabGroupColor(projectKey(cwd), colors, customColors, seed),
        icon: { path: mascot.restPath, highlight: mascot.highlight },
      },
      ...(assigned && groupIds.has(assigned) ? { groupId: assigned } : {}),
      ...(folders.length || order.loose?.length || order.pinned?.length
        ? { sessionLayout: { folders, order } }
        : {}),
      ...(!assigned && pinned.has(key) ? { pinned: true } : {}),
    });
  }
  return {
    version: 1,
    projects,
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      color: projectGroupColor(group),
      collapsed: group.collapsed,
      ...(group.mascot
        ? {
            appearance: {
              color: projectGroupColor(group),
              icon: {
                path: projectMascot(group.id, group.mascot).restPath,
                highlight: projectMascot(group.id, group.mascot).highlight,
              },
            },
          }
        : {}),
    })),
    excludedPaths: [...input.lock.lockedProjectKeys],
    excludedGroupIds: [...input.lock.lockedGroupIds],
    ...(input.lock.lockedGroupIds.size ? { concealed: concealedGroups(input) } : {}),
  };
}

/**
 * Password-locked and hidden groups, for the local Host only: it shows a phone a
 * locked group's name, or its projects once that phone holds a grant, and the
 * hidden names after the hidden-list password. Nothing here unlocks the desktop.
 */
function concealedGroups(
  input: Parameters<typeof projectMobileDirectory>[0],
): DesktopConcealedGroups {
  const hiddenIds = input.hiddenGroupIds ?? new Set<string>();
  const byId = new Map(input.groups.map((group) => [group.id, group]));
  const parentOf = (group: ProjectGroup): string | undefined =>
    projectGroupParentId(group, input.groups, input.assignments);
  const underHidden = (group: ProjectGroup): boolean => {
    let current: ProjectGroup | undefined = group;
    for (let depth = 0; current && depth < 32; depth += 1) {
      if (hiddenIds.has(current.id)) return true;
      const parentId = parentOf(current);
      current = parentId ? byId.get(parentId) : undefined;
    }
    return false;
  };
  const lockedIds = new Set(
    input.groups
      .filter((group) => input.lock.lockedGroupIds.has(group.id) && !underHidden(group))
      .map((group) => group.id),
  );
  // A second build with nothing locked yields the rows the phone gets for an open group.
  const open = projectMobileDirectory({
    ...input,
    lock: NOTHING_LOCKED,
    hiddenGroupIds: undefined,
  });
  return {
    locked: open.groups
      .filter((group) => lockedIds.has(group.id))
      .map((group) => {
        const parentId = byId.has(group.id) ? parentOf(byId.get(group.id)!) : undefined;
        return {
          ...group,
          ...(parentId ? { parentId } : {}),
          projects: open.projects.filter((project) => project.groupId === group.id),
        };
      }),
    hidden: input.groups
      .filter((group) => hiddenIds.has(group.id) && input.lock.lockedGroupIds.has(group.id))
      .map((group) => ({ id: group.id, name: group.name, color: projectGroupColor(group) })),
  };
}

const lockViewIds = new WeakMap<object, number>();
let nextLockViewId = 0;
let lastBuild: { inputs: string; directory: DesktopProjectDirectory } | undefined;

/** A cheap fingerprint of everything the build reads. While storage writes can be
 * observed it holds the write counter, not the stored strings, so an unchanged tick
 * never touches storage; otherwise it falls back to the raw stored strings. */
function directoryInputs(currentPaths: readonly string[], view: object): string {
  let viewId = lockViewIds.get(view);
  if (viewId === undefined) lockViewIds.set(view, (viewId = ++nextLockViewId));
  const generation = directoryStorageGeneration();
  if (generation !== undefined)
    return `g${generation}\u0000${viewId}\u0000${currentPaths.join("\u0000")}`;
  const parts = [String(viewId), currentPaths.join("\u0000")];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && DIRECTORY_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix)))
        parts.push(key, localStorage.getItem(key) ?? "");
    }
  } catch {
    return `${++nextLockViewId}`; // Unreadable storage: always rebuild.
  }
  return parts.join("");
}

/** Returns the same object while its stored inputs and paths are unchanged, so the
 * desktop heartbeat can skip rebuilding and re-serializing it. */
export function buildMobileProjectDirectory(
  currentPaths: readonly string[] = [],
): DesktopProjectDirectory {
  const view = getGroupLockView();
  const inputs = directoryInputs(currentPaths, view);
  if (lastBuild?.inputs === inputs) return lastBuild.directory;
  const archived = new Set(loadArchivedProjects().map((project) => pathKey(project.path)));
  const rail = projectRailItems(loadRecents(), "").map((project) => project.path);
  const directory = projectMobileDirectory({
    paths: [...rail, ...currentPaths].filter((path) => !archived.has(pathKey(path))),
    groups: view.groups,
    assignments: loadProjectGroupAssignments(view.groups),
    lock: view.lock,
    hiddenGroupIds: view.hiddenGroupIds,
    pinned: loadPinnedProjects(),
  });
  const result = {
    ...directory,
    projects: directory.projects.filter((project) => !archived.has(pathKey(project.cwd))),
  };
  lastBuild = { inputs, directory: result };
  return result;
}
