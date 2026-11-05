import { normalizeProjectPath } from "../../projects/public/recents";
import {
  addSessionToFolder,
  arrangeFolderSessions,
  canMoveFolder,
  createFolderWithSessions,
  dissolveFolder,
  moveFolder,
  moveFolderOut,
  removeSessionsFromFolders,
  renameFolder,
  reorderSessionFolders,
  setFolderCollapsed,
  setFolderColor,
  setFolderCustomColor,
  setFolderPinned,
  type FolderMoveTarget,
  type SessionFolder,
} from "./sessionFolders";
import {
  moveIdsInOrder,
  type SessionDropPlace,
  type SessionOrder,
  type SessionOrderList,
} from "./sessionOrder";
import {
  mutateSessionOrganization,
  type SessionOrganizationResult,
  type SessionOrganizationState,
} from "./sessionOrganizationStore";

/** Captured user intent. IDs and positions are fixed before any CAS attempt. */
export type OrganizationOperation =
  | { kind: "batch"; cwd: string; operations: OrganizationOperation[] }
  | {
      kind: "reviewed";
      cwd: string;
      authorityScope: string;
      expectedFolders: string;
      expectedOrder: string;
      operation: OrganizationOperation;
    }
  | {
      kind: "create";
      cwd: string;
      folderId: string;
      sessionIds: string[];
      name?: string;
      parentId?: string;
      pinned?: boolean;
    }
  | { kind: "rename"; cwd: string; folderId: string; name: string }
  | { kind: "moveFolder"; cwd: string; folderId: string; target: FolderMoveTarget }
  | {
      kind: "undoFolderMove";
      cwd: string;
      folderId: string;
      expected: FolderPosition;
      restore: FolderPosition;
    }
  | { kind: "moveFolderOut"; cwd: string; folderId: string }
  | { kind: "deleteFolder"; cwd: string; folderId: string }
  | { kind: "assign"; cwd: string; folderId: string | null; sessionIds: string[] }
  | { kind: "folderOrder"; cwd: string; folderIds: string[] }
  | { kind: "folderSessions"; cwd: string; folderId: string; sessionIds: string[] }
  | {
      kind: "reviewedFolderSessions";
      cwd: string;
      folderId: string;
      sessionIds: string[];
      knownIds: string[];
    }
  | { kind: "reviewedOrder"; cwd: string; list: SessionOrderList; sessionIds: string[] }
  | {
      kind: "folderInsert";
      cwd: string;
      folderId: string;
      sessionIds: string[];
      anchorId?: string;
      place?: SessionDropPlace;
      seedOrder: string[];
      preserveUnordered?: boolean;
    }
  | {
      kind: "looseInsert";
      cwd: string;
      list: SessionOrderList;
      sessionIds: string[];
      anchorId: string;
      place: SessionDropPlace;
      seedOrder: string[];
    }
  | {
      kind: "undoSessionDrop";
      cwd: string;
      folders: Array<{
        id: string;
        expected: SessionFolder | null;
        restore: SessionFolder | null;
        beforeId?: string;
      }>;
      order?: {
        list: SessionOrderList;
        expected: string[] | undefined;
        restore: string[] | undefined;
      };
    }
  | { kind: "folderCollapsed"; cwd: string; folderId: string; collapsed: boolean }
  | { kind: "folderPinned"; cwd: string; folderId: string; pinned: boolean }
  | { kind: "folderColor"; cwd: string; folderId: string; colorIndex: number | null }
  | { kind: "folderCustomColor"; cwd: string; folderId: string; color: string | null }
  | { kind: "replaceSessionIds"; cwd: string; aliases: Array<{ from: string; to: string }> }
  | {
      kind: "sessionOrder";
      cwd: string;
      list: SessionOrderList;
      sessionIds: string[];
      anchorId: string;
      place: SessionDropPlace;
    }
  | { kind: "rebase"; cwd: string; to: string };

function keyFor(store: Record<string, unknown>, cwd: string): string {
  const key = normalizeProjectPath(cwd);
  if (!cwd || cwd === "~" || !key)
    throw new Error("A project is required for organization changes.");
  const aliases = Object.keys(store).filter((entry) => normalizeProjectPath(entry) === key);
  if (aliases.length > 1)
    throw new Error("Project paths have conflicting aliases; recovery is required.");
  return aliases[0] ?? key;
}

