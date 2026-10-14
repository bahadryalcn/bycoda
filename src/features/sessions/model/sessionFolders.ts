import { isHexColor } from "../../../shared/lib/colorUtils";
import { compareSessionSummaries } from "../data/sessionHistory";
import type { SessionSummary } from "../data/sessionStore";
import { normalizeProjectPath } from "../../projects/model/recents";
import { orderByIds } from "../../../shared/lib/reorder";
import { TAB_GROUP_COLORS } from "../../workspace/model/tabGroups";

const KEY = "bycoda.sessionFolders";
const CHANGE_EVENT = "bycoda:session-folders-change";
const PINNED_COLLAPSED_KEY = "bycoda.pinnedSessionsCollapsed";
const REMINDERS_COLLAPSED_KEY = "bycoda.reminderSessionsCollapsed";

export type SessionFolder = {
  id: string;
  name: string;
  sessionIds: string[];
  collapsed: boolean;
  /** Palette index from `TAB_GROUP_COLORS`. Missing or 0 is the default wash. */
  colorIndex?: number;
  /** Custom hex from the folder color picker. Wins over `colorIndex`. */
  customColor?: string;
  /** Rows were arranged by hand: `sessionIds` is their order, not recency. */
  ordered?: boolean;
  /** Nested inside this folder. */
  parentId?: string;
  /** A top-level folder shown inside the pinned group. */
  pinned?: boolean;
};

/** Folders nest at most this deep, counting the top level as 1. */
export const MAX_FOLDER_DEPTH = 4;

type FolderListEntry = {
  kind: "folder";
  folder: SessionFolder;
  /** Its own visible sessions. */
  sessions: SessionSummary[];
  /** Visible subfolders, shown before its own sessions. */
  folders: FolderListEntry[];
  /** Every visible session inside, subfolders included. */
  allSessions: SessionSummary[];
};

export type SessionFolderTarget =
  | { kind: "existing"; folderId: string }
  | { kind: "new"; name: string };

/**
 * Where a dragged session lands in the sidebar list:
 * - `folder`: into a folder, from its header;
 * - `pinned`: into the pinned group, from its header;
 * - `insert`: beside a session. `dwell` marks a pointer resting on the
 *   card's middle, counting down to grouping;
 * - `session`: grouped with a session, once that countdown completed.
 */
export type SessionListDropTarget =
  | { kind: "folder"; id: string }
  | { kind: "pinned" }
  | { kind: "insert"; id: string; place: "before" | "after"; dwell?: boolean }
  | { kind: "session"; id: string };

export type SessionListEntry =
  | FolderListEntry
  | {
      kind: "pinned";
      collapsed: boolean;
      sessions: SessionSummary[];
      /** Pinned folders, shown before the pinned sessions. */
      folders: FolderListEntry[];
    }
  | {
      kind: "reminders";
      collapsed: boolean;
      sessions: SessionSummary[];
    }
  | { kind: "session"; session: SessionSummary };

type StoredFolder = {
  id?: unknown;
  name?: unknown;
  sessionIds?: unknown;
  collapsed?: unknown;
  colorIndex?: unknown;
  customColor?: unknown;
  ordered?: unknown;
  parentId?: unknown;
  pinned?: unknown;
};

/** 1 for a top-level folder; unknown ids count as 0. */
export function folderDepth(folders: SessionFolder[], folderId: string): number {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let depth = 0;
  const seen = new Set<string>();
  for (let id: string | undefined = folderId; id && byId.has(id) && !seen.has(id);) {
    seen.add(id);
    depth += 1;
    id = byId.get(id)!.parentId;
  }
  return depth;
}

export function folderContaining(
  folders: SessionFolder[],
  sessionId: string,
): SessionFolder | undefined {
  return folders.find((folder) => folder.sessionIds.includes(sessionId));
}

export function uniqueFolderName(folders: SessionFolder[], base = "New folder"): string {
  const names = new Set(folders.map((folder) => folder.name));
  if (!names.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!names.has(candidate)) return candidate;
  }
}

