import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CrewScene } from "../../../src/features/sessions/ui/CrewScene";
import {
  saveCrewGrowthEnabled,
  saveCrewTheme,
  type CrewTheme,
} from "../../../src/features/settings/model/settings";
import { saveDecorativeMotionEnabled } from "../../../src/features/settings/model/decorativeMotion";
import { applyThemePreference } from "../../../src/features/settings/model/appearance";
import {
  languageReady,
  setLanguagePreference,
  type LanguagePreference,
} from "../../../src/shared/i18n";

let root: Root | undefined;
declare global {
  interface Window {
    classicScene: (
      context: number | undefined,
      dark: boolean,
      growth?: boolean,
      language?: LanguagePreference,
      theme?: CrewTheme,
    ) => Promise<void>;
  }
}
window.classicScene = async (context, dark, growth = false, language = "en", theme = "classic") => {
  await import("../../../src/styles/index.css");
  root?.unmount();
  document.querySelectorAll("canvas, #classic-scene").forEach((node) => node.remove());
  await languageReady;
  await setLanguagePreference(language);
  applyThemePreference(dark ? "dark" : "light");
  saveDecorativeMotionEnabled(false);
  saveCrewTheme(theme);
  saveCrewGrowthEnabled(growth);
  document.body.style.background = "var(--ui-workspace-canvas)";
  const host = document.createElement("div");
  host.id = "classic-scene";
  host.style.cssText = "width:100%;color:var(--ui-text-primary)";
  document.body.append(host);
  root = createRoot(host);
  root.render(
    createElement(CrewScene, {
      crew: Array.from({ length: 6 }, (_, id) => ({
        role: id === 2 ? "lead" : id === 3 ? "advisor" : "subagent",
        working: id >= 2 && id <= 4,
        context,
      })),
    }),
  );
};
