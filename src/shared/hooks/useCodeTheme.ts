import { useSyncExternalStore } from "react";
import {
  APPEARANCE_PREFERENCES_EVENT,
  loadAppearancePreferences,
} from "../../features/settings/model/appearancePreferences";

function subscribe(listener: () => void) {
  window.addEventListener(APPEARANCE_PREFERENCES_EVENT, listener);
  return () => window.removeEventListener(APPEARANCE_PREFERENCES_EVENT, listener);
}

export function useCodeTheme() {
  return useSyncExternalStore(subscribe, () => loadAppearancePreferences().codeTheme, () => "github" as const);
}
