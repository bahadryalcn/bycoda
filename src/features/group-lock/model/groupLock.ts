import {
  loadProjectGroupAssignments,
  loadProjectGroups,
  saveProjectGroups,
  updateProjectGroup,
  type ProjectGroup,
} from "../../projects/model/projectGroups";
import { subscribeProjectPathsChanged } from "../../projects/model/recents";
import { autoLockDue, type AutoLockMinutes } from "./autoLock";
import {
  blockedForMs,
  NO_ATTEMPTS,
  parseAttemptState,
  recordFailure,
  type AttemptState,
} from "./attemptThrottle";
import {
  computeLockSnapshot,
  initialUnlocked,
  isProjectLockedIn,
  lockReducer,
  visibleProjects as filterVisible,
  type LockAction,
  type LockSnapshot,
  type UnlockedGroups,
} from "./lockState";
import { parseGroupLockSettings, parseUnlockedIds, type GroupLockSettings } from "./lockSettings";
import { createPasswordRecord, verifyPassword, type PasswordRecord } from "./passwordRecord";

/**
 * The app lock for project groups. One password, many groups.
 *
 * What lives where: the password hash and options are in localStorage with the
 * other settings; each group's `lockable` flag is on its record; which groups
 * are currently open is held in memory only (and mirrored to other windows
 * over a BroadcastChannel). This is an access lock for the Bycoda interface.
 * It does not encrypt anything on disk.
 */
const SETTINGS_KEY = "bycoda.groupLock";
const UNLOCKED_KEY = "bycoda.groupLock.unlocked";
const HIDDEN_KEY = "bycoda.groupLock.hiddenGroups.v1";
const ATTEMPTS_KEY = "bycoda.groupLock.attempts";
const CHANNEL_NAME = "bycoda.groupLock";
const GROUPS_KEY = "bycoda.projectGroups";
const ASSIGNMENTS_KEY = "bycoda.projectGroupAssignments";
const ACTIVITY_BROADCAST_MS = 5_000;
const AUTO_LOCK_CHECK_MS = 10_000;

export type GroupLockView = {
  lock: LockSnapshot;
  hasPassword: boolean;
  settings: Omit<GroupLockSettings, "record">;
  groups: readonly ProjectGroup[];
  hiddenGroupIds: ReadonlySet<string>;
  savedHiddenGroupIds: ReadonlySet<string>;
  hiddenGroupsAuthorized: boolean;
};

export type VerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason: "wrong" | "blocked" | "no-password";
      /** How long until another attempt is accepted. */
      retryAfterMs: number;
    };

function readItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // private mode / quota
  }
}

let settings: GroupLockSettings = parseGroupLockSettings(readItem(SETTINGS_KEY));
let unlocked: UnlockedGroups = initialUnlocked(
  settings.relockOnLaunch,
  parseUnlockedIds(readItem(UNLOCKED_KEY)),
);
let view: GroupLockView | null = null;
let hiddenGroups = new Set(parseUnlockedIds(readItem(HIDDEN_KEY)));
let temporarilyVisible = new Set<string>();
let hiddenGroupsAuthorized = false;
let previousLock: LockSnapshot | null = null;
const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;
let lastActivityAt = Date.now();

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

function currentView(): GroupLockView {
  if (view) return view;
  const groups = loadProjectGroups();
  const hasPassword = settings.record !== null;
  const savedHiddenGroupIds = new Set(
    groups.filter((group) => hiddenGroups.has(group.id)).map((group) => group.id),
  );
  const hiddenGroupIds = new Set(
    [...savedHiddenGroupIds].filter((id) => !temporarilyVisible.has(id)),
  );
  let lock = computeLockSnapshot({
    groups,
    assignments: loadProjectGroupAssignments(groups),
    hasPassword,
    unlocked,
    hiddenGroupIds,
  });
  // Keep the object when nothing changed so hooks that read only the lock
  // state do not re-render for unrelated rail edits.
  if (
    previousLock &&
    sameSet(previousLock.lockedGroupIds, lock.lockedGroupIds) &&
    sameSet(previousLock.lockedProjectKeys, lock.lockedProjectKeys)
  ) {
    lock = previousLock;
  }
  previousLock = lock;
  const { record: _record, ...options } = settings;
  view = {
    lock,
    hasPassword,
    settings: options,
    groups,
    hiddenGroupIds,
    savedHiddenGroupIds,
    hiddenGroupsAuthorized,
  };
  return view;
}

