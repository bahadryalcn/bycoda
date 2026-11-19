import { getCurrentWindow } from "@tauri-apps/api/window";
import { IS_MAC } from "../../../platform/tauri/platform";
import {
  applyStoredTheme,
  SCHEME_CHANGE_EVENT,
  subscribeThemeStorage,
  watchSystemColorScheme,
  type ColorScheme,
} from "./appearance";
import {
  applyAppearancePreferences,
  initAppearancePreferences,
  loadAppearancePreferences,
} from "./appearancePreferences";

/**
 * Theme, shared control geometry and typography for a secondary window (quick composer, voice overlay,
 * desktop-control indicator), without workspace glass, backgrounds or scale: those windows draw their own
 * surface on a clear window. Storage keeps an open window in sync. Returns the re-apply, for callers that
 * must reload the theme when the window is shown again.
 */
export function bootSecondaryWindowAppearance(): () => void {
  // The native blur follows the window's appearance, not the page's, so match it to the app theme
  // rather than the system one.
  window.addEventListener(SCHEME_CHANGE_EVENT, (event) => {
    const scheme = (event as CustomEvent<ColorScheme>).detail;
    void getCurrentWindow()
      .setTheme(scheme)
      .catch(() => undefined);
  });
  const apply = () => {
    applyAppearancePreferences(loadAppearancePreferences());
    document.documentElement.classList.toggle("is-mac", IS_MAC);
    applyStoredTheme();
  };
  initAppearancePreferences();
  apply();
  subscribeThemeStorage(apply);
  watchSystemColorScheme();
  return apply;
}
