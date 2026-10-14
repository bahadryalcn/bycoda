import { parentPath, pathKey, slash } from "../../../shared/lib/paths";
import { moveIdByStep, orderByIds, type MoveStep } from "../../../shared/lib/reorder";
import { normalizeProjectMascotName } from "./projectMascots";
import { TAB_GROUP_COLORS, tabGroupColor } from "../../workspace/model/tabGroups";
import { notifyProjectPathsChanged } from "./recents";

const GROUPS_KEY = "bycoda.projectGroups";
const ASSIGNMENTS_KEY = "bycoda.projectGroupAssignments";
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export type ProjectGroup = {
  id: string;
  name: string;
  collapsed: boolean;
  colorIndex?: number;
  customColor?: string;
  mascot?: string;
  /** The `.code-workspace` file this group mirrors, when it was created from one. */
  workspaceFile?: string;
  /**
   * The folders that file listed at the last sync. Only these may be detached
   * when the file changes; projects the user added by hand are never touched.
   */
  workspaceFolders?: string[];
  /** Opening the group asks for the app lock password. See group-lock. */
  lockable?: boolean;
};

/** A linked workspace opens the directory containing its workspace file as a project. */
export function projectGroupWorkspaceRoot(group: ProjectGroup): string | null {
  return group.workspaceFile ? parentPath(slash(group.workspaceFile)) : null;
}

function normalizeGroup(value: unknown): ProjectGroup | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ProjectGroup>;
  if (typeof candidate.id !== "string" || !candidate.id.trim()) return null;
  if (typeof candidate.name !== "string" || !candidate.name.trim()) return null;

  const colorIndex =
    typeof candidate.colorIndex === "number" &&
    Number.isInteger(candidate.colorIndex) &&
    candidate.colorIndex >= 0 &&
    candidate.colorIndex < TAB_GROUP_COLORS.length
      ? candidate.colorIndex
      : undefined;
  const customColor =
    typeof candidate.customColor === "string" && HEX_COLOR_RE.test(candidate.customColor)
      ? candidate.customColor.toLowerCase()
      : undefined;
  const mascot =
    typeof candidate.mascot === "string"
      ? (normalizeProjectMascotName(candidate.mascot) ?? undefined)
      : undefined;

  const workspaceFile =
    typeof candidate.workspaceFile === "string" && candidate.workspaceFile.trim()
      ? slash(candidate.workspaceFile.trim())
      : undefined;
  const workspaceFolders =
    workspaceFile && Array.isArray(candidate.workspaceFolders)
      ? uniquePaths(candidate.workspaceFolders)
      : [];

  return {
    id: candidate.id,
    name: candidate.name.trim(),
    collapsed: candidate.collapsed === true,
    ...(customColor ? { customColor } : colorIndex == null ? {} : { colorIndex }),
    ...(mascot ? { mascot } : {}),
    ...(workspaceFile ? { workspaceFile, workspaceFolders } : {}),
    ...(candidate.lockable === true ? { lockable: true } : {}),
  };
}

function uniquePaths(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    const path = slash(value.trim());
    const key = pathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(path);
  }
  return out;
}

export function loadProjectGroups(): ProjectGroup[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const groups: ProjectGroup[] = [];
    const seen = new Set<string>();
    for (const value of parsed) {
      const group = normalizeGroup(value);
      if (!group || seen.has(group.id)) continue;
      seen.add(group.id);
      groups.push(group);
    }
    return groups;
  } catch {
    return [];
  }
}

export function saveProjectGroups(groups: ProjectGroup[]): boolean {
  const normalized = groups.flatMap((group) => {
    const value = normalizeGroup(group);
    return value ? [value] : [];
  });
  try {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(normalized));
    notifyProjectPathsChanged();
    return true;
  } catch {
    return false;
  }
}

export function loadProjectGroupAssignments(
  groups: readonly ProjectGroup[] = loadProjectGroups(),
): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ASSIGNMENTS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const groupIds = new Set(groups.map((group) => group.id));
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          Boolean(entry[0]) && typeof entry[1] === "string" && groupIds.has(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

export function saveProjectGroupAssignments(assignments: Record<string, string>): boolean {
  try {
    localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(assignments));
    notifyProjectPathsChanged();
    return true;
  } catch {
    return false;
  }
}

export function projectGroupIdForPath(
  path: string,
  assignments: Record<string, string>,
): string | undefined {
  return assignments[pathKey(path)];
}

export function setProjectGroupAssignment(
  path: string,
  groupId: string | null,
): Record<string, string> {
  const next = loadProjectGroupAssignments();
  const key = pathKey(path);
  if (groupId == null) delete next[key];
  else if (loadProjectGroups().some((group) => group.id === groupId)) {
    next[key] = groupId;
  }
  saveProjectGroupAssignments(next);
  return next;
}

