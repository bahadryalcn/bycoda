import { useSyncExternalStore } from "react";
import {
  APPEARANCE_PREFERENCES_EVENT,
  loadAppearancePreferences,
  type AppearancePreferences,
} from "../../features/settings/model/appearancePreferences";

type CodeTheme = AppearancePreferences["codeTheme"];

/** Mirrors the private storage key in appearancePreferences.ts; a mismatch only costs one re-read. */
const APPEARANCE_STORAGE_KEY = "bycoda.appearancePreferences.v1";
const SERVER_THEME: CodeTheme = "github";

// Every markdown and code block reads the theme on each render; the preference
// record is parsed once and kept until a writer (this window or another one)
// says it changed. `getSnapshot` must hand back the same value while nothing
// changed, which a cached primitive guarantees.
let cached: CodeTheme | undefined;
const listeners = new Set<() => void>();

function invalidate() {
  cached = undefined;
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key === null || event.key === APPEARANCE_STORAGE_KEY) invalidate();
}

function getSnapshot(): CodeTheme {
  return (cached ??= loadAppearancePreferences().codeTheme);
}

function getServerSnapshot(): CodeTheme {
  return SERVER_THEME;
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    window.addEventListener(APPEARANCE_PREFERENCES_EVENT, invalidate);
    window.addEventListener("storage", onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener(APPEARANCE_PREFERENCES_EVENT, invalidate);
      window.removeEventListener("storage", onStorage);
    }
  };
}

export function useCodeTheme() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
