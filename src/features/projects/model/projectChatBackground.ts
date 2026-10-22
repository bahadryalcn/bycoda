import {
  CHAT_BACKGROUND_OPACITY_MAX,
  CHAT_BACKGROUND_OPACITY_MIN,
  CHAT_BACKGROUND_SCOPE_DEFAULT,
  NEW_THREAD_BACKGROUND_EFFECT_DEFAULT,
  loadChatBackgroundEmptyOpacity,
  loadChatBackgroundSessionOpacity,
  loadChatBackgroundScope,
  NEW_THREAD_BACKGROUND_EFFECTS,
  type ChatBackgroundScope,
  type NewThreadBackgroundEffect,
} from "../../settings/model/appearance";

const KEY = "bycoda:project-chat-backgrounds";

export const PROJECT_CHAT_BACKGROUND_CHANGED = "bycoda:project-chat-background-changed";

export type ProjectChatBackground = {
  path: string;
  opacity: number;
  scope: ChatBackgroundScope;
};

export type ProjectChatBackgroundSettings = {
  path: string;
  emptyOpacity: number;
  sessionOpacity: number;
  scope: ChatBackgroundScope;
  effect: NewThreadBackgroundEffect;
};

type StoredProjectChatBackground = Partial<ProjectChatBackground> & {
  emptyOpacity?: number;
  sessionOpacity?: number;
  effect?: NewThreadBackgroundEffect;
};

let revision = Date.now();
let imageRevision = revision;

function clampOpacity(value: number): number {
  return Math.min(CHAT_BACKGROUND_OPACITY_MAX, Math.max(CHAT_BACKGROUND_OPACITY_MIN, value));
}

// Parsed map keyed on the raw stored string: renders re-read the setting, but
// only a changed string (any writer, any window) is re-parsed.
let cachedRaw: string | null | undefined;
let cachedParsed: Record<string, StoredProjectChatBackground> = {};

function readShared(): Record<string, StoredProjectChatBackground> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === cachedRaw) return cachedParsed;
    let parsed: Record<string, StoredProjectChatBackground> = {};
    if (raw) {
      const value = JSON.parse(raw) as unknown;
      if (value && typeof value === "object")
        parsed = value as Record<string, StoredProjectChatBackground>;
    }
    cachedRaw = raw;
    cachedParsed = parsed;
    return parsed;
  } catch {
    return {};
  }
}

/** A top-level copy the caller may add to or delete from. */
function read(): Record<string, StoredProjectChatBackground> {
  return { ...readShared() };
}

function write(value: Record<string, StoredProjectChatBackground>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function validScope(value: unknown): value is ChatBackgroundScope {
  return value === "empty" || value === "all";
}

function validEffect(value: unknown): value is NewThreadBackgroundEffect {
  return NEW_THREAD_BACKGROUND_EFFECTS.includes(value as NewThreadBackgroundEffect);
}

function storedOpacity(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? clampOpacity(value) : fallback;
}

export function loadProjectChatBackgroundSettings(
  project: string,
): ProjectChatBackgroundSettings | null {
  const stored = readShared()[project];
  const path = typeof stored?.path === "string" ? stored.path.trim() : "";
  if (!path) return null;
  const legacyOpacity = storedOpacity(stored.opacity, loadChatBackgroundEmptyOpacity());
  const hasStoredOpacity = typeof stored.opacity === "number" && Number.isFinite(stored.opacity);
  const hasStoredEmptyOpacity =
    typeof stored.emptyOpacity === "number" && Number.isFinite(stored.emptyOpacity);
  return {
    path,
    emptyOpacity: storedOpacity(stored.emptyOpacity, legacyOpacity),
    sessionOpacity: storedOpacity(
      stored.sessionOpacity,
      hasStoredEmptyOpacity
        ? storedOpacity(stored.emptyOpacity, legacyOpacity)
        : hasStoredOpacity
          ? legacyOpacity
          : loadChatBackgroundSessionOpacity(),
    ),
    scope: validScope(stored.scope) ? stored.scope : loadChatBackgroundScope(),
    effect: validEffect(stored.effect) ? stored.effect : NEW_THREAD_BACKGROUND_EFFECT_DEFAULT,
  };
}

export function saveProjectChatBackgroundSettings(
  project: string,
  value: ProjectChatBackgroundSettings,
  imageChanged = false,
) {
  const path = value.path.trim();
  if (!project || !path) return;
  const next = read();
  next[project] = {
    path,
    emptyOpacity: clampOpacity(value.emptyOpacity),
    sessionOpacity: clampOpacity(value.sessionOpacity),
    scope: validScope(value.scope) ? value.scope : CHAT_BACKGROUND_SCOPE_DEFAULT,
    effect: validEffect(value.effect) ? value.effect : NEW_THREAD_BACKGROUND_EFFECT_DEFAULT,
  };
  write(next);
  notifyProjectChatBackgroundChanged(imageChanged);
}

export function loadProjectChatBackground(project: string): ProjectChatBackground | null {
  const settings = loadProjectChatBackgroundSettings(project);
  if (!settings) return null;
  return {
    path: settings.path,
    opacity: settings.emptyOpacity,
    scope: settings.scope,
  };
}

export function saveProjectChatBackground(project: string, value: ProjectChatBackground) {
  const path = value.path.trim();
  if (!project || !path) return;
  const next = read();
  next[project] = {
    path,
    opacity: clampOpacity(value.opacity),
    scope: validScope(value.scope) ? value.scope : CHAT_BACKGROUND_SCOPE_DEFAULT,
  };
  write(next);
  notifyProjectChatBackgroundChanged();
}

export function clearProjectChatBackgroundSetting(project: string) {
  const next = read();
  if (!(project in next)) return;
  delete next[project];
  if (!write(next)) throw new Error("Could not save project background settings. Retry removing the image.");
  notifyProjectChatBackgroundChanged();
}

export function rebaseProjectChatBackgroundSetting(from: string, to: string) {
  if (!from || !to || from === to) return;
  const next = read();
  if (!(from in next)) return;
  if (!(to in next)) next[to] = next[from];
  delete next[from];
  write(next);
  notifyProjectChatBackgroundChanged();
}

export function notifyProjectChatBackgroundChanged(imageChanged = true) {
  revision += 1;
  if (imageChanged) imageRevision += 1;
  window.dispatchEvent(new CustomEvent(PROJECT_CHAT_BACKGROUND_CHANGED));
}

export function projectChatBackgroundRevision(): number {
  return revision;
}

export function projectChatBackgroundImageRevision(): number {
  return imageRevision;
}

export function subscribeProjectChatBackground(listener: () => void) {
  window.addEventListener(PROJECT_CHAT_BACKGROUND_CHANGED, listener);
  return () => window.removeEventListener(PROJECT_CHAT_BACKGROUND_CHANGED, listener);
}
