import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { HelperModelsSettings } from "../../../src/features/settings/ui/HelperModelsSettings";
import { ModelRolesSettings } from "../../../src/features/model-routing/ui/roles/ModelRolesSettings";
import { OPEN_MODELS_SETTINGS_EVENT } from "../../../src/features/settings/ui/models/modelsSettingsLink";
import {
  EMPTY_MODEL_ROUTING,
  type ModelRoutingState,
} from "../../../src/shared/model/host-contracts/model-routing";
import { applyThemePreference } from "../../../src/features/settings/model/appearance";
import { initAppearancePreferences } from "../../../src/features/settings/model/appearancePreferences";
import { setLanguagePreference } from "../../../src/shared/i18n";
import "../../../src/styles/index.css";

// Only the native Host boundary is mocked. No real Host, provider or account is contacted.
const params = new URLSearchParams(location.search);
const key = "fixture.title-role.host";
let state: ModelRoutingState = JSON.parse(localStorage.getItem(key) ?? "null") ?? {
  ...EMPTY_MODEL_ROUTING,
  version: 1,
  updatedAt: 1,
  entries: [
    {
      id: "fixture-entry",
      harness: "claude",
      model: "claude:haiku-4.5",
      modelSettings: {},
      unknownLimit: "use",
    },
  ],
};
const calls: { method: string; machineId: unknown; params: unknown }[] = [];
const receipt = { calls, openedTab: "", state: () => state };
Object.assign(window, { titleRoleFixture: receipt });
mockWindows("main");
mockIPC((command, args) => {
  if (command === "plugin:os|platform") return "windows";
  if (command === "native_language_set") return;
  if (command === "remote_request") {
    calls.push({ method: String(args.method), machineId: args.machineId, params: args.params });
    if (args.machineId !== "fixture-host") throw new Error("Wrong Host scope");
    if (args.method === "modelRouting.get") return { state };
    if (args.method === "modelRouting.resolve")
      return { resolution: { ok: false, reason: "noEligibleEntry", skipped: [] } };
    if (args.method === "modelRouting.save") {
      if (params.has("denied")) throw new Error("Permission denied");
      const input = args.params as { expectedVersion: number; draft: object };
      if (input.expectedVersion !== state.version) throw new Error("Version conflict");
      state = {
        ...state,
        ...input.draft,
        version: state.version + 1,
        updatedAt: state.updatedAt + 1,
      };
      localStorage.setItem(key, JSON.stringify(state));
      return { state };
    }
  }
  throw new Error(`Unexpected title role fixture IPC: ${command}`);
});
applyThemePreference(params.get("theme") === "light" ? "light" : "dark");
initAppearancePreferences();
const client = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
const root = createRoot(document.getElementById("root")!);
function render(assignments: boolean) {
  root.render(
    <QueryClientProvider client={client}>
      <main className="settings-view h-screen overflow-auto bg-background-base text-content p-6">
        <div className="chat-settings settings-topics mx-auto max-w-4xl">
          <HelperModelsSettings />
          {assignments ? (
            <section aria-label="Fixture Host assignments">
              <ModelRolesSettings machineId="fixture-host" supported={!params.has("unsupported")} />
            </section>
          ) : null}
        </div>
      </main>
    </QueryClientProvider>,
  );
}
window.addEventListener(OPEN_MODELS_SETTINGS_EVENT, (event) => {
  receipt.openedTab = (event as CustomEvent<string>).detail;
  if (receipt.openedTab === "roles") render(true);
});
void setLanguagePreference("en").then(() => render(false));
