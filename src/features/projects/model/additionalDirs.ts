import { useMemo, useSyncExternalStore } from "react";
import { pathKey } from "../../../shared/lib/paths";
import { loadProjectGroupAssignments, projectGroupIdForPath } from "./projectGroups";
import {
  isLocalProject,
  loadRecents,
  normalizeProjectPath,
  notifyProjectPathsChanged,
  subscribeProjectPathsChanged,
  type RecentProject,
} from "./recents";

const KEY = "bycoda.projectAdditionalDirs";

type DirsMap = Record<string, string[]>;

/**
 * Parses a stored map. Null means the text is not a valid map (not an object, or a value that
 * is not an array of strings); a missing value is an empty map. Empty strings are dropped.
 */
function parseDirsMap(text: string | null): DirsMap | null {
  if (text === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const map: DirsMap = {};
  for (const [key, dirs] of Object.entries(parsed)) {
    if (!Array.isArray(dirs) || !dirs.every((dir) => typeof dir === "string")) return null;
    map[key] = dirs.filter((dir) => !!dir);
  }
  return map;
}

/**
 * One stored map, parsed once per raw text. `valid` is false while the stored text is
 * unreadable: `value` then keeps the last valid map, and writers must not replace the text.
 * `version` changes whenever the raw text changes, so callers can cache derived data on it.
 */
function storedDirsMap(key: string) {
  let storage: Storage | null = null;
  let raw: string | null | undefined;
  let value: DirsMap = {};
  let valid = true;
  let version = 0;
  return {
    read(): { value: DirsMap; valid: boolean; version: number } {
      try {
        const current = localStorage;
        const text = current.getItem(key);
        if (storage !== current || raw !== text) {
          storage = current;
          raw = text;
          version += 1;
          const parsed = parseDirsMap(text);
          valid = parsed !== null;
          if (parsed !== null) value = parsed;
        }
        return { value, valid, version };
      } catch {
        return { value, valid: false, version };
      }
    },
    /** Records a map this module just wrote, so `value` stays the last written map. */
    written(text: string | null, map: DirsMap) {
      const current = localStorage;
      if (storage !== current || raw !== text) version += 1;
      storage = current;
      raw = text;
      value = map;
      valid = true;
    },
  };
}

const projectDirsStore = storedDirsMap(KEY);

function saveAll(all: DirsMap): boolean {
  const text = JSON.stringify(all);
  try {
    localStorage.setItem(KEY, text);
  } catch {
    return false;
  }
  projectDirsStore.written(text, all);
  notifyProjectPathsChanged();
  return true;
}

/** A writable copy of the stored project map, or null while the stored text is unreadable. */
function writableProjectDirs(): DirsMap | null {
  const stored = projectDirsStore.read();
  return stored.valid ? { ...stored.value } : null;
}

/**
 * Folders an agent working in this project may also read and edit, beyond the
 * project folder itself. Set per project, so every session in it shares them.
 */
export function loadAdditionalDirs(project: string): string[] {
  const own = pathKey(normalizeProjectPath(project));
  return (projectDirsStore.read().value[own] ?? []).filter((dir) => pathKey(dir) !== own);
}

/** False when nothing was saved, including while the stored text is unreadable. */
export function saveAdditionalDirs(project: string, dirs: readonly string[]): boolean {
  const all = writableProjectDirs();
  if (!all) return false;
  const own = pathKey(normalizeProjectPath(project));
  const seen = new Set<string>([own]);
  const next = dirs.map(normalizeProjectPath).filter((dir) => {
    const key = pathKey(dir);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (next.length > 0) all[own] = next;
  else delete all[own];
  return saveAll(all);
}

export function removeAdditionalDirs(project: string): boolean {
  return saveAdditionalDirs(project, []);
}

export function rebaseAdditionalDirs(from: string, to: string): boolean {
  const all = writableProjectDirs();
  if (!all) return false;
  const oldKey = pathKey(normalizeProjectPath(from));
  const newKey = pathKey(normalizeProjectPath(to));
  if (oldKey === newKey || !(oldKey in all)) return true;
  if (!(newKey in all)) all[newKey] = all[oldKey];
  delete all[oldKey];
  return saveAll(all);
}

/** The other local projects in this project's rail group: what the picker offers. */
export function additionalDirCandidates(project: string): string[] {
  return additionalDirCandidatesFrom(project, loadRecents(), loadProjectGroupAssignments());
}

/** `additionalDirCandidates` with the recents and group assignments given (see their hooks). */
export function additionalDirCandidatesFrom(
  project: string,
  recents: readonly RecentProject[],
  assignments: Record<string, string>,
): string[] {
  const groupId = projectGroupIdForPath(project, assignments);
  if (!groupId) return [];
  const own = pathKey(normalizeProjectPath(project));
  return recents
    .map((recent) => recent.path)
    .filter(
      (path) =>
        pathKey(path) !== own &&
        isLocalProject(path) &&
        projectGroupIdForPath(path, assignments) === groupId,
    );
}

const SESSION_KEY = "bycoda.sessionAdditionalDirs";
const SESSION_CHANGE_EVENT = "bycoda:session-additional-dirs-change";

type SessionOverrides = DirsMap;

const sessionOverridesStore = storedDirsMap(SESSION_KEY);

function loadSessionOverrides(): SessionOverrides {
  return sessionOverridesStore.read().value;
}

function saveSessionOverrides(all: SessionOverrides): boolean {
  let saved = true;
  const empty = Object.keys(all).length === 0;
  const text = empty ? null : JSON.stringify(all);
  try {
    if (text !== null) localStorage.setItem(SESSION_KEY, text);
    else localStorage.removeItem(SESSION_KEY);
    sessionOverridesStore.written(text, all);
  } catch {
    saved = false;
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SESSION_CHANGE_EVENT));
  }
  return saved;
}

/** The folders this session picked for itself, or undefined to follow its project. */
export function loadSessionAdditionalDirs(sessionId: string): string[] | undefined {
  const override = loadSessionOverrides()[sessionId];
  return override ? [...override] : undefined;
}

/**
 * Extra folders a session may use. Explicit choices can come from any local
 * project or the system folder picker, independently of rail group membership.
 * An empty override means "no extra folders" for this session.
 */
export function additionalDirsForSession(sessionId: string, project: string): string[] {
  const own = pathKey(normalizeProjectPath(project));
  const projectDirs = loadAdditionalDirs(project);
  const override = loadSessionOverrides()[sessionId];
  if (!override) return projectDirs;
  const seen = new Set<string>([own]);
  return override.map(normalizeProjectPath).filter((dir) => {
    const key = pathKey(dir);
    if (seen.has(key) || !isLocalProject(dir)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Pass `null`, or the project's own list, to go back to following the project.
 * False when nothing was saved, including while the stored overrides are unreadable.
 */
export function saveSessionAdditionalDirs(
  sessionId: string,
  project: string,
  dirs: readonly string[] | null,
): boolean {
  const stored = sessionOverridesStore.read();
  if (!stored.valid) return false;
  const all = { ...stored.value };
  const own = pathKey(normalizeProjectPath(project));
  const seen = new Set<string>([own]);
  const next = (dirs ?? []).map(normalizeProjectPath).filter((dir) => {
    const key = pathKey(dir);
    if (seen.has(key) || !isLocalProject(dir)) return false;
    seen.add(key);
    return true;
  });
  const defaults = loadAdditionalDirs(project).map((dir) => pathKey(dir));
  const sameAsProject =
    next.length === defaults.length && next.every((dir) => defaults.includes(pathKey(dir)));
  if (dirs === null || sameAsProject) delete all[sessionId];
  else all[sessionId] = next;
  return saveSessionOverrides(all);
}

/** Called when a session is deleted for good. */
export function removeSessionAdditionalDirs(sessionId: string): void {
  const stored = sessionOverridesStore.read();
  if (!stored.valid || !(sessionId in stored.value)) return;
  const next = { ...stored.value };
  delete next[sessionId];
  saveSessionOverrides(next);
}

export function subscribeSessionAdditionalDirs(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === SESSION_KEY) onStoreChange();
  };
  window.addEventListener(SESSION_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SESSION_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

type SessionAdditionalDirs = {
  /** The session picked its own folders instead of following its project. */
  overridden: boolean;
  /** `additionalDirsForSession` for this session and project. */
  dirs: string[];
  /** `loadAdditionalDirs` for the project. */
  projectDirs: string[];
};

function subscribeSessionAndProjectDirs(onStoreChange: () => void) {
  const stopSession = subscribeSessionAdditionalDirs(onStoreChange);
  const stopProject = subscribeProjectPathsChanged(onStoreChange);
  return () => {
    stopSession();
    stopProject();
  };
}

const EMPTY_SESSION_ADDITIONAL_DIRS = '{"overridden":false,"dirs":[],"projectDirs":[]}';

/** Serialized view for one session; reused until either stored map's text changes. */
const snapshotCache = new Map<string, string>();
let snapshotVersions = "";

function sessionAdditionalDirsSnapshot(sessionId: string, project: string): string {
  const versions = `${projectDirsStore.read().version}/${sessionOverridesStore.read().version}`;
  if (versions !== snapshotVersions) {
    snapshotCache.clear();
    snapshotVersions = versions;
  }
  const key = `${sessionId}\n${project}`;
  let snapshot = snapshotCache.get(key);
  if (snapshot === undefined) {
    snapshot = JSON.stringify({
      overridden: loadSessionAdditionalDirs(sessionId) !== undefined,
      dirs: additionalDirsForSession(sessionId, project),
      projectDirs: loadAdditionalDirs(project),
    });
    snapshotCache.set(key, snapshot);
  }
  return snapshot;
}

/**
 * The session's extra folders for render: re-renders the caller when the session's own
 * choice or its project's folders change. The snapshot is a string, so it only changes
 * with the stored content.
 */
export function useSessionAdditionalDirs(
  sessionId: string,
  project: string,
): SessionAdditionalDirs {
  const key = useSyncExternalStore(
    subscribeSessionAndProjectDirs,
    () => sessionAdditionalDirsSnapshot(sessionId, project),
    () => EMPTY_SESSION_ADDITIONAL_DIRS,
  );
  return useMemo(() => JSON.parse(key) as SessionAdditionalDirs, [key]);
}
