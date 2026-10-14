import type { DesktopProjectDirectory } from "../../connections/model/protocol";
import { getGroupLockView } from "../../group-lock/model/groupLock";
import type { LockSnapshot } from "../../group-lock/model/lockState";
import { pathKey } from "../../../shared/lib/paths";
import { projectDisplayName } from "./projectNames";
import { loadTabGroupLabels } from "../../workspace/model/tabGroups";
import {
  loadProjectGroupAssignments,
  projectGroupColor,
  projectGroupWorkspaceRoot,
  type ProjectGroup,
} from "./projectGroups";
import { isLocalProject, knownProjectPaths } from "./recents";

/** Projects the desktop can already show; this does not unlock or change any group. */
export function projectMobileDirectory(input: {
  paths: readonly string[];
  groups: readonly ProjectGroup[];
  assignments: Record<string, string>;
  lock: LockSnapshot;
  labels?: Record<string, string>;
}): DesktopProjectDirectory {
  const labels = input.labels ?? loadTabGroupLabels();
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
    ...Object.keys(input.assignments),
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
    projects.push({
      cwd,
      name: projectDisplayName(cwd, labels),
      ...(assigned && groupIds.has(assigned) ? { groupId: assigned } : {}),
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
    })),
    excludedPaths: [...input.lock.lockedProjectKeys],
    excludedGroupIds: [...input.lock.lockedGroupIds],
  };
}

export function buildMobileProjectDirectory(
  currentPaths: readonly string[] = [],
): DesktopProjectDirectory {
  const view = getGroupLockView();
  return projectMobileDirectory({
    paths: [...knownProjectPaths(), ...currentPaths],
    groups: view.groups,
    assignments: loadProjectGroupAssignments(view.groups),
    lock: view.lock,
  });
}
