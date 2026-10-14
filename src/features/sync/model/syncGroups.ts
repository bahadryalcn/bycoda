import {
  loadProjectGroupAssignments,
  loadProjectGroups,
  reorderProjectGroups,
  saveProjectGroupAssignments,
  saveProjectGroups,
  type ProjectGroup,
} from "../../projects/model/projectGroups";
import { localPathKeyForProjectId } from "./syncProjects";
import { mergeIdOrder } from "./syncOrder";
import { hasPulled, knownRecordIds, knownRecordValue, queueLocalChange } from "./syncPeerState";
import type {
  SyncAssignmentValue,
  SyncGroupOrderValue,
  SyncGroupValue,
  SyncRecord,
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

/** Drops per-machine fields: the workspace link and the collapsed UI state. */
function syncableGroup(group: ProjectGroup | SyncGroupValue): SyncGroupValue {
  const {
    workspaceFile: _file,
    workspaceFolders: _folders,
    collapsed: _collapsed,
    ...rest
  } = group;
  return rest;
}

/** Queues every local group, and every assignment this machine can resolve
 * to a project sync id (`pathToProjectId`, from Task 7's id cache; an
 * assignment whose path has no id yet is simply skipped this cycle). */
export function captureLocalGroupChanges(
  machineId: string,
  pathToProjectId: Record<string, string> = {},
): void {
  const localGroups = loadProjectGroups();
  const seen = loadSeen("seenGroups", machineId);
  const localIds = new Set(localGroups.map((group) => group.id));
  for (const group of localGroups) {
    queueLocalChange(machineId, "group", group.id, syncableGroup(group));
    seen.add(group.id);
  }
  for (const id of knownRecordIds(machineId, "group")) {
    if (seen.has(id) && !localIds.has(id)) queueLocalChange(machineId, "group", id, null);
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
        const { workspaceFile, workspaceFolders, collapsed } = groups[index];
        const merged: ProjectGroup = {
          ...syncableGroup(value),
          collapsed,
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