export function ungroupedSessions(
  sessions: SessionSummary[],
  folders: SessionFolder[],
): SessionSummary[] {
  const grouped = new Set<string>();
  for (const folder of folders) {
    for (const id of folder.sessionIds) grouped.add(id);
  }
  return sessions.filter((session) => !grouped.has(session.id));
}

/** Open tabs that belong to a folder but are not in history yet (blank chats). */
export function mergeFolderSessionSummaries(
  visible: SessionSummary[],
  extras: readonly SessionSummary[],
  folders: SessionFolder[],
): SessionSummary[] {
  if (extras.length === 0 || folders.length === 0) return visible;
  const grouped = new Set<string>();
  for (const folder of folders) {
    for (const id of folder.sessionIds) grouped.add(id);
  }
  const have = new Set(visible.map((session) => session.id));
  const extra = extras.filter((session) => grouped.has(session.id) && !have.has(session.id));
  if (extra.length === 0) return visible;
  return [...visible, ...extra];
}

/**
 * Reminders always lead, followed by folders, pins, and loose sessions.
 * Reminder membership only changes this view, preserving saved folders/pins.
 */
export function buildSessionList(
  visible: SessionSummary[],
  folders: SessionFolder[],
  ungrouped: SessionSummary[],
  pinnedCollapsed = false,
  reminderGroup?: { sessionIds: readonly string[]; collapsed: boolean },
  compareStatus?: (a: SessionSummary, b: SessionSummary) => number,
): SessionListEntry[] {
  const byId = new Map(visible.map((session) => [session.id, session]));
  const reminderIds = new Set(reminderGroup?.sessionIds);
  const entries: SessionListEntry[] = [];
  const reminderSessions = [...reminderIds].flatMap((id) => {
    const session = byId.get(id);
    return session ? [session] : [];
  });
  if (compareStatus) reminderSessions.sort(compareStatus);
  if (reminderSessions.length) {
    entries.push({
      kind: "reminders",
      collapsed: reminderGroup?.collapsed ?? false,
      sessions: reminderSessions,
    });
  }
  const childrenOf = new Map<string, SessionFolder[]>();
  for (const folder of folders) {
    if (!folder.parentId) continue;
    childrenOf.set(folder.parentId, [...(childrenOf.get(folder.parentId) ?? []), folder]);
  }
  const folderEntry = (folder: SessionFolder, seen: Set<string>): FolderListEntry | null => {
    if (seen.has(folder.id)) return null;
    const path = new Set(seen).add(folder.id);
    const members: SessionSummary[] = [];
    for (const id of folder.sessionIds) {
      const session = byId.get(id);
      if (session && !reminderIds.has(id)) members.push(session);
    }
    if (!folder.ordered) members.sort(compareSessionSummaries);
    if (compareStatus) members.sort(compareStatus);
    const children = (childrenOf.get(folder.id) ?? []).flatMap((child) => {
      const entry = folderEntry(child, path);
      return entry ? [entry] : [];
    });
    if (members.length === 0 && children.length === 0) return null;
    return {
      kind: "folder",
      folder,
      sessions: members,
      folders: children,
      allSessions: [...children.flatMap((child) => child.allSessions), ...members],
    };
  };
  const topLevel = folders.flatMap((folder) => {
    if (folder.parentId) return [];
    const entry = folderEntry(folder, new Set());
    return entry ? [entry] : [];
  });
  for (const entry of topLevel) {
    if (!entry.folder.pinned) entries.push(entry);
  }

  const remaining = ungrouped.filter((session) => !reminderIds.has(session.id));
  if (compareStatus) remaining.sort(compareStatus);
  const pinned = remaining.filter((session) => session.pinned);
  const pinnedFolders = topLevel.filter((entry) => entry.folder.pinned);
  if (pinned.length > 0 || pinnedFolders.length > 0) {
    entries.push({
      kind: "pinned",
      collapsed: pinnedCollapsed,
      sessions: pinned,
      folders: pinnedFolders,
    });
  }
  for (const session of remaining) {
    if (!session.pinned) entries.push({ kind: "session", session });
  }
  return entries;
}

