import { emit, listen } from "@tauri-apps/api/event";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { QuickComposer } from "../../src/features/quick-composer/ui/QuickComposer";
import { setHarnessModels, saveLastModelChoice } from "../../src/features/sessions/model/models";
import { applyThemePreference } from "../../src/features/settings/model/appearance";
import { languageReady } from "../../src/shared/i18n";
import "./w7-shell.css";
// Synthetic storage, catalogs and native IPC only; no owner host/session/provider is contacted.
localStorage.setItem("bycoda.language", "en");
localStorage.setItem(
  "bycoda.recentProjects",
  JSON.stringify([
    { path: "C:/fixture/alpha", openedAt: 2 },
    { path: "C:/fixture/beta", openedAt: 1 },
  ]),
);
setHarnessModels(
  "codex",
  Array.from({ length: 48 }, (_, i) => ({
    id: `fixture-${i}`,
    nativeId: `fixture-${i}`,
    name: `Fixture model ${i}`,
    harness: "codex" as const,
    settings: [
      {
        id: "effort",
        label: "Effort",
        kind: "select" as const,
        value: "low",
        options: [
          { label: "Low", value: "low" },
          { label: "High", value: "high" },
        ],
      },
    ],
  })),
);
saveLastModelChoice("codex", "fixture-0");
mockWindows("quick-fixture");
Object.assign((window as any).__TAURI_INTERNALS__.metadata, {
  currentWebview: { label: "quick-fixture" },
});
const calls: Array<{ command: string; args: unknown }> = [];
Object.assign(window, { quickFixtureCalls: calls });
mockIPC(
  async (command, args) => {
    calls.push({ command, args });
    if (command === "plugin:event|listen") return 1;
    if (command === "quick_composer_submit") {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return null;
    }
    return null;
  },
  { shouldMockEvents: true },
);
await listen(
  "quick_composer_catalog_request",
  () => void emit("quick_composer_catalog", { models: {}, availableHarnesses: ["codex"] }),
);
const params = new URLSearchParams(location.search);
applyThemePreference(params.get("theme") === "light" ? "light" : "dark");
await languageReady;
createRoot(document.getElementById("root")!).render(
  <main className="mx-auto max-w-2xl p-3">
    <QuickComposer onShown={() => {}} />
  </main>,
);
