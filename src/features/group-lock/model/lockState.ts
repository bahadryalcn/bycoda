import { pathKey } from "../../../shared/lib/paths";
import {
  projectGroupIdForPath,
  projectGroupParentId,
  projectGroupWorkspaceRoot,
  type ProjectGroup,
} from "../../projects/model/projectGroups";

/**
 * Which groups are open right now. Only the ids of groups the password has
 * opened are kept; everything lockable and not listed is locked. This is the
 * single place that decides what "locked" means, so the rail, pickers,
 * search and notifications cannot disagree.
 */
export type UnlockedGroups = ReadonlySet<string>;

export type LockAction =
  | { type: "unlock"; groupIds: readonly string[] }
  | { type: "lock"; groupIds: readonly string[] }
  | { type: "lockAll" }
  /** Another window or the saved state says exactly these are open. */
  | { type: "replace"; groupIds: readonly string[] };

export function lockReducer(state: UnlockedGroups, action: LockAction): UnlockedGroups {
  switch (action.type) {
    case "unlock":
      return new Set([...state, ...action.groupIds]);
    case "lock": {
      const next = new Set(state);
      for (const id of action.groupIds) next.delete(id);
      return next;
    }
    case "lockAll":
      return new Set();
    case "replace":
      return new Set(action.groupIds);
  }
}

/** Groups that start open: none when locking again at launch is on. */
export function initialUnlocked(relockOnLaunch: boolean, saved: readonly string[]): UnlockedGroups {
  return relockOnLaunch ? new Set() : new Set(saved);
}

export type LockInputs = {
  groups: readonly ProjectGroup[];
  assignments: Record<string, string>;
  hasPassword: boolean;
  unlocked: UnlockedGroups;
  /** Groups hidden from the entire UI, independently of password locking. */
  hiddenGroupIds?: ReadonlySet<string>;
};

export type LockSnapshot = {
  lockedGroupIds: ReadonlySet<string>;
  /** `pathKey` of every project that sits in a locked group. */
  lockedProjectKeys: ReadonlySet<string>;
};

export const NOTHING_LOCKED: LockSnapshot = {
  lockedGroupIds: new Set(),
  lockedProjectKeys: new Set(),
};

/** Without a password nothing can be unlocked, so nothing is locked. */
export function isGroupLocked(
  group: ProjectGroup,
  hasPassword: boolean,
  unlocked: UnlockedGroups,
): boolean {
  return hasPassword && group.lockable === true && !unlocked.has(group.id);
}

export function computeLockSnapshot(inputs: LockInputs): LockSnapshot {
  const lockedGroupIds = new Set(
    inputs.groups
      .filter(
        (group) =>
          inputs.hiddenGroupIds?.has(group.id) ||
          isGroupLocked(group, inputs.hasPassword, inputs.unlocked),
      )
      .map((group) => group.id),
  );
  if (lockedGroupIds.size === 0) return NOTHING_LOCKED;
  for (const group of inputs.groups) {
    const parentId = projectGroupParentId(group, inputs.groups, inputs.assignments);
    if (parentId && lockedGroupIds.has(parentId)) lockedGroupIds.add(group.id);
  }
  const lockedProjectKeys = new Set<string>();
  for (const group of inputs.groups) {
    const root = projectGroupWorkspaceRoot(group);
    if (root && lockedGroupIds.has(group.id)) lockedProjectKeys.add(pathKey(root));
  }
  for (const [key, groupId] of Object.entries(inputs.assignments)) {
    if (lockedGroupIds.has(groupId)) lockedProjectKeys.add(key);
  }
  return { lockedGroupIds, lockedProjectKeys };
}

export function isProjectLockedIn(snapshot: LockSnapshot, path: string): boolean {
  return snapshot.lockedProjectKeys.size > 0 && snapshot.lockedProjectKeys.has(pathKey(path));
}

/** The items whose project is not in a locked group. */
export function visibleProjects<T>(
  snapshot: LockSnapshot,
  items: readonly T[],
  pathOf: (item: T) => string,
): T[] {
  if (snapshot.lockedProjectKeys.size === 0) return [...items];
  return items.filter((item) => !isProjectLockedIn(snapshot, pathOf(item)));
}

/** The group a project sits in, if the project is locked. */
export function lockedGroupOf(
  snapshot: LockSnapshot,
  path: string,
  assignments: Record<string, string>,
): string | undefined {
  const id = projectGroupIdForPath(path, assignments);
  return id && snapshot.lockedGroupIds.has(id) ? id : undefined;
}