export function removeProjectGroupAssignment(path: string): void {
  setProjectGroupAssignment(path, null);
}

export function rebaseProjectGroupAssignment(from: string, to: string): void {
  const next = loadProjectGroupAssignments();
  const oldKey = pathKey(from);
  const newKey = pathKey(to);
  if (oldKey === newKey || !(oldKey in next)) return;
  if (!(newKey in next)) next[newKey] = next[oldKey];
  delete next[oldKey];
  saveProjectGroupAssignments(next);
}

export function updateProjectGroup(
  id: string,
  update: (group: ProjectGroup) => ProjectGroup,
): void {
  const current = loadProjectGroups();
  if (!current.some((group) => group.id === id)) return;
  saveProjectGroups(current.map((group) => (group.id === id ? update(group) : group)));
}

/**
 * Saves the groups in this order. A group the list leaves out keeps its place
 * after the others, so a stale drag from another window never drops one.
 */
export function reorderProjectGroups(ids: readonly string[]): boolean {
  const current = loadProjectGroups();
  const next = orderByIds(current, [...ids]);
  if (next.every((group, index) => group.id === current[index].id)) return true;
  return saveProjectGroups(next);
}

/** Moves one group a step up or down the list, or to the top. */
export function moveProjectGroup(id: string, step: MoveStep): boolean {
  const current = loadProjectGroups();
  const ids = current.map((group) => group.id);
  const next = moveIdByStep(ids, id, step);
  return next === ids ? false : reorderProjectGroups(next);
}

/** Removes the group; its projects become ungrouped. */
export function deleteProjectGroup(id: string): boolean {
  const nextGroups = loadProjectGroups().filter((group) => group.id !== id);
  if (!saveProjectGroups(nextGroups)) return false;
  saveProjectGroupAssignments(loadProjectGroupAssignments(nextGroups));
  return true;
}

export function projectGroupColor(group: ProjectGroup): string {
  if (group.customColor) return group.customColor;
  if (
    group.colorIndex != null &&
    group.colorIndex >= 0 &&
    group.colorIndex < TAB_GROUP_COLORS.length
  ) {
    return TAB_GROUP_COLORS[group.colorIndex];
  }
  return tabGroupColor(group.id);
}

export function nextProjectGroupName(groups: ProjectGroup[]): string {
  const names = new Set(groups.map((group) => group.name.toLocaleLowerCase()));
  if (!names.has("new group")) return "New group";
  for (let suffix = 2; ; suffix += 1) {
    const name = `New group ${suffix}`;
    if (!names.has(name.toLocaleLowerCase())) return name;
  }
}

export function createProjectGroup(groups: ProjectGroup[]): ProjectGroup {
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  return {
    id,
    name: nextProjectGroupName(groups),
    collapsed: false,
  };
}

/**
 * Puts the projects in the group with this name, creating it when there is
 * none. A project already in another group moves.
 */
export function assignProjectsToNamedGroup(
  name: string,
  paths: readonly string[],
): ProjectGroup | null {
  const trimmed = name.trim();
  if (!trimmed || paths.length === 0) return null;

  const groups = loadProjectGroups();
  let group = groups.find((item) => item.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase());
  if (!group) {
    group = { ...createProjectGroup(groups), name: trimmed };
    if (!saveProjectGroups([...groups, group])) return null;
  }

  const assignments = loadProjectGroupAssignments();
  for (const path of paths) assignments[pathKey(path)] = group.id;
  return saveProjectGroupAssignments(assignments) ? group : null;
}

/** Remembers the workspace file a group mirrors and the folders it listed. */
export function linkProjectGroup(
  id: string,
  workspaceFile: string,
  folders: readonly string[],
): void {
  updateProjectGroup(id, (group) => ({
    ...group,
    workspaceFile,
    workspaceFolders: [...folders],
  }));
}

/** Stops mirroring the file. The group and its projects stay as they are. */
export function unlinkProjectGroup(id: string): void {
  updateProjectGroup(id, (group) => {
    const { workspaceFile: _file, workspaceFolders: _folders, ...rest } = group;
    return rest;
  });
}

/**
 * Moves `add` into the group and takes `remove` out of it in one save. A
 * project in `remove` that has since moved to another group is left there.
 */
export function changeProjectGroupMembers(
  id: string,
  add: readonly string[],
  remove: readonly string[],
): void {
  if (!loadProjectGroups().some((group) => group.id === id)) return;
  const assignments = loadProjectGroupAssignments();
  for (const path of remove) {
    const key = pathKey(path);
    if (assignments[key] === id) delete assignments[key];
  }
  for (const path of add) assignments[pathKey(path)] = id;
  saveProjectGroupAssignments(assignments);
}

/** Paths (as stored keys) currently assigned to the group. */
export function projectGroupMembers(id: string, assignments: Record<string, string>): string[] {
  return Object.keys(assignments).filter((key) => assignments[key] === id);
}
