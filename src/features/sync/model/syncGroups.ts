import {
  loadProjectGroupAssignments,
  loadProjectGroups,
  projectGroupIncludesWorkspaceRoot,
  projectGroupWorkspaceRoot,
  reorderProjectGroups,
  saveProjectGroupAssignments,
  saveProjectGroups,
  type ProjectGroup,
} from "../../projects/public/projectGroups";
import { knownProjectPaths } from "../../projects/model/recents";
import { pathKey } from "../../../shared/lib/paths";
import { localPathKeyForProjectId, localProjectIdsByPath } from "./syncProjects";
import { isLocationProjectId } from "./syncProjectId";
import { localMachineId } from "./syncMachineId";
import { mergeIdOrder } from "./syncOrder";
import { hasPulled, knownRecordIds, knownRecordValue, queueLocalChange } from "./syncPeerState";
import type {
  SyncAssignmentValue,
  SyncGroupOrderValue,
  SyncGroupValue,
  SyncRecord,
  SyncWorkspaceLayoutValue,
} from "./syncProtocol";

type SeenKind = "seenGroups" | "seenAssignments";

function seenKey(kind: SeenKind, machineId: string): string {
  // Assignments are keyed by project id, whose scheme changed; group ids did not.
  return kind === "seenAssignments"
    ? `bycoda.sync.seenAssignments.v2:${machineId}`
    : `bycoda.sync.${kind}:${machineId}`;
}

/** Ids this machine has itself held locally. Only those may be tombstoned:
 * a record merely absent here may be another machine's data. */
function loadSeen(kind: SeenKind, machineId: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(seenKey(kind, machineId)) ?? "[]");
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    return new Set();
  }
}

function saveSeen(kind: SeenKind, machineId: string, ids: Set<string>): void {
  try {
    localStorage.setItem(seenKey(kind, machineId), JSON.stringify([...ids]));
  } catch {
    // ignored; re-learned on the next capture
  }
}

const GROUP_ORDER_ID = "groups";

function lastHostGroupOrder(machineId: string): string[] {
  const known = knownRecordValue(machineId, "groupOrder", GROUP_ORDER_ID) as
    | { order?: unknown }
    | null
    | undefined;
  const order = known?.order;
  return Array.isArray(order) ? order.filter((id): id is string => typeof id === "string") : [];
}

/** Drops per-machine fields. The portable workspace layout has its own record. */
function syncableGroup(
  group: SyncGroupValue & Pick<ProjectGroup, "syncedWorkspace">,
  projectIds?: Record<string, string>,
): SyncGroupValue {
  const {
    workspaceFile: _file,
    workspaceFolders: _folders,
    collapsed: _collapsed,
    syncedWorkspace: _syncedWorkspace,
    ...rest
  } = group;
  if (projectIds && Array.isArray(group.memberOrder)) {
    rest.memberOrder = group.memberOrder.map((key) =>
      typeof projectIds[key] === "string" ? projectIds[key] : key,
    );
  }
  return rest;
}

function captureWorkspaceLayout(
  machineId: string,
  group: ProjectGroup,
  projectIds: Record<string, string>,
): void {
  if (group.workspaceFile) {
    const root = projectGroupWorkspaceRoot(group);
    if (!root) return;
    const rootKey = pathKey(root);
    const rootProjectId = projectIds[rootKey];
    if (!rootProjectId) return;
    const sourceMachineId = localMachineId();
    const known = knownRecordValue(machineId, "workspaceLayout", group.id) as
      | SyncWorkspaceLayoutValue
      | null
      | undefined;
    // Desktops may independently link the same named group to different folders.
    // Each keeps its local link and the first published layout serves other desktops.
    if (known?.sourceMachineId && known.sourceMachineId !== sourceMachineId) return;
    const includesRoot = projectGroupIncludesWorkspaceRoot(group);
    queueLocalChange(machineId, "workspaceLayout", group.id, {
      rootProjectId,
      includesRoot,
      sourceMachineId,
    });
  } else if (group.syncedWorkspace !== undefined) {
    const workspace = group.syncedWorkspace;
    queueLocalChange(
      machineId,
      "workspaceLayout",
      group.id,
      workspace && {
        rootProjectId: workspace.rootProjectId,
        includesRoot: workspace.includesRoot,
        ...(workspace.sourceMachineId ? { sourceMachineId: workspace.sourceMachineId } : {}),
      },
    );
  }
}

