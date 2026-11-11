import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { TitleGenerationSettings } from "../../../src/features/settings/ui/TitleGenerationSettings";
import {
  ModelSourceContext,
  LOCAL_MODEL_SOURCE,
} from "../../../src/features/sessions/ui/modelSource";
import { applyThemePreference } from "../../../src/features/settings/model/appearance";
import { initAppearancePreferences } from "../../../src/features/settings/model/appearancePreferences";
import { saveLastModelChoice } from "../../../src/features/sessions/model/models";
import { setLanguagePreference } from "../../../src/shared/i18n";
import { registerBuiltinHarnesses } from "../../../src/integrations/harness/core/register";
import "../../../src/styles/index.css";

// Component fixture only: catalogs are local and no provider process can start.
mockWindows("main");
mockIPC((command) => {
  if (command === "plugin:os|platform") return "windows";
  if (command === "native_language_set") return;
  throw new Error(`Unexpected title settings fixture IPC: ${command}`);
});
applyThemePreference(
  new URLSearchParams(location.search).get("theme") === "light" ? "light" : "dark",
);
initAppearancePreferences();
registerBuiltinHarnesses();
saveLastModelChoice("claude", "claude:haiku-4.5");
const source = {
  ...LOCAL_MODEL_SOURCE,
  available: () => true,
  probed: () => true,
  refresh: () => {},
};

void setLanguagePreference("en").then(() =>
  createRoot(document.getElementById("root")!).render(
    <ModelSourceContext.Provider value={source}>
      <main className="settings-view h-screen overflow-auto bg-background-base text-content p-6">
        <div className="chat-settings settings-topics mx-auto max-w-4xl">
          <TitleGenerationSettings />
        </div>
      </main>
    </ModelSourceContext.Provider>,
  ),
);