export function sessionListNavigationIds(
  entries: readonly SessionListEntry[],
  expandCollapsed: boolean,
): string[] {
  const ids: string[] = [];
  // Matches the drawn order: subfolders, then the folder's own sessions.
  const visit = (entry: FolderListEntry) => {
    if (entry.folder.collapsed && !expandCollapsed) return;
    for (const child of entry.folders) visit(child);
    ids.push(...entry.sessions.map((session) => session.id));
  };
  for (const entry of entries) {
    if (entry.kind === "session") {
      ids.push(entry.session.id);
      continue;
    }
    if (entry.kind === "pinned" || entry.kind === "reminders") {
      if (!entry.collapsed || expandCollapsed) {
        if (entry.kind === "pinned") for (const folder of entry.folders) visit(folder);
        ids.push(...entry.sessions.map((session) => session.id));
      }
      continue;
    }
    visit(entry);
  }
  return ids;
}

export function createFolderWithSessions(
  folders: SessionFolder[],
  sessionIds: string[],
  name?: string,
  placement: { parentId?: string; pinned?: boolean } = {},
): { folders: SessionFolder[]; id: string } {
  const ids = uniqueIds(sessionIds);
  if (ids.length === 0) return { folders, id: "" };
  const parentId =
    placement.parentId && folders.some((folder) => folder.id === placement.parentId)
      ? placement.parentId
      : undefined;
  // Removing the sessions may empty the parent itself; it then survives as
  // the new folder's container, so prune only after inserting.
  const next = folders.map((folder) =>
    folder.sessionIds.some((id) => ids.includes(id))
      ? { ...folder, sessionIds: folder.sessionIds.filter((id) => !ids.includes(id)) }
      : folder,
  );
  const id = crypto.randomUUID();
  const folder: SessionFolder = {
    id,
    name: name ?? uniqueFolderName(next),
    sessionIds: ids,
    collapsed: false,
    ...(parentId ? { parentId } : placement.pinned ? { pinned: true } : {}),
  };
  return { folders: removeEmpty([folder, ...next]), id };
}

/** Pins a top-level folder into the pinned group, or takes it back out. */
export function setFolderPinned(
  folders: SessionFolder[],
  folderId: string,
  pinned: boolean,
): SessionFolder[] {
  const folder = folders.find((entry) => entry.id === folderId);
  if (!folder || folder.parentId || !!folder.pinned === pinned) return folders;
  return folders.map((entry) =>
    entry.id === folderId ? { ...entry, pinned: pinned || undefined } : entry,
  );
}

/** Moves a nested folder up one level, keeping its pinned place at the top. */
export function moveFolderOut(folders: SessionFolder[], folderId: string): SessionFolder[] {
  const folder = folders.find((entry) => entry.id === folderId);
  const parent = folder?.parentId
    ? folders.find((entry) => entry.id === folder.parentId)
    : undefined;
  if (!folder || !parent) return folders;
  return folders.map((entry) => {
    if (entry.id !== folderId) return entry;
    const { parentId: _parent, ...rest } = entry;
    return parent.parentId
      ? { ...rest, parentId: parent.parentId }
      : { ...rest, ...(parent.pinned ? { pinned: true } : {}) };
  });
}

export function addSessionToFolder(
  folders: SessionFolder[],
  folderId: string,
  sessionId: string,
): SessionFolder[] {
  if (!sessionId || !folders.some((folder) => folder.id === folderId)) {
    return folders;
  }
  const current = folderContaining(folders, sessionId);
  if (current?.id === folderId) return folders;
  return removeEmpty(
    folders.map((folder) => {
      if (folder.id === folderId) {
        return { ...folder, sessionIds: [...folder.sessionIds, sessionId] };
      }
      if (!folder.sessionIds.includes(sessionId)) return folder;
      return {
        ...folder,
        sessionIds: folder.sessionIds.filter((id) => id !== sessionId),
      };
    }),
  );
}

