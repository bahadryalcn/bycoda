import { getCommittedProjectionSeen } from "./roomPrivacyProjection";
import { getGroupLockView, getGroupPrivacyRevision } from "./groupLock";
import { loadProjectGroupAssignments } from "../../projects/model/projectGroups";
import { buildMobileProjectDirectory } from "../../projects/model/mobileProjectDirectory";
import { parsePasswordRecord } from "./passwordRecord";
import { loadArchivedProjects, loadRecents } from "../../projects/model/recents";

function requireReadableStorage() {
  const groupIds = new Set<string>();
  const keys = [
    "bycoda.groupLock",
    "bycoda.groupLock.hiddenGroups.v1",
    "bycoda.projectGroups",
    "bycoda.projectGroupAssignments",
    "bycoda.recentProjects",
    "bycoda.archivedProjects",
  ];
  for (const key of keys) {
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    const value: unknown = JSON.parse(raw);
    if (key === "bycoda.groupLock") {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Privacy storage is invalid.");
      const record = (value as Record<string, unknown>).record;
      if (record != null && !parsePasswordRecord(record))
        throw new Error("Privacy storage is invalid.");
    } else if (key === "bycoda.projectGroupAssignments") {
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.values(value).some((item) => typeof item !== "string" || !groupIds.has(item))
      )
        throw new Error("Privacy storage is invalid.");
    } else {
      if (!Array.isArray(value)) throw new Error("Privacy storage is invalid.");
      if (
        key === "bycoda.groupLock.hiddenGroups.v1" &&
        value.some((item) => typeof item !== "string" || !item)
      )
        throw new Error("Privacy storage is invalid.");
      if (key === "bycoda.projectGroups") {
        for (const item of value) {
          if (!item || typeof item !== "object" || Array.isArray(item))
            throw new Error("Privacy storage is invalid.");
          const group = item as Record<string, unknown>;
          if (
            typeof group.id !== "string" ||
            !group.id.trim() ||
            groupIds.has(group.id) ||
            typeof group.name !== "string" ||
            !group.name.trim() ||
            (group.workspaceFile !== undefined && typeof group.workspaceFile !== "string") ||
            (group.lockable !== undefined && typeof group.lockable !== "boolean")
          )
            throw new Error("Privacy storage is invalid.");
          groupIds.add(group.id);
        }
      }
      if (
        (key === "bycoda.recentProjects" || key === "bycoda.archivedProjects") &&
        value.some(
          (item) =>
            !item ||
            typeof item !== "object" ||
            Array.isArray(item) ||
            typeof (item as Record<string, unknown>).path !== "string" ||
            !(item as { path: string }).path.trim(),
        )
      )
        throw new Error("Privacy storage is invalid.");
    }
  }
}

/** Snapshot from the current window. Native binds this to its captured issuer. */
export function readRoomPrivacyScope() {
  requireReadableStorage();
  const privacyRevision = getGroupPrivacyRevision();
  const view = getGroupLockView();
  const stableStorageKeys = {
    groups: view.groups
      .map(({ id, lockable, workspaceFile }) => ({
        id,
        lockable: lockable === true,
        ...(workspaceFile ? { workspaceFile } : {}),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    assignments: loadProjectGroupAssignments(view.groups),
    hiddenGroupIds: [...view.savedHiddenGroupIds].sort(),
    lockedGroupIds: [...view.lock.lockedGroupIds].sort(),
    hasPassword: view.hasPassword,
    recents: loadRecents()
      .map(({ path }) => path)
      .sort(),
    archived: loadArchivedProjects()
      .map(({ path }) => path)
      .sort(),
  };
  const visibleProjects = buildMobileProjectDirectory().projects.map(({ cwd }) => ({ cwd }));
  if (privacyRevision !== getGroupPrivacyRevision()) throw new Error("Privacy scope changed.");
  return {
    privacyRevision,
    stableStorageKeys,
    visibleProjects,
    committedProjectionSeen: getCommittedProjectionSeen(),
  };
}
