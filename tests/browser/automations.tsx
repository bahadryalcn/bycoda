import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AutomationsView } from "../../src/features/automations/ui/AutomationsView";
import {
  newAutomationDraft,
  type Automation,
} from "../../src/features/automations/model/automations";
import { ModelSourceContext } from "../../src/features/sessions/ui/modelSource";
import {
  modelsFor,
  resolveModel,
  findModel,
  setHarnessModels,
} from "../../src/features/sessions/model/models";
import { languageReady, setLanguagePreference } from "../../src/shared/i18n";
import "../../src/styles/index.css";

// Every operation stays in this memory-only fixture. No host/provider is contacted.
let automation: Automation = {
  ...newAutomationDraft("C:/fixture/project", "claude", "claude:fixture"),
  id: "fixture-review",
  name: "Daily review",
  prompt: "Review the fixture workspace",
  nextRunAt: 0,
  createdAt: 1,
  updatedAt: 1,
};
const calls: { command: string; args: Record<string, unknown> }[] = [];
Object.assign(window, {
  automationFixtureCalls: calls,
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: async (command: string, args: Record<string, unknown> = {}) => {
      calls.push({ command, args: structuredClone(args) });
      if (command === "default_cwd") return "C:/fixture/home";
      if (command === "plugin:event|listen") return 1;
      if (command === "automations_list") return [structuredClone(automation)];
      if (command === "automations_upsert") {
        automation = { ...(args.automation as Automation), createdAt: 1, updatedAt: 2 };
        return structuredClone(automation);
      }
      if (command === "automations_delete") throw new Error("Fixture must cancel deletion");
      if (command === "automation_runs_list" || command === "remote_machines") return [];
      if (command.endsWith("_status")) return { connected: false };
      if (command.startsWith("plugin:")) return null;
      return [];
    },
  },
});
setHarnessModels("claude", [{ id: "claude:fixture", harness: "claude", name: "Demo agent" }]);
const source = {
  modelsFor,
  resolve: resolveModel,
  find: findModel,
  available: () => true,
  probed: () => true,
  refresh: () => {},
};
void languageReady
  .then(() => setLanguagePreference("en"))
  .then(() => {
    createRoot(document.getElementById("root")!).render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ModelSourceContext.Provider value={source}>
          <div className="flex h-dvh min-h-0 min-w-0 flex-col bg-background-base text-content">
            <AutomationsView
              besideRail
              cwd="C:/fixture/project"
              recents={[]}
              onClose={() => {}}
              onLaunch={() => {}}
              onLaunchAssistant={async (launch) => {
                (window as unknown as { assistantLaunch: unknown }).assistantLaunch = launch;
              }}
              onOpenSession={() => {}}
              onOpenBackgroundSession={() => {}}
            />
          </div>
        </ModelSourceContext.Provider>
      </QueryClientProvider>,
    );
  });