export function placeSessionInFolder(
  folders: SessionFolder[],
  sessionId: string,
  target: SessionFolderTarget,
): SessionFolder[] {
  if (target.kind === "existing") {
    return setFolderCollapsed(
      addSessionToFolder(folders, target.folderId, sessionId),
      target.folderId,
      false,
    );
  }
  const name = target.name.trim();
  if (!name) return folders;
  return createFolderWithSessions(folders, [sessionId], name).folders;
}

/**
 * Makes `memberIds` the folder's hand-arranged contents, taking any of them
 * out of other folders. Folders left empty disappear.
 */
export function arrangeFolderSessions(
  folders: SessionFolder[],
  folderId: string,
  memberIds: string[],
): SessionFolder[] {
  if (!folders.some((folder) => folder.id === folderId)) return folders;
  const ids = uniqueIds(memberIds);
  const others = removeSessions(
    folders.filter((folder) => folder.id !== folderId),
    ids,
  );
  const target = folders.find((folder) => folder.id === folderId)!;
  const arranged = { ...target, sessionIds: ids, ordered: true, collapsed: false };
  const index = folders.findIndex((folder) => folder.id === folderId);
  const next = [...others];
  next.splice(Math.min(index, next.length), 0, arranged);
  return removeEmpty(next);
}

export function removeSessionsFromFolders(
  folders: SessionFolder[],
  sessionIds: string[],
): SessionFolder[] {
  return sessionIds.some((id) => folderContaining(folders, id))
    ? removeSessions(folders, sessionIds)
    : folders;
}

export function removeSessionFromFolder(
  folders: SessionFolder[],
  sessionId: string,
): SessionFolder[] {
  if (!folderContaining(folders, sessionId)) return folders;
  return removeEmpty(
    folders.map((folder) =>
      folder.sessionIds.includes(sessionId)
        ? {
            ...folder,
            sessionIds: folder.sessionIds.filter((id) => id !== sessionId),
          }
        : folder,
    ),
  );
}

export function dissolveFolder(folders: SessionFolder[], folderId: string): SessionFolder[] {
  const gone = folders.find((folder) => folder.id === folderId);
  if (!gone) return folders;
  return removeEmpty(
    folders.flatMap((folder) => {
      if (folder.id === folderId) return [];
      if (folder.id === gone.parentId) {
        return [{ ...folder, sessionIds: uniqueIds([...folder.sessionIds, ...gone.sessionIds]) }];
      }
      if (folder.parentId !== folderId) return [folder];
      const { parentId: _parent, ...rest } = folder;
      return [
        gone.parentId
          ? { ...rest, parentId: gone.parentId }
          : { ...rest, ...(gone.pinned ? { pinned: true } : {}) },
      ];
    }),
  );
}

export function renameFolder(
  folders: SessionFolder[],
  folderId: string,
  name: string,
): SessionFolder[] {
  const trimmed = name.trim();
  if (!trimmed) return folders;
  const folder = folders.find((entry) => entry.id === folderId);
  if (!folder || folder.name === trimmed) return folders;
  return folders.map((entry) => (entry.id === folderId ? { ...entry, name: trimmed } : entry));
}

export function setFolderCollapsed(
  folders: SessionFolder[],
  folderId: string,
  collapsed: boolean,
): SessionFolder[] {
  const folder = folders.find((entry) => entry.id === folderId);
  if (!folder || folder.collapsed === collapsed) return folders;
  return folders.map((entry) => (entry.id === folderId ? { ...entry, collapsed } : entry));
}