function invalidate() {
  view = null;
  for (const listener of [...listeners]) listener();
}

export function subscribeGroupLock(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getGroupLockView(): GroupLockView {
  return currentView();
}

export function isProjectLocked(path: string): boolean {
  return isProjectLockedIn(currentView().lock, path);
}

/** Execution policy uses password locks only; hiding is a visibility preference. */
export function isProjectPasswordLocked(path: string): boolean {
  const groups = loadProjectGroups();
  return isProjectLockedIn(
    computeLockSnapshot({
      groups,
      assignments: loadProjectGroupAssignments(groups),
      hasPassword: settings.record !== null,
      unlocked,
    }),
    path,
  );
}

/** Drops the items that belong to a locked group. */
export function visibleProjects<T>(items: readonly T[], pathOf: (item: T) => string): T[] {
  return filterVisible(currentView().lock, items, pathOf);
}

function persistUnlocked() {
  writeItem(UNLOCKED_KEY, settings.relockOnLaunch ? null : JSON.stringify([...unlocked]));
}

function dispatch(action: LockAction) {
  if (action.type === "lock" || action.type === "lockAll") {
    hiddenGroupsAuthorized = false;
    if (action.type === "lockAll") temporarilyVisible.clear();
    else for (const id of action.groupIds) temporarilyVisible.delete(id);
  }
  unlocked = lockReducer(unlocked, action);
  persistUnlocked();
  channel?.postMessage({
    type: "state",
    groupIds: [...unlocked],
    visibleHiddenIds: [...temporarilyVisible],
  });
  invalidate();
}

function saveSettings(next: GroupLockSettings, requirePersistence = false) {
  const recordChanged = JSON.stringify(settings.record) !== JSON.stringify(next.record);
  if (requirePersistence) {
    // A password must survive restart before the UI reports that it is set.
    // Keep the previous record in memory if storage rejects the write.
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } else {
    writeItem(SETTINGS_KEY, JSON.stringify(next));
  }
  settings = next;
  if (recordChanged) hiddenGroupsAuthorized = false;
  persistUnlocked();
  invalidate();
  if (recordChanged && !applyingRemoteLock) {
    for (const listener of lockRecordListeners) listener(next.record);
  }
}

const lockRecordListeners = new Set<(record: PasswordRecord | null) => void>();
let applyingRemoteLock = false;

export function subscribeLockRecordChanges(
  listener: (record: PasswordRecord | null) => void,
): () => void {
  lockRecordListeners.add(listener);
  return () => lockRecordListeners.delete(listener);
}

/** Applies a password record (or its absence) learned from a peer, without
 * re-announcing it as a local change. Clearing the record also drops every
 * group's unlocked-in-memory state, same as `clearPassword` does when the
 * password is removed here directly; it does not touch any group's
 * `lockable` flag (that is a `ProjectGroup` field, synced separately). */
export function applyRemoteLockRecord(record: PasswordRecord | null): void {
  if (JSON.stringify(settings.record) === JSON.stringify(record)) return;
  applyingRemoteLock = true;
  try {
    if (!record) {
      unlocked = new Set();
      temporarilyVisible.clear();
    }
    saveSettings({ ...settings, record });
  } finally {
    applyingRemoteLock = false;
  }
}

// ---- attempts --------------------------------------------------------------

function readAttempts(): AttemptState {
  const raw = readItem(ATTEMPTS_KEY);
  if (!raw) return NO_ATTEMPTS;
  try {
    return parseAttemptState(JSON.parse(raw));
  } catch {
    return NO_ATTEMPTS;
  }
}

function writeAttempts(state: AttemptState) {
  writeItem(ATTEMPTS_KEY, state.failures === 0 ? null : JSON.stringify(state));
}

/** Milliseconds until a password is accepted again after too many wrong ones. */
export function lockCooldownMs(): number {
  return blockedForMs(readAttempts(), Date.now());
}

/**
 * Checks a password against the stored hash, counting wrong guesses. Every
 * place that asks for the password goes through here, so the cool-down cannot
 * be sidestepped by switching dialogs.
 */
export async function verifyLockPassword(password: string): Promise<VerifyResult> {
  const record = settings.record;
  if (!record) return { ok: false, reason: "no-password", retryAfterMs: 0 };
  const wait = blockedForMs(readAttempts(), Date.now());
  if (wait > 0) return { ok: false, reason: "blocked", retryAfterMs: wait };
  let matches = false;
  try {
    matches = await verifyPassword(password, record);
  } catch {
    matches = false;
  }
  if (matches) {
    writeAttempts(NO_ATTEMPTS);
    return { ok: true };
  }
  const failed = recordFailure(readAttempts(), Date.now());
  writeAttempts(failed);
  return {
    ok: false,
    reason: "wrong",
    retryAfterMs: blockedForMs(failed, Date.now()),
  };
}

// ---- password --------------------------------------------------------------

export async function setLockPassword(password: string): Promise<void> {
  const record = await createPasswordRecord(password);
  saveSettings({ ...settings, record }, true);
  writeAttempts(NO_ATTEMPTS);
}

export async function changeLockPassword(current: string, next: string): Promise<VerifyResult> {
  const result = await verifyLockPassword(current);
  if (result.ok) await setLockPassword(next);
  return result;
}

/** Forgets the password and un-marks every group; their projects stay put. */
function clearPassword() {
  temporarilyVisible.clear();
  hiddenGroupsAuthorized = false;
  saveProjectGroups(loadProjectGroups().map(({ lockable: _lockable, ...group }) => group));
  writeAttempts(NO_ATTEMPTS);
  unlocked = new Set();
  saveSettings({ ...settings, record: null });
  channel?.postMessage({ type: "state", groupIds: [] });
}

export async function removeLockPassword(current: string): Promise<VerifyResult> {
  const result = await verifyLockPassword(current);
  if (result.ok) clearPassword();
  return result;
}

/**
 * The "forgot password" reset. Nothing is asked of the user here beyond what
 * the caller's dialog asks: there is no second factor on this device.
 */
export function resetForgottenPassword() {
  clearPassword();
}

// ---- groups ----------------------------------------------------------------

/** Hiding is a device preference; it does not change group membership or jobs. */
export function hideGroup(groupId: string): boolean {
  if (!loadProjectGroups().some((group) => group.id === groupId)) return false;
  const next = new Set([...hiddenGroups, groupId]);
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
  } catch {
    return false;
  }
  hiddenGroups = next;
  temporarilyVisible.delete(groupId);
  hiddenGroupsAuthorized = false;
  dispatch({ type: "replace", groupIds: [...unlocked] });
  return true;
}