function foldersAt(store: Record<string, unknown>, key: string): SessionFolder[] {
  const value = store[key] ?? [];
  if (
    !Array.isArray(value) ||
    value.some(
      (folder) =>
        !folder ||
        typeof folder !== "object" ||
        typeof folder.id !== "string" ||
        typeof folder.name !== "string" ||
        !Array.isArray(folder.sessionIds) ||
        folder.sessionIds.some((id: unknown) => typeof id !== "string"),
    )
  )
    throw new Error("Invalid folder data; recovery is required.");
  return structuredClone(value) as SessionFolder[];
}

export type FolderPosition = {
  parentId?: string;
  pinned: boolean;
  before?: string;
  after?: string;
};
export function folderPosition(folders: SessionFolder[], id: string): FolderPosition {
  const folder = folders.find((entry) => entry.id === id);
  if (!folder) throw new Error("Folder changed or was removed; refresh before retrying.");
  const siblings = folders.filter(
    (entry) => entry.parentId === folder.parentId && !!entry.pinned === !!folder.pinned,
  );
  const index = siblings.findIndex((entry) => entry.id === id);
  return {
    parentId: folder.parentId,
    pinned: !!folder.pinned,
    before: siblings[index - 1]?.id,
    after: siblings[index + 1]?.id,
  };
}

export function folderPositionTarget(position: FolderPosition): FolderMoveTarget {
  if (position.after) return { kind: "beside", id: position.after, place: "before" };
  if (position.before) return { kind: "beside", id: position.before, place: "after" };
  return position.parentId
    ? { kind: "into", id: position.parentId }
    : position.pinned
      ? { kind: "pinned" }
      : { kind: "root" };
}

export function organizationFoldersForProject(
  state: SessionOrganizationState,
  cwd: string,
): SessionFolder[] {
  return foldersAt(state.folders, keyFor(state.folders, cwd));
}