export function setFolderColor(
  folders: SessionFolder[],
  folderId: string,
  colorIndex: number | null,
): SessionFolder[] {
  const folder = folders.find((entry) => entry.id === folderId);
  const nextIndex = sanitizeColorIndex(colorIndex);
  if (!folder || (folder.colorIndex === nextIndex && folder.customColor == null)) {
    return folders;
  }
  return folders.map((entry) => {
    if (entry.id !== folderId) return entry;
    const next = withoutColors(entry);
    return nextIndex == null ? next : { ...next, colorIndex: nextIndex };
  });
}

export function setFolderCustomColor(
  folders: SessionFolder[],
  folderId: string,
  color: string | null,
): SessionFolder[] {
  const folder = folders.find((entry) => entry.id === folderId);
  if (!folder) return folders;
  if (color == null) {
    if (folder.customColor == null) return folders;
    return folders.map((entry) => (entry.id === folderId ? withoutColors(entry) : entry));
  }
  const hex = parseCustomHex(color);
  if (hex == null) return folders;
  if (folder.customColor === hex && folder.colorIndex == null) return folders;
  return folders.map((entry) =>
    entry.id === folderId ? { ...withoutColors(entry), customColor: hex } : entry,
  );
}

/** Reorder only the named folders; anything else keeps its slot. */
export function reorderSessionFolders(folders: SessionFolder[], ids: string[]): SessionFolder[] {
  const idSet = new Set(ids);
  const moving = folders.filter((folder) => idSet.has(folder.id));
  const ordered = orderByIds(moving, ids);
  if (
    ordered.length !== moving.length ||
    ordered.every((folder, index) => folder.id === moving[index]?.id)
  ) {
    return folders;
  }
  let next = 0;
  return folders.map((folder) => (idSet.has(folder.id) ? ordered[next++]! : folder));
}

/** Saturated project palette or custom hex, or undefined for the default wash. */
export function folderAccent(
  colorIndex: number | undefined,
  customColor?: string,
): string | undefined {
  const hex = parseCustomHex(customColor);
  if (hex) return hex;
  const index = sanitizeColorIndex(colorIndex ?? null);
  return index == null ? undefined : TAB_GROUP_COLORS[index];
}

/** Quiet fill so a folder tint never reads as a solid chip. */
export function folderShellFill(
  colorIndex: number | undefined,
  customColor?: string,
): string | undefined {
  const accent = folderAccent(colorIndex, customColor);
  if (!accent) return undefined;
  return `color-mix(in srgb, ${accent} 18%, transparent)`;
}

function sanitizeColorIndex(colorIndex: number | null): number | undefined {
  if (
    colorIndex == null ||
    !Number.isInteger(colorIndex) ||
    colorIndex <= 0 ||
    colorIndex >= TAB_GROUP_COLORS.length
  ) {
    return undefined;
  }
  return colorIndex;
}

/**
 * Dropping on a folder (or a session already in one) joins that folder.
 * Dropping on an ungrouped session opens a new folder around both.
 */
export function applySessionListDrop(
  folders: SessionFolder[],
  draggedId: string,
  target: SessionListDropTarget,
): { folders: SessionFolder[]; createdId?: string } {
  if (!draggedId) return { folders };
  if (target.kind === "session" && target.id === draggedId) {
    return { folders };
  }
  if (target.kind === "pinned" || target.kind === "insert") return { folders };
  if (target.kind === "folder") {
    const next = addSessionToFolder(folders, target.id, draggedId);
    return { folders: setFolderCollapsed(next, target.id, false) };
  }
  const dest = folderContaining(folders, target.id);
  if (dest) {
    if (folderContaining(folders, draggedId)?.id === dest.id) {
      return { folders };
    }
    const next = addSessionToFolder(folders, dest.id, draggedId);
    return { folders: setFolderCollapsed(next, dest.id, false) };
  }
  const { folders: next, id } = createFolderWithSessions(folders, [draggedId, target.id]);
  return id ? { folders: next, createdId: id } : { folders };
}