/** Resolve layout references after a pull or after projects become available on the rail. */
function applyWorkspaceLayouts(machineId: string, records: readonly SyncRecord[] = []): void {
  const incoming = new Map(
    records
      .filter((record) => record.table === "workspaceLayout")
      .map((record) => [record.id, record.value]),
  );
  const assignments = new Map(
    records
      .filter((record) => record.table === "assignment")
      .map((record) => [record.id, record.value as SyncAssignmentValue | null]),
  );
  const paths = new Map<string, string>();
  const projectIds = localProjectIdsByPath();
  for (const path of knownProjectPaths()) {
    const projectId = projectIds[pathKey(path)];
    if (projectId) paths.set(projectId, path);
  }
  let changed = false;
  const groups = loadProjectGroups().map((group) => {
    if (group.workspaceFile) return group;
    const current = group.syncedWorkspace;
    // A locally recorded unlink or edit stays pending until its operation is applied.
    const value = (
      incoming.has(group.id)
        ? incoming.get(group.id)
        : current === undefined
          ? knownRecordValue(machineId, "workspaceLayout", group.id)
          : current
    ) as SyncWorkspaceLayoutValue | null | undefined;
    if (value === null) {
      if (current === null) return group;
      changed = true;
      return { ...group, syncedWorkspace: null };
    }
    if (
      !value ||
      typeof value.rootProjectId !== "string" ||
      !isLocationProjectId(value.rootProjectId) ||
      typeof value.includesRoot !== "boolean"
    )
      return group;
    const { rootProjectId, includesRoot } = value;
    const sourceMachineId =
      typeof value.sourceMachineId === "string" ? value.sourceMachineId : undefined;
    const path = paths.get(rootProjectId);
    const assignment = assignments.has(rootProjectId)
      ? assignments.get(rootProjectId)
      : (knownRecordValue(machineId, "assignment", rootProjectId) as
          | SyncAssignmentValue
          | null
          | undefined);
    const parentId =
      typeof assignment?.groupId === "string"
        ? assignment.groupId
        : assignment === undefined && current?.rootProjectId === rootProjectId
          ? current.parentId
          : undefined;
    if (
      current?.rootProjectId === rootProjectId &&
      current.includesRoot === includesRoot &&
      current.sourceMachineId === sourceMachineId &&
      current.path === path &&
      current.parentId === parentId
    )
      return group;
    changed = true;
    return {
      ...group,
      syncedWorkspace: { rootProjectId, includesRoot, sourceMachineId, path, parentId },
    };
  });
  if (changed) saveProjectGroups(groups);
}

/** Queues every local group, and every assignment this machine can resolve
 * to a project sync id (`pathToProjectId`, from Task 7's id cache; an
 * assignment whose path has no id yet is simply skipped this cycle). */
export function captureLocalGroupChanges(
  machineId: string,
  pathToProjectId: Record<string, string> = {},
  supportsWorkspaceLayout = true,
): void {
  applyWorkspaceLayouts(machineId);
  const localGroups = loadProjectGroups();
  const seen = loadSeen("seenGroups", machineId);
  const localIds = new Set(localGroups.map((group) => group.id));
  for (const group of localGroups) {
    queueLocalChange(
      machineId,
      "group",
      group.id,
      syncableGroup(group, supportsWorkspaceLayout ? pathToProjectId : undefined),
    );
    if (supportsWorkspaceLayout) captureWorkspaceLayout(machineId, group, pathToProjectId);
    seen.add(group.id);
  }
  for (const id of knownRecordIds(machineId, "group")) {
    if (seen.has(id) && !localIds.has(id)) {
      queueLocalChange(machineId, "group", id, null);
      if (supportsWorkspaceLayout && knownRecordValue(machineId, "workspaceLayout", id) != null)
        queueLocalChange(machineId, "workspaceLayout", id, null);
    }
  }
  saveSeen("seenGroups", machineId, seen);
  // An empty or smaller local order must not replace a host order this machine has not read yet.
  if (hasPulled(machineId)) {
    const order: SyncGroupOrderValue = {
      order: mergeIdOrder(
        lastHostGroupOrder(machineId),
        localGroups.map((group) => group.id),
        localIds,
      ),
    };
    queueLocalChange(machineId, "groupOrder", GROUP_ORDER_ID, order);
  }
  captureAssignments(machineId, pathToProjectId, localIds);
}

