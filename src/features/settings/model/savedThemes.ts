import { useSyncExternalStore } from "react";
import { createStore } from "../../../shared/lib/store";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import {
  acceptAppearanceStorageChange,
  readAppearanceValue,
  writeAppearanceValue,
} from "./appearancePersistence";
import { normalizeAppearanceSnapshot, type AppearanceSnapshot } from "./appearanceSnapshot";

/** A named look: every Appearance setting plus the library image behind the chat background. */
export type SavedTheme = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  look: AppearanceSnapshot;
  /** Library image id; absent when the look has no chat background. */
  imageId?: string;
};

export const SAVED_THEME_NAME_MAX = 40;
export const SAVED_THEMES_MAX = 40;
const KEY = "bycoda.savedThemes.v1";
const IMAGE_ID = /^[0-9a-f]{24}$/;
const listeners = createStore();
let cache: { raw: string | null; themes: SavedTheme[] } | undefined;

export function normalizeThemeName(value: unknown): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return truncateGraphemes(text, SAVED_THEME_NAME_MAX);
}

/** Valid themes only: bad entries, nameless ones and repeated ids are dropped; fields are normalized. */
export function normalizeSavedThemes(input: unknown): SavedTheme[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const themes: SavedTheme[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    const name = normalizeThemeName(raw.name);
    const id = typeof raw.id === "string" ? raw.id : "";
    if (!name || !id || seen.has(id)) continue;
    seen.add(id);
    const createdAt =
      typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : 0;
    const updatedAt =
      typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)
        ? raw.updatedAt
        : createdAt;
    themes.push({
      id,
      name,
      createdAt,
      updatedAt,
      look: normalizeAppearanceSnapshot(raw.look),
      ...(typeof raw.imageId === "string" && IMAGE_ID.test(raw.imageId)
        ? { imageId: raw.imageId }
        : {}),
    });
    if (themes.length >= SAVED_THEMES_MAX) break;
  }
  return themes;
}

export function loadSavedThemes(): SavedTheme[] {
  let raw: string | null;
  try {
    raw = readAppearanceValue(KEY);
  } catch {
    return cache?.themes ?? [];
  }
  if (cache?.raw === raw) return cache.themes;
  let themes: SavedTheme[] = [];
  try {
    themes = raw ? normalizeSavedThemes(JSON.parse(raw)) : [];
  } catch {
    // A corrupt record reads as empty; the next save replaces it.
  }
  cache = { raw, themes };
  return themes;
}

/** Writes the whole list; `false` when storage failed (the Appearance save banner then offers a retry). */
export function saveSavedThemes(themes: readonly SavedTheme[]): boolean {
  const kept = normalizeSavedThemes(themes);
  return writeAppearanceValue(
    KEY,
    kept.length > 0 ? JSON.stringify(kept) : null,
    "saved-themes",
    () => listeners.notify(),
  );
}

export function subscribeSavedThemes(listener: () => void): () => void {
  const unsubscribe = listeners.subscribe(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== KEY) return;
    acceptAppearanceStorageChange(event.key);
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    unsubscribe();
    window.removeEventListener("storage", onStorage);
  };
}

export function useSavedThemes(): SavedTheme[] {
  return useSyncExternalStore(subscribeSavedThemes, loadSavedThemes, loadSavedThemes);
}

/** Library image ids that saved themes use; eviction and delete treat them as protected. */
export function referencedImageIds(themes: readonly SavedTheme[]): Set<string> {
  return new Set(themes.flatMap((theme) => (theme.imageId ? [theme.imageId] : [])));
}

export function themesUsingImage(themes: readonly SavedTheme[], imageId: string): SavedTheme[] {
  return themes.filter((theme) => theme.imageId === imageId);
}

export type SavedThemeInput = {
  name: string;
  look: AppearanceSnapshot;
  imageId?: string;
};

export function addSavedTheme(
  themes: readonly SavedTheme[],
  input: SavedThemeInput,
  now: number,
  id: string,
): SavedTheme[] {
  const name = normalizeThemeName(input.name);
  if (!name || themes.length >= SAVED_THEMES_MAX) return [...themes];
  const theme: SavedTheme = {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    look: input.look,
    ...(input.imageId ? { imageId: input.imageId } : {}),
  };
  return [...themes, theme];
}

export function renameSavedTheme(
  themes: readonly SavedTheme[],
  id: string,
  name: string,
  now: number,
): SavedTheme[] {
  const next = normalizeThemeName(name);
  if (!next) return [...themes];
  return themes.map((theme) =>
    theme.id === id ? { ...theme, name: next, updatedAt: now } : theme,
  );
}

/** Replaces the look and image of one theme with the current ones; the name stays. */
export function overwriteSavedTheme(
  themes: readonly SavedTheme[],
  id: string,
  input: Omit<SavedThemeInput, "name">,
  now: number,
): SavedTheme[] {
  return themes.map((theme) => {
    if (theme.id !== id) return theme;
    const { imageId: _previous, ...rest } = theme;
    return {
      ...rest,
      look: input.look,
      updatedAt: now,
      ...(input.imageId ? { imageId: input.imageId } : {}),
    };
  });
}

export function removeSavedTheme(themes: readonly SavedTheme[], id: string): SavedTheme[] {
  return themes.filter((theme) => theme.id !== id);
}

/** Themes keep their look but lose a deleted library image. */
export function dropImageReference(themes: readonly SavedTheme[], imageId: string): SavedTheme[] {
  return themes.map((theme) => {
    if (theme.imageId !== imageId) return theme;
    const { imageId: _removed, ...rest } = theme;
    return rest;
  });
}