export async function authorizeHiddenGroups(password: string): Promise<VerifyResult> {
  const result = await verifyLockPassword(password);
  if (result.ok) {
    hiddenGroupsAuthorized = true;
    invalidate();
  }
  return result;
}

export function closeHiddenGroups() {
  hiddenGroupsAuthorized = false;
  invalidate();
}

/** Restore only this group, even when the unlock-all preference is enabled. */
export function restoreHiddenGroup(groupId: string, temporary = false): boolean {
  if (settings.record && !hiddenGroupsAuthorized) return false;
  if (!hiddenGroups.has(groupId)) return false;
  if (temporary) temporarilyVisible.add(groupId);
  else {
    const next = new Set(hiddenGroups);
    next.delete(groupId);
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
    } catch {
      return false;
    }
    hiddenGroups = next;
    temporarilyVisible.delete(groupId);
  }
  dispatch({ type: "unlock", groupIds: [groupId] });
  return true;
}

/** Marks the group lockable, leaving it open until it is locked. */
export function makeGroupLockable(groupId: string) {
  if (!settings.record) return;
  updateProjectGroup(groupId, (group) => ({ ...group, lockable: true }));
  dispatch({ type: "unlock", groupIds: [groupId] });
}

/** Locks a lockable group now and folds it away. */
export function lockGroup(groupId: string) {
  dispatch({ type: "lock", groupIds: [groupId] });
  updateProjectGroup(groupId, (group) => ({ ...group, collapsed: true }));
}

export function lockAllGroups() {
  dispatch({ type: "lockAll" });
}

/** Opens the group when the password is right, and expands it. */
export async function unlockGroup(groupId: string, password: string): Promise<VerifyResult> {
  const result = await verifyLockPassword(password);
  if (!result.ok) return result;
  const locked = currentView().lock.lockedGroupIds;
  dispatch({
    type: "unlock",
    groupIds: settings.unlockAll ? [...locked, groupId] : [groupId],
  });
  updateProjectGroup(groupId, (group) => ({ ...group, collapsed: false }));
  return result;
}