export function pruneSessionFolders(
  folders: SessionFolder[],
  knownIds: ReadonlySet<string>,
): SessionFolder[] {
  let changed = false;
  const trimmed = folders.map((folder) => {
    const sessionIds = folder.sessionIds.filter((id) => knownIds.has(id));
    if (sessionIds.length === folder.sessionIds.length) return folder;
    changed = true;
    return { ...folder, sessionIds };
  });
  const next = removeEmpty(trimmed);
  return changed || next.length !== folders.length ? next : folders;
}

export function loadSessionFolders(cwd: string): SessionFolder[] {
  const key = storageKey(cwd);
  if (!key) return [];
  return parseStore()[key] ?? [];
}

export function saveSessionFolders(cwd: string, folders: SessionFolder[]): void {
  const key = storageKey(cwd);
  if (!key) return;
  try {
    const store = parseStore();
    if (folders.length === 0) delete store[key];
    else store[key] = folders;
    localStorage.setItem(KEY, JSON.stringify(store));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { cwd: key } }));
    }
  } catch {
    // private mode / quota
  }
}

/** Move folder and collapsed-section state when a project path changes. */
export function rebaseSessionFolderSettings(from: string, to: string): void {
  const oldKey = storageKey(from);
  const newKey = storageKey(to);
  if (!oldKey || !newKey || oldKey === newKey) return;
  try {
    const folders = parseStore();
    if (oldKey in folders) {
      if (!(newKey in folders)) folders[newKey] = folders[oldKey];
      delete folders[oldKey];
      localStorage.setItem(KEY, JSON.stringify(folders));
    }
    for (const storeKey of [PINNED_COLLAPSED_KEY, REMINDERS_COLLAPSED_KEY]) {
      const raw = localStorage.getItem(storeKey);
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const state = { ...(parsed as Record<string, unknown>) };
      if (!(oldKey in state)) continue;
      if (!(newKey in state)) state[newKey] = state[oldKey];
      delete state[oldKey];
      localStorage.setItem(storeKey, JSON.stringify(state));
    }
  } catch {
    // private mode / quota
  }
}

export function loadPinnedSessionsCollapsed(cwd: string): boolean {
  return loadGroupCollapsed(cwd, PINNED_COLLAPSED_KEY);
}

export function loadReminderSessionsCollapsed(cwd: string): boolean {
  return loadGroupCollapsed(cwd, REMINDERS_COLLAPSED_KEY);
}

function loadGroupCollapsed(cwd: string, storeKey: string): boolean {
  const key = storageKey(cwd);
  if (!key) return false;
  try {
    const raw = localStorage.getItem(storeKey);
    if (!raw) return false;
    const parsed: unknown = JSON.parse(raw);
    return Boolean(
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      (parsed as Record<string, unknown>)[key] === true,
    );
  } catch {
    return false;
  }
}

export function savePinnedSessionsCollapsed(cwd: string, collapsed: boolean): void {
  saveGroupCollapsed(cwd, collapsed, PINNED_COLLAPSED_KEY);
}

export function saveReminderSessionsCollapsed(cwd: string, collapsed: boolean): void {
  saveGroupCollapsed(cwd, collapsed, REMINDERS_COLLAPSED_KEY);
}

function saveGroupCollapsed(cwd: string, collapsed: boolean, storeKey: string): void {
  const key = storageKey(cwd);
  if (!key) return;
  try {
    const raw = localStorage.getItem(storeKey);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const store =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? { ...(parsed as Record<string, unknown>) }
        : {};
    if (collapsed) store[key] = true;
    else delete store[key];
    localStorage.setItem(storeKey, JSON.stringify(store));
  } catch {
    // private mode / quota
  }
}

