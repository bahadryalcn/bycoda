import React from "react";
import ReactDOM from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { DesktopControlStrip } from "./DesktopControlStrip";
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
import { languageReady, t, useLocale } from "../../shared/i18n";
import { installNativeContextMenuGuard } from "../../shared/lib/nativeContextMenu";
import "../../styles/index.css";
import { InlineError } from "../../shared/ui/InlineError";
installNativeContextMenuGuard();
function appearance() {
  applyAppearancePreferences(loadAppearancePreferences());
  applyAccentColor(loadAccentColor());
  applyThemeTint(loadThemeHue(), loadThemeSaturation());
  applyThemeDarkLightness(loadThemeDarkLightness());
  applyThemePreference(loadThemePreference());
}
initAppearancePreferences();
appearance();
subscribeThemeStorage(appearance);
watchSystemColorScheme();
window.addEventListener(SCHEME_CHANGE_EVENT, (event) => {
  void getCurrentWindow()
    .setTheme((event as CustomEvent<ColorScheme>).detail)
    .catch(() => undefined);
});
function IndicatorWindow() {
  useLocale();
  const root = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      const height = root.current?.getBoundingClientRect().height;
      if (height) void invoke("desktop_control_indicator_fit", { height }).catch(() => undefined);
    });
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={root} style={{ padding: 4, containerType: "inline-size" }}>
      <DesktopControlStrip
        floating
        onDismiss={() => {
          void invoke("desktop_control_indicator_dismiss").catch(() =>
            setError(t("Computer control status is unavailable. Stop remains available.")),
          );
        }}
      />
      {error && <InlineError>{error}</InlineError>}
    </div>
  );
}
void languageReady
  .catch(() => undefined)
  .then(() =>
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <IndicatorWindow />
      </React.StrictMode>,
    ),
  );