export function organizationOrderForProject(
  state: SessionOrganizationState,
  cwd: string,
): SessionOrder {
  const value = state.order[keyFor(state.order, cwd)] ?? {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid session order; recovery is required.");
  const record = value as Record<string, unknown>;
  for (const list of ["loose", "pinned"] as const) {
    if (
      record[list] !== undefined &&
      (!Array.isArray(record[list]) ||
        (record[list] as unknown[]).some((id) => typeof id !== "string"))
    )
      throw new Error("Invalid session order; recovery is required.");
  }
  return structuredClone(value) as SessionOrder;
}

function apply(
  state: SessionOrganizationState,
  op: OrganizationOperation,
): SessionOrganizationState {
  if (op.kind === "reviewed") {
    if (
      normalizeProjectPath(op.operation.cwd) !== normalizeProjectPath(op.cwd) ||
      JSON.stringify(state.folders[keyFor(state.folders, op.cwd)] ?? []) !== op.expectedFolders ||
      JSON.stringify(state.order[keyFor(state.order, op.cwd)] ?? {}) !== op.expectedOrder
    )
      throw new Error("Desktop organization changed; review it again.");
    return apply(state, op.operation);
  }
  if (op.kind === "batch") {
    if (
      op.operations.some(
        (entry) => normalizeProjectPath(entry.cwd) !== normalizeProjectPath(op.cwd),
      )
    )
      throw new Error("Organization batch crosses projects.");
    return op.operations.reduce((current, entry) => apply(current, entry), state);
  }
  const folders = { ...state.folders };
  const order = { ...state.order };
  const key = keyFor(folders, op.cwd);
  if (op.kind === "rebase") {
    for (const store of [folders, order]) {
      const from = keyFor(store, op.cwd);
      const to = keyFor(store, op.to);
      if (from === to || !(from in store)) continue;
      if (to in store) throw new Error("Destination organization already exists; review it first.");
      store[to] = store[from];
      delete store[from];
    }
    return { folders, order };
  }
  if (op.kind === "sessionOrder") {
    const orderKey = keyFor(order, op.cwd);
    const value = order[orderKey] ?? {};
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid session order; recovery is required.");
    const record = value as Record<string, unknown>;
    const previous = record[op.list] ?? [];
    if (!Array.isArray(previous) || previous.some((id) => typeof id !== "string"))
      throw new Error("Invalid session order; recovery is required.");
    order[orderKey] = {
      ...record,
      [op.list]: moveIdsInOrder(previous, op.sessionIds, op.anchorId, op.place),
    };
    return { folders, order };
  }
  if (op.kind === "reviewedOrder") {
    const orderKey = keyFor(order, op.cwd);
    const value = order[orderKey] ?? {};
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid session order; recovery is required.");
    const record = value as Record<string, unknown>;
    const existing = record[op.list] ?? [];
    if (!Array.isArray(existing) || existing.some((id) => typeof id !== "string"))
      throw new Error("Invalid session order; recovery is required.");
    order[orderKey] = {
      ...record,
      [op.list]: [...op.sessionIds, ...existing.filter((id) => !op.sessionIds.includes(id))],
    };
    return { folders, order };
  }
  const current = foldersAt(folders, key);
  if (
    "folderId" in op &&
    op.kind !== "create" &&
    op.folderId &&
    !current.some((folder) => folder.id === op.folderId)
  )
    throw new Error("Folder changed or was removed; refresh before retrying.");
  let next: SessionFolder[];
  switch (op.kind) {
    case "create":
      if (
        !op.sessionIds.length ||
        !op.folderId ||
        (op.name !== undefined && !op.name.trim()) ||
        current.some((folder) => folder.id === op.folderId) ||
        (op.parentId && !current.some((folder) => folder.id === op.parentId))
      )
        throw new Error("Folder destination changed; refresh before retrying.");
      next = createFolderWithSessions(current, op.sessionIds, op.name?.trim(), {
        id: op.folderId,
        parentId: op.parentId,
        pinned: op.pinned,
      }).folders;
      break;
    case "rename":
      next = renameFolder(current, op.folderId, op.name);
      break;
    case "moveFolder":
      if (!canMoveFolder(current, op.folderId, op.target))
        throw new Error("Folder destination changed; refresh before retrying.");
      next = moveFolder(current, op.folderId, op.target);
      break;
    case "undoFolderMove": {
      const target = folderPositionTarget(op.restore);
      const anchor =
        target.kind === "beside" ? current.find((folder) => folder.id === target.id) : undefined;
      if (
        JSON.stringify(folderPosition(current, op.folderId)) !== JSON.stringify(op.expected) ||
        (target.kind === "beside" &&
          (!anchor ||
            anchor.parentId !== op.restore.parentId ||
            !!anchor.pinned !== op.restore.pinned)) ||
        !canMoveFolder(current, op.folderId, target)
      )
        throw new Error("Folder changed after the move; undo was not applied.");
      next = moveFolder(current, op.folderId, target);
      break;
    }
    case "moveFolderOut":
      next = moveFolderOut(current, op.folderId);
      break;
    case "deleteFolder":
      next = dissolveFolder(current, op.folderId);
      break;
    case "assign":
      next = op.folderId
        ? op.sessionIds.reduce((value, id) => addSessionToFolder(value, op.folderId!, id), current)
        : removeSessionsFromFolders(current, op.sessionIds);
      break;
    case "folderOrder":
      next = reorderSessionFolders(current, op.folderIds);
      break;
    case "folderSessions": {
      const existing = current.find((folder) => folder.id === op.folderId)!;
      next = arrangeFolderSessions(current, op.folderId, [
        ...op.sessionIds,
        ...existing.sessionIds.filter((id) => !op.sessionIds.includes(id)),
      ]);
      break;
    }
    case "reviewedFolderSessions": {
      const host = current.find((folder) => folder.id === op.folderId)!;
      const known = new Set(op.knownIds);
      next = arrangeFolderSessions(current, op.folderId, [
        ...op.sessionIds,
        ...host.sessionIds.filter((id) => !known.has(id)),
      ]);
      break;
    }
    case "folderInsert": {
      const host = current.find((folder) => folder.id === op.folderId)!;
      const known = new Set(host.sessionIds);
      const base = host.ordered
        ? host.sessionIds
        : [
            ...op.seedOrder.filter((id) => known.has(id)),
            ...host.sessionIds.filter((id) => !op.seedOrder.includes(id)),
          ];
      if (op.anchorId && !base.includes(op.anchorId))
        throw new Error("Folder destination changed; refresh before retrying.");
      const members = op.anchorId
        ? moveIdsInOrder(base, op.sessionIds, op.anchorId, op.place ?? "after")
        : [...base.filter((id) => !op.sessionIds.includes(id)), ...op.sessionIds];
      next = arrangeFolderSessions(current, op.folderId, members);
      if (op.preserveUnordered && !host.ordered)
        next = next.map((folder) =>
          folder.id === host.id ? { ...folder, ordered: undefined } : folder,
        );
      break;
    }
    case "looseInsert": {
      const orderKey = keyFor(order, op.cwd);
      const value = order[orderKey] ?? {};
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Invalid session order; recovery is required.");
      const record = value as Record<string, unknown>;
      const saved = record[op.list];
      if (
        saved !== undefined &&
        (!Array.isArray(saved) || saved.some((id: unknown) => typeof id !== "string"))
      )
        throw new Error("Invalid session order; recovery is required.");
      const base = saved
        ? [
            ...(saved as string[]),
            ...op.seedOrder.filter((id) => !(saved as string[]).includes(id)),
          ]
        : op.seedOrder;
      if (!base.includes(op.anchorId))
        throw new Error("Session destination changed; refresh before retrying.");
      order[orderKey] = {
        ...record,
        [op.list]: moveIdsInOrder(base, op.sessionIds, op.anchorId, op.place),
      };
      next = removeSessionsFromFolders(current, op.sessionIds);
      break;
    }
    case "undoSessionDrop": {
      for (const patch of op.folders) {
        const actual = current.find((folder) => folder.id === patch.id) ?? null;
        if (JSON.stringify(actual) !== JSON.stringify(patch.expected))
          throw new Error("Folder changed after the move; undo was not applied.");
      }
      if (op.order) {
        const orderKey = keyFor(order, op.cwd);
        const value = order[orderKey] ?? {};
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Error("Invalid session order; recovery is required.");
        const record = value as Record<string, unknown>;
        if (JSON.stringify(record[op.order.list]) !== JSON.stringify(op.order.expected))
          throw new Error("Session order changed after the move; undo was not applied.");
        const updated = { ...record };
        if (op.order.restore === undefined) delete updated[op.order.list];
        else updated[op.order.list] = op.order.restore;
        order[orderKey] = updated;
      }
      const affected = new Set(op.folders.map((patch) => patch.id));
      next = current.filter((folder) => !affected.has(folder.id));
      for (const patch of op.folders) {
        if (!patch.restore) continue;
        const index = patch.beforeId
          ? next.findIndex((folder) => folder.id === patch.beforeId)
          : -1;
        if (patch.beforeId && index < 0)
          throw new Error("Folder position changed after the move; undo was not applied.");
        next.splice(index < 0 ? next.length : index, 0, patch.restore);
      }
      break;
    }
    case "folderCollapsed":
      next = setFolderCollapsed(current, op.folderId, op.collapsed);
      break;
    case "folderPinned":
      next = setFolderPinned(current, op.folderId, op.pinned);
      break;
    case "folderColor":
      next = setFolderColor(current, op.folderId, op.colorIndex);
      break;
    case "folderCustomColor":
      next = setFolderCustomColor(current, op.folderId, op.color);
      break;
    case "replaceSessionIds": {
      const aliases = new Map(op.aliases.map(({ from, to }) => [from, to]));
      next = current.map((folder) => ({
        ...folder,
        sessionIds: folder.sessionIds.map((id) => aliases.get(id) ?? id),
      }));
      break;
    }
  }
  // Legacy stores can contain intentionally empty folders. Existing helpers
  // prune globally, but an unrelated gesture must not erase those records.
  const retainedIds = new Set(next.map((folder) => folder.id));
  for (let index = 0; index < current.length; index++) {
    const folder = current[index];
    if (
      folder.sessionIds.length ||
      retainedIds.has(folder.id) ||
      (op.kind === "deleteFolder" && op.folderId === folder.id) ||
      (op.kind === "undoSessionDrop" &&
        op.folders.some((patch) => patch.id === folder.id && !patch.restore))
    )
      continue;
    next.splice(Math.min(index, next.length), 0, folder);
    retainedIds.add(folder.id);
  }
  folders[key] = next;
  return { folders, order };
}

const gestureSignatures = new Map<string, string>();
const completedGestures = new Map<string, SessionOrganizationResult>();

/** Read-only preflight; the actual transaction rechecks against fresh state. */
export function previewOrganizationOperation(
  state: SessionOrganizationState,
  operation: OrganizationOperation,
): SessionOrganizationState {
  return apply(structuredClone(state), structuredClone(operation));
}

export async function executeOrganizationOperation(
  gestureId: string,
  operation: OrganizationOperation,
): Promise<SessionOrganizationResult> {
  const captured = structuredClone(operation);
  const signature = JSON.stringify(captured);
  const previous = gestureSignatures.get(gestureId);
  if (previous !== undefined && previous !== signature)
    throw new Error("Organization gesture ID was reused with different input.");
  gestureSignatures.set(gestureId, signature);
  const completed = completedGestures.get(gestureId);
  if (completed) return structuredClone(completed);
  const result = await mutateSessionOrganization({
    id: gestureId,
    descriptor: captured,
    apply: (state) => apply(state, captured),
  });
  if (result.state === "applied") completedGestures.set(gestureId, structuredClone(result));
  return result;
}