export function subscribeSessionFolders(cwd: string, onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const key = storageKey(cwd);
  if (!key) return () => undefined;
  const listener = (event: Event) => {
    const changed = (event as CustomEvent<{ cwd?: string }>).detail?.cwd;
    if (changed === key) onChange();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

function storageKey(cwd: string): string | null {
  if (!cwd || cwd === "~") return null;
  return normalizeProjectPath(cwd);
}

function parseStore(): Record<string, SessionFolder[]> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, SessionFolder[]> = {};
    for (const [cwd, value] of Object.entries(parsed)) {
      if (!cwd || cwd === "~") continue;
      const folders = parseFolders(value);
      if (folders.length > 0) out[normalizeProjectPath(cwd)] = folders;
    }
    return out;
  } catch {
    return {};
  }
}

function parseFolders(value: unknown): SessionFolder[] {
  if (!Array.isArray(value)) return [];
  const out: SessionFolder[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const folder = parseFolder(item);
    if (!folder || seen.has(folder.id)) continue;
    seen.add(folder.id);
    out.push(folder);
  }
  const ids = new Set(out.map((folder) => folder.id));
  const linked = out.map((folder) => {
    if (!folder.parentId) return folder;
    const valid = ids.has(folder.parentId) && folderDepth(out, folder.id) <= out.length;
    const loops = (() => {
      const byId = new Map(out.map((entry) => [entry.id, entry]));
      const seenIds = new Set<string>();
      for (let id: string | undefined = folder.id; id; id = byId.get(id)?.parentId) {
        if (seenIds.has(id)) return true;
        seenIds.add(id);
      }
      return false;
    })();
    if (valid && !loops) return folder;
    const { parentId: _parent, ...rest } = folder;
    return rest;
  });
  return removeEmpty(linked);
}

function parseFolder(value: unknown): SessionFolder | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as StoredFolder;
  if (typeof rec.id !== "string" || !rec.id) return null;
  if (typeof rec.name !== "string") return null;
  const name = rec.name.trim();
  if (!name) return null;
  if (!Array.isArray(rec.sessionIds)) return null;
  const sessionIds = uniqueIds(
    rec.sessionIds.filter((id): id is string => typeof id === "string" && !!id),
  );
  const customColor = parseCustomHex(typeof rec.customColor === "string" ? rec.customColor : null);
  const colorIndex = sanitizeColorIndex(typeof rec.colorIndex === "number" ? rec.colorIndex : null);
  return {
    id: rec.id,
    name,
    sessionIds,
    collapsed: rec.collapsed === true,
    ...(customColor != null ? { customColor } : colorIndex != null ? { colorIndex } : {}),
    ...(rec.ordered === true ? { ordered: true } : {}),
    ...(typeof rec.parentId === "string" && rec.parentId && rec.parentId !== rec.id
      ? { parentId: rec.parentId }
      : rec.pinned === true
        ? { pinned: true }
        : {}),
  };
}

function parseCustomHex(color: string | null | undefined): string | undefined {
  if (typeof color !== "string" || !isHexColor(color)) return undefined;
  return color.toLowerCase();
}