/** Takes the lock off one group. Asks for the password even when it is open. */
export async function removeGroupLock(groupId: string, password: string): Promise<VerifyResult> {
  const result = await verifyLockPassword(password);
  if (!result.ok) return result;
  updateProjectGroup(groupId, ({ lockable: _lockable, ...group }) => group);
  dispatch({ type: "lock", groupIds: [groupId] });
  return result;
}

// ---- options ---------------------------------------------------------------

export function setRelockOnLaunch(value: boolean) {
  saveSettings({ ...settings, relockOnLaunch: value });
}

export function setStartInPrivacyMode(value: boolean) {
  saveSettings({ ...settings, startInPrivacyMode: value });
}

export function setAutoLockMinutes(value: AutoLockMinutes) {
  saveSettings({ ...settings, autoLockMinutes: value });
}

export function setUnlockAll(value: boolean) {
  saveSettings({ ...settings, unlockAll: value });
}

// ---- sync and inactivity ---------------------------------------------------

function onStorage(event: StorageEvent) {
  const key = event.key;
  if (key === null) {
    // localStorage was cleared.
    settings = parseGroupLockSettings(readItem(SETTINGS_KEY));
    hiddenGroups = new Set(parseUnlockedIds(readItem(HIDDEN_KEY)));
    temporarilyVisible.clear();
    hiddenGroupsAuthorized = false;
    invalidate();
    return;
  }
  if (key === SETTINGS_KEY) {
    hiddenGroupsAuthorized = false;
    settings = parseGroupLockSettings(event.newValue);
    if (!settings.record) {
      unlocked = new Set();
      temporarilyVisible.clear();
    }
    invalidate();
  } else if (key === HIDDEN_KEY) {
    hiddenGroups = new Set(parseUnlockedIds(event.newValue));
    temporarilyVisible = new Set([...temporarilyVisible].filter((id) => hiddenGroups.has(id)));
    hiddenGroupsAuthorized = false;
    invalidate();
  } else if (key === UNLOCKED_KEY && !settings.relockOnLaunch) {
    unlocked = lockReducer(unlocked, {
      type: "replace",
      groupIds: parseUnlockedIds(event.newValue),
    });
    invalidate();
  } else if (key === GROUPS_KEY || key === ASSIGNMENTS_KEY) {
    invalidate();
  }
}

function onChannelMessage(event: MessageEvent) {
  const message = event.data as
    | { type?: string; groupIds?: unknown; visibleHiddenIds?: unknown }
    | undefined;
  if (message?.type === "hello") {
    channel?.postMessage({
      type: "state",
      groupIds: [...unlocked],
      visibleHiddenIds: [...temporarilyVisible],
    });
  } else if (message?.type === "state" && Array.isArray(message.groupIds)) {
    hiddenGroupsAuthorized = false;
    temporarilyVisible = new Set(
      Array.isArray(message.visibleHiddenIds)
        ? message.visibleHiddenIds.filter((id): id is string => typeof id === "string")
        : [],
    );
    unlocked = lockReducer(unlocked, {
      type: "replace",
      groupIds: message.groupIds.filter((id): id is string => typeof id === "string"),
    });
    invalidate();
  } else if (message?.type === "activity") {
    lastActivityAt = Date.now();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", onStorage);
  subscribeProjectPathsChanged(invalidate);
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = onChannelMessage;
    // Node (tests) would otherwise wait on the open channel before exiting.
    (channel as { unref?: () => void }).unref?.();
    // A window opened later learns which groups are already open.
    channel.postMessage({ type: "hello" });
  }
}

/**
 * Locks every group after the configured time without input anywhere in the
 * app. Activity in one window counts for all of them. Returns the cleanup.
 */
export function startGroupLockWatcher(): () => void {
  lastActivityAt = Date.now();
  let lastBroadcast = 0;
  const touch = () => {
    const now = Date.now();
    lastActivityAt = now;
    if (now - lastBroadcast >= ACTIVITY_BROADCAST_MS) {
      lastBroadcast = now;
      channel?.postMessage({ type: "activity" });
    }
  };
  const events = ["keydown", "pointerdown", "pointermove", "wheel"] as const;
  for (const name of events) {
    window.addEventListener(name, touch, { capture: true, passive: true });
  }
  const timer = window.setInterval(() => {
    if (unlocked.size > 0 && autoLockDue(lastActivityAt, Date.now(), settings.autoLockMinutes)) {
      lockAllGroups();
    }
  }, AUTO_LOCK_CHECK_MS);
  return () => {
    for (const name of events) {
      window.removeEventListener(name, touch, { capture: true });
    }
    window.clearInterval(timer);
  };
}
