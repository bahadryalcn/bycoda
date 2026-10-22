import { useMemo, useSyncExternalStore } from "react";
import { getGroupLockView, subscribeGroupLock, type GroupLockView } from "../model/groupLock";
import { isProjectLockedIn, visibleProjects, type LockSnapshot } from "../model/lockState";

/** Everything about the lock: password state, options, groups, what is locked. */
export function useGroupLock(): GroupLockView {
  return useSyncExternalStore(subscribeGroupLock, getGroupLockView);
}

/**
 * Only which groups and projects are locked. Keeps its identity until that
 * changes, so reading it does not re-render on unrelated rail edits.
 */
export function useLockSnapshot(): LockSnapshot {
  return useSyncExternalStore(subscribeGroupLock, () => getGroupLockView().lock);
}

export function useIsProjectLocked(path: string): boolean {
  return isProjectLockedIn(useLockSnapshot(), path);
}

/** The items outside locked groups, for lists that must not show the rest. */
export function useVisibleProjects<T>(items: readonly T[], pathOf: (item: T) => string): T[] {
  const lock = useLockSnapshot();
  // `pathOf` is a plain accessor; callers pass a module-level function.
  return useMemo(() => visibleProjects(lock, items, pathOf), [lock, items]);
}
