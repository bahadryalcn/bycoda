import { pathKey } from "../../../shared/lib/paths";
import { loadProjectGroupAssignments, projectGroupIdForPath } from "./projectGroups";
import {
  isLocalProject,
  loadRecents,
  normalizeProjectPath,
  notifyProjectPathsChanged,
} from "./recents";

const KEY = "bycoda.projectAdditionalDirs";

function loadAll(): Record<string, string[]> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) =>
        Array.isArray(value)
          ? [[key, value.filter((dir): dir is string => typeof dir === "string" && !!dir)]]
          : [],
      ),
    );
  } catch {
    return {};
  }
}

function saveAll(all: Record<string, string[]>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
    notifyProjectPathsChanged();
  } catch {
    /* storage unavailable */
  }
}

/**
 * Folders an agent working in this project may also read and edit, beyond the
 * project folder itself. Set per project, so every session in it shares them.
 */
export function loadAdditionalDirs(project: string): string[] {
  const own = pathKey(normalizeProjectPath(project));
  return (loadAll()[own] ?? []).filter((dir) => pathKey(dir) !== own);
}

export function saveAdditionalDirs(project: string, dirs: readonly string[]): void {
  const all = loadAll();
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
  saveAll(all);
}

export function removeAdditionalDirs(project: string): void {
  saveAdditionalDirs(project, []);
}

export function rebaseAdditionalDirs(from: string, to: string): void {
  const all = loadAll();
  const oldKey = pathKey(normalizeProjectPath(from));
  const newKey = pathKey(normalizeProjectPath(to));
  if (oldKey === newKey || !(oldKey in all)) return;
  if (!(newKey in all)) all[newKey] = all[oldKey];
  delete all[oldKey];
  saveAll(all);
}

/** The other local projects in this project's rail group: what the picker offers. */
export function additionalDirCandidates(project: string): string[] {
  const assignments = loadProjectGroupAssignments();
  const groupId = projectGroupIdForPath(project, assignments);
  if (!groupId) return [];
  const own = pathKey(normalizeProjectPath(project));
  return loadRecents()
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

type SessionOverrides = Record<string, string[]>;

let overridesStorage: Storage | null = null;
let overridesRaw: string | null | undefined;
let overridesValue: SessionOverrides = {};

function loadSessionOverrides(): SessionOverrides {
  try {
    const storage = localStorage;
    const raw = storage.getItem(SESSION_KEY);
    if (overridesStorage === storage && overridesRaw === raw) return overridesValue;
    const parsed: unknown = JSON.parse(raw ?? "{}");
    const next: SessionOverrides = {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [id, dirs] of Object.entries(parsed)) {
        if (Array.isArray(dirs)) {
          next[id] = dirs.filter((dir): dir is string => typeof dir === "string" && !!dir);
        }
      }
    }
    overridesStorage = storage;
    overridesRaw = raw;
    overridesValue = next;
    return next;
  } catch {
    return {};
  }
}

function saveSessionOverrides(all: SessionOverrides): void {
  try {
    if (Object.keys(all).length > 0) localStorage.setItem(SESSION_KEY, JSON.stringify(all));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SESSION_CHANGE_EVENT));
  }
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

/** Pass `null`, or the project's own list, to go back to following the project. */
export function saveSessionAdditionalDirs(
  sessionId: string,
  project: string,
  dirs: readonly string[] | null,
): void {
  const all = { ...loadSessionOverrides() };
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
  saveSessionOverrides(all);
}

/** Called when a session is deleted for good. */
export function removeSessionAdditionalDirs(sessionId: string): void {
  const all = loadSessionOverrides();
  if (!(sessionId in all)) return;
  const next = { ...all };
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