function captureAssignments(
  machineId: string,
  pathToProjectId: Record<string, string>,
  localGroupIds: ReadonlySet<string>,
): void {
  const assignments = loadProjectGroupAssignments();
  const seen = loadSeen("seenAssignments", machineId);
  const assigned = new Set<string>();
  for (const [pathKeyValue, groupId] of Object.entries(assignments)) {
    const projectId = pathToProjectId[pathKeyValue];
    if (!projectId) continue;
    const value: SyncAssignmentValue = { projectId, groupId };
    queueLocalChange(machineId, "assignment", projectId, value);
    assigned.add(projectId);
    seen.add(projectId);
  }
  const known = new Set(knownRecordIds(machineId, "assignment"));
  let adopted = false;
  for (const [pathKeyValue, projectId] of Object.entries(pathToProjectId)) {
    if (assigned.has(projectId) || !known.has(projectId)) continue;
    if (seen.has(projectId)) {
      // Assigned here before and no longer: a deliberate local removal.
      queueLocalChange(machineId, "assignment", projectId, null);
      seen.delete(projectId);
      continue;
    }
    // Never assigned here: the host's assignment arrived before this machine
    // had the folder, so take it over instead of deleting it.
    const hostValue = knownRecordValue(machineId, "assignment", projectId) as
      | SyncAssignmentValue
      | null
      | undefined;
    if (
      hostValue &&
      typeof hostValue.groupId === "string" &&
      localGroupIds.has(hostValue.groupId)
    ) {
      assignments[pathKeyValue] = hostValue.groupId;
      assigned.add(projectId);
      seen.add(projectId);
      adopted = true;
    }
  }
  if (adopted) saveProjectGroupAssignments(assignments);
  saveSeen("seenAssignments", machineId, seen);
}

/** Applies incoming group and assignment records. A group tombstone
 * removes the group (its assignment, if any, is cleared the same way
 * `deleteProjectGroup` does locally). An assignment's sync id is always
 * the projectId it is for (see `captureLocalGroupChanges`); it is applied
 * through `localPathKeyForProjectId`, and skipped when this machine has no
 * local path for that projectId yet — a later capture adopts it once this
 * machine opens the matching folder. `collapsed` is this machine's own UI
 * state and survives every apply. */
export function applyRemoteGroupRecords(machineId: string, records: readonly SyncRecord[]): void {
  const groupRecords = records.filter((record) => record.table === "group");
  if (groupRecords.length > 0) {
    let groups = loadProjectGroups();
    const seen = loadSeen("seenGroups", machineId);
    for (const record of groupRecords) {
      const value = record.value as SyncGroupValue | null;
      const index = groups.findIndex((group) => group.id === record.id);
      if (!value) {
        if (index >= 0) groups = groups.filter((_, i) => i !== index);
      } else if (index >= 0) {
        const { workspaceFile, workspaceFolders, syncedWorkspace, collapsed } = groups[index];
        const merged: ProjectGroup = {
          ...syncableGroup(value),
          collapsed,
          syncedWorkspace,
          ...(workspaceFile ? { workspaceFile, workspaceFolders } : {}),
        };
        groups = groups.map((group, i) => (i === index ? merged : group));
        seen.add(record.id);
      } else {
        groups = [...groups, { ...syncableGroup(value), collapsed: false }];
        seen.add(record.id);
      }
    }
    saveProjectGroups(groups);
    saveSeen("seenGroups", machineId, seen);
    saveProjectGroupAssignments(loadProjectGroupAssignments(loadProjectGroups()));
  }
  const orderValue = records.find((record) => record.table === "groupOrder")?.value as
    | SyncGroupOrderValue
    | null
    | undefined;
  if (orderValue && Array.isArray(orderValue.order)) {
    const localIds = loadProjectGroups().map((group) => group.id);
    const local = new Set(localIds);
    const remote = orderValue.order.filter(
      (id, i) => local.has(id) && orderValue.order.indexOf(id) === i,
    );
    const included = new Set(remote);
    reorderProjectGroups([...remote, ...localIds.filter((id) => !included.has(id))]);
  }
  const assignmentRecords = records.filter((record) => record.table === "assignment");
  if (
    groupRecords.length ||
    assignmentRecords.length ||
    records.some(({ table }) => table === "workspaceLayout")
  )
    applyWorkspaceLayouts(machineId, records);
  if (assignmentRecords.length === 0) return;
  const assignments = loadProjectGroupAssignments();
  const seenAssignments = loadSeen("seenAssignments", machineId);
  for (const record of assignmentRecords) {
    const pathKeyValue = localPathKeyForProjectId(record.id);
    if (!pathKeyValue) continue;
    const value = record.value as SyncAssignmentValue | null;
    if (value?.groupId) {
      assignments[pathKeyValue] = value.groupId;
      seenAssignments.add(record.id);
    } else {
      delete assignments[pathKeyValue];
      seenAssignments.delete(record.id);
    }
  }
  saveProjectGroupAssignments(assignments);
  saveSeen("seenAssignments", machineId, seenAssignments);
}
