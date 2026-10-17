import {
  applyAppearancePreferences,
  initAppearancePreferences,
  loadAppearancePreferences,
} from "../settings/model/appearancePreferences";
import { QueryProvider } from "../../app/QueryProvider";
import React from "react";
import { languageReady } from "../../shared/i18n";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IS_MAC } from "../../platform/tauri/platform";
import {
  applyAccentColor,
  applyThemeDarkLightness,
  applyThemePreference,
  applyThemeTint,
  loadAccentColor,
  loadThemeDarkLightness,
  loadThemeHue,
  loadThemePreference,
  loadThemeSaturation,
  SCHEME_CHANGE_EVENT,
  subscribeThemeStorage,
  watchSystemColorScheme,
  type ColorScheme,
} from "../settings/model/appearance";
import { QuickGitPopup } from "./ui/QuickGitPopup";
import { QuickComposer } from "./ui/QuickComposer";
import { PrivacyLaunchGate } from "../group-lock/ui/PrivacyLaunchGate";
import { getGroupLockView } from "../group-lock/model/groupLock";
import "../../styles/index.css";

/**
 * Theme, shared control geometry and typography, without workspace glass, backgrounds or scale: the panel
 * draws its own card on a clear window. Storage keeps an open panel in sync;
 * every show also reloads the theme after a hidden window resumes.
 */
function applyAppearance() {
  applyAppearancePreferences(loadAppearancePreferences());
  document.documentElement.classList.toggle("is-mac", IS_MAC);
  applyAccentColor(loadAccentColor());
  applyThemeTint(loadThemeHue(), loadThemeSaturation());
  applyThemeDarkLightness(loadThemeDarkLightness());
  applyThemePreference(loadThemePreference());
}

window.addEventListener(SCHEME_CHANGE_EVENT, (event) => {
  const scheme = (event as CustomEvent<ColorScheme>).detail;
  // The native blur follows the window's appearance, not the page's, so
  // match it to the app theme rather than the system one.
  void getCurrentWindow()
    .setTheme(scheme)
    .catch(() => undefined);
});

initAppearancePreferences();
applyAppearance();
subscribeThemeStorage(applyAppearance);
watchSystemColorScheme();

void languageReady.then(async () => {
  if (getGroupLockView().settings.startInPrivacyMode) {
    // The panel normally starts at 128px; leave room for privacy and password controls.
    await invoke("quick_composer_fit", { height: 440 }).catch(() => undefined);
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <QueryProvider>
        <PrivacyLaunchGate>
          {new URLSearchParams(window.location.search).get("popup") === "git" ? (
            <QuickGitPopup onShown={applyAppearance} />
          ) : (
            <QuickComposer onShown={applyAppearance} />
          )}
        </PrivacyLaunchGate>
      </QueryProvider>
    </React.StrictMode>,
  );
});
