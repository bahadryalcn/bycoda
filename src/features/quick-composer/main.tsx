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
} from "../settings/model/appearance";
import { QuickGitPopup } from "./ui/QuickGitPopup";
import { QuickComposer } from "./ui/QuickComposer";
import { PrivacyLaunchGate } from "../group-lock/ui/PrivacyLaunchGate";
import { getGroupLockView } from "../group-lock/model/groupLock";
import "../../styles/index.css";

/**
 * Only the theme, not the workspace's glass, backgrounds, or scale: the panel
 * draws its own card on a clear window. Re-applied on every show because the
 * theme may have changed in a workspace window since.
 */
function applyAppearance() {
  document.documentElement.classList.toggle("is-mac", IS_MAC);
  applyAccentColor(loadAccentColor());
  applyThemeTint(loadThemeHue(), loadThemeSaturation());
  applyThemeDarkLightness(loadThemeDarkLightness());
  const scheme = applyThemePreference(loadThemePreference());
  // The native blur follows the window's appearance, not the page's, so
  // match it to the app theme rather than the system one.
  void getCurrentWindow()
    .setTheme(scheme)
    .catch(() => undefined);
}

applyAppearance();

void languageReady.then(async () => {
  if (getGroupLockView().settings.startInPrivacyMode) {
    // The panel normally starts at 128px; leave room for privacy and password controls.
    await invoke("quick_composer_fit", { height: 440 }).catch(() => undefined);
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <PrivacyLaunchGate>
        {new URLSearchParams(window.location.search).get("popup") === "git" ? (
          <QuickGitPopup onShown={applyAppearance} />
        ) : (
          <QuickComposer onShown={applyAppearance} />
        )}
      </PrivacyLaunchGate>
    </React.StrictMode>,
  );
});