function withoutColors(folder: SessionFolder): SessionFolder {
  const { colorIndex: _index, customColor: _custom, ...rest } = folder;
  return rest;
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function removeSessions(folders: SessionFolder[], sessionIds: string[]): SessionFolder[] {
  const drop = new Set(sessionIds);
  return removeEmpty(
    folders.map((folder) => {
      if (!folder.sessionIds.some((id) => drop.has(id))) return folder;
      return {
        ...folder,
        sessionIds: folder.sessionIds.filter((id) => !drop.has(id)),
      };
    }),
  );
}

/** Drops folders with no sessions anywhere inside them. */
function removeEmpty(folders: SessionFolder[]): SessionFolder[] {
  const childrenOf = new Map<string, SessionFolder[]>();
  for (const folder of folders) {
    if (folder.parentId) {
      childrenOf.set(folder.parentId, [...(childrenOf.get(folder.parentId) ?? []), folder]);
    }
  }
  const holds = new Map<string, boolean>();
  const hasSessions = (folder: SessionFolder, path: Set<string>): boolean => {
    const known = holds.get(folder.id);
    if (known !== undefined) return known;
    if (path.has(folder.id)) return false;
    const next = new Set(path).add(folder.id);
    const result =
      folder.sessionIds.length > 0 ||
      (childrenOf.get(folder.id) ?? []).some((child) => hasSessions(child, next));
    holds.set(folder.id, result);
    return result;
  };
  const kept = folders.filter((folder) => hasSessions(folder, new Set()));
  return kept.length === folders.length ? folders : kept;
}

/**
 * Where a dragged folder lands:
 * - `into`: nested in another folder, as its last subfolder;
 * - `beside`: next to a folder, at that folder's level;
 * - `pinned`: a top-level folder in the pinned group;
 * - `root`: a top-level folder outside the pinned group.
 */
export type FolderMoveTarget =
  | { kind: "into"; id: string }
  | { kind: "beside"; id: string; place: "before" | "after" }
  | { kind: "pinned" }
  | { kind: "root" };

/** True when `id` is `ancestorId` or nested anywhere below it. */
export function isFolderWithin(folders: SessionFolder[], ancestorId: string, id: string): boolean {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const seen = new Set<string>();
  for (let at: string | undefined = id; at && !seen.has(at); at = byId.get(at)?.parentId) {
    if (at === ancestorId) return true;
    seen.add(at);
  }
  return false;
}

/** Levels in a folder's subtree, itself included. */
function folderHeight(
  folders: SessionFolder[],
  folderId: string,
  seen = new Set<string>(),
): number {
  if (seen.has(folderId)) return 0;
  seen.add(folderId);
  let deepest = 0;
  for (const folder of folders) {
    if (folder.parentId === folderId)
      deepest = Math.max(deepest, folderHeight(folders, folder.id, seen));
  }
  return 1 + deepest;
}

export function canMoveFolder(
  folders: SessionFolder[],
  folderId: string,
  target: FolderMoveTarget,
): boolean {
  if (!folders.some((folder) => folder.id === folderId)) return false;
  if (target.kind === "pinned" || target.kind === "root") return true;
  const anchor = folders.find((folder) => folder.id === target.id);
  if (!anchor || isFolderWithin(folders, folderId, anchor.id)) return false;
  const parentDepth =
    target.kind === "into"
      ? folderDepth(folders, anchor.id)
      : anchor.parentId
        ? folderDepth(folders, anchor.parentId)
        : 0;
  return parentDepth + folderHeight(folders, folderId) <= MAX_FOLDER_DEPTH;
}

/** Moves a folder with everything inside it. Refused moves return `folders`. */
export function moveFolder(
  folders: SessionFolder[],
  folderId: string,
  target: FolderMoveTarget,
): SessionFolder[] {
  if (!canMoveFolder(folders, folderId, target)) return folders;
  const folder = folders.find((entry) => entry.id === folderId)!;
  const { parentId: _parent, pinned: _pinned, ...base } = folder;
  let rest = folders.filter((entry) => entry.id !== folderId);
  let index = rest.length;
  let moved: SessionFolder = base;
  if (target.kind === "into") {
    moved = { ...base, parentId: target.id };
    rest = setFolderCollapsed(rest, target.id, false);
  } else if (target.kind === "beside") {
    const anchor = rest.find((entry) => entry.id === target.id)!;
    moved = anchor.parentId
      ? { ...base, parentId: anchor.parentId }
      : anchor.pinned
        ? { ...base, pinned: true }
        : base;
    index = rest.indexOf(anchor) + (target.place === "after" ? 1 : 0);
  } else if (target.kind === "pinned") {
    moved = { ...base, pinned: true };
  }
  const next = [...rest];
  next.splice(index, 0, moved);
  const unchanged =
    moved.parentId === folder.parentId &&
    !!moved.pinned === !!folder.pinned &&
    next.every((entry, at) => entry === moved || entry === folders[at]) &&
    next.every((entry, at) => entry.id === folders[at]?.id);
  return unchanged ? folders : next;
}
