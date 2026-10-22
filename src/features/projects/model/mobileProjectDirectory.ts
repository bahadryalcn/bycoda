import type { DesktopProjectDirectory } from "../../connections/model/protocol";
import { getGroupLockView } from "../../group-lock/model/groupLock";
import type { LockSnapshot } from "../../group-lock/model/lockState";
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
  projectGroupWorkspaceRoot,
  type ProjectGroup,
} from "./projectGroups";
import { isLocalProject, loadArchivedProjects, loadRecents, projectRailItems } from "./recents";
import { loadSessionFolders } from "../../sessions/model/sessionFolders";
import { loadSessionOrder } from "../../sessions/model/sessionOrder";

/** Projects the desktop can already show; this does not unlock or change any group. */
export function projectMobileDirectory(input: {
  paths: readonly string[];
  groups: readonly ProjectGroup[];
  assignments: Record<string, string>;
  lock: LockSnapshot;
  labels?: Record<string, string>;
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
  };
}

export function buildMobileProjectDirectory(
  currentPaths: readonly string[] = [],
): DesktopProjectDirectory {
  const view = getGroupLockView();
  const archived = new Set(loadArchivedProjects().map((project) => pathKey(project.path)));
  const rail = projectRailItems(loadRecents(), "").map((project) => project.path);
  const directory = projectMobileDirectory({
    paths: [...rail, ...currentPaths].filter((path) => !archived.has(pathKey(path))),
    groups: view.groups,
    assignments: loadProjectGroupAssignments(view.groups),
    lock: view.lock,
  });
  return {
    ...directory,
    projects: directory.projects.filter((project) => !archived.has(pathKey(project.cwd))),
  };
}
