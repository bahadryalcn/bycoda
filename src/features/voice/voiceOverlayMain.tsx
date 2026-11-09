import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  applyAppearancePreferences,
  initAppearancePreferences,
  loadAppearancePreferences,
} from "../settings/model/appearancePreferences";
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
import { IS_MAC } from "../../platform/tauri/platform";
import { languageReady } from "../../shared/i18n";
import { installNativeContextMenuGuard } from "../../shared/lib/nativeContextMenu";
import { readVoiceOverlayOwner } from "./model/voiceOverlay";
import { VoiceOverlayWindow } from "./ui/VoiceOverlayWindow";
import "../../styles/index.css";

installNativeContextMenuGuard();

/** Theme and control geometry only; the workspace backdrop stays in the app window. */
function applyAppearance() {
  applyAppearancePreferences(loadAppearancePreferences());
  document.documentElement.classList.toggle("is-mac", IS_MAC);
  applyAccentColor(loadAccentColor());
  applyThemeTint(loadThemeHue(), loadThemeSaturation());
  applyThemeDarkLightness(loadThemeDarkLightness());
  applyThemePreference(loadThemePreference());
}

window.addEventListener(SCHEME_CHANGE_EVENT, (event) => {
  void getCurrentWindow()
    .setTheme((event as CustomEvent<ColorScheme>).detail)
    .catch(() => undefined);
});

initAppearancePreferences();
applyAppearance();
subscribeThemeStorage(applyAppearance);
watchSystemColorScheme();

const owner = readVoiceOverlayOwner();
void languageReady.then(async () => {
  if (!owner) {
    await invoke("voice_overlay_close").catch(() => undefined);
    return;
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    // Opened only by an explicit action in an unlocked workspace window, which
    // keeps the voice session; this window mirrors what that panel already shows.
    <React.StrictMode>
      <VoiceOverlayWindow owner={owner} />
    </React.StrictMode>,
  );
});
