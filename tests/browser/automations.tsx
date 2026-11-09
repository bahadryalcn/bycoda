import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AutomationsView } from "../../src/features/automations/ui/AutomationsView";
import {
  newAutomationDraft,
  type Automation,
  type AutomationRun,
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
// ?runs=mixed fills the run history with every status, ?runs=error fails the first
// read (Retry succeeds) and ?runs=slow keeps it loading until releaseRuns() is called.
const runsMode = new URLSearchParams(location.search).get("runs");
// ?host=offline starts with an empty local collection and one unavailable Host.
const offlineHostMode = new URLSearchParams(location.search).get("host") === "offline";
let hasLocalAutomation = !offlineHostMode;
const remoteMachine = {
  id: "fixture-tailm",
  name: "tailm",
  endpoint: "http://fixture-tailm.invalid:3774",
  environmentId: "fixture-tailm-environment",
};
const at = Date.now();
const sampleRuns: AutomationRun[] = [
  {
    id: "run-input",
    automationId: "fixture-review",
    trigger: "scheduled",
    scheduledFor: at - 120_000,
    createdAt: at - 120_000,
    startedAt: at - 110_000,
    status: "running",
    needsInput: true,
    sessionId: "session-input",
  },
  {
    id: "run-running",
    automationId: "fixture-review",
    trigger: "event",
    scheduledFor: at - 600_000,
    createdAt: at - 600_000,
    startedAt: at - 590_000,
    status: "running",
    sessionId: "session-running",
  },
  {
    id: "run-ok",
    automationId: "fixture-review",
    trigger: "scheduled",
    scheduledFor: at - 3_600_000,
    createdAt: at - 3_600_000,
    startedAt: at - 3_590_000,
    completedAt: at - 3_500_000,
    status: "succeeded",
    sessionId: "session-ok",
  },
  {
    id: "run-failed",
    automationId: "fixture-review",
    trigger: "manual",
    scheduledFor: at - 86_400_000,
    createdAt: at - 86_400_000,
    startedAt: at - 86_390_000,
    completedAt: at - 86_300_000,
    status: "failed",
    error:
      "Fixture failure: the selected model was unavailable and the run ended before the first message could be sent to the agent, so no changes were made.",
  },
  {
    id: "run-skipped",
    automationId: "fixture-review",
    trigger: "scheduled",
    scheduledFor: at - 2 * 86_400_000,
    createdAt: at - 2 * 86_400_000,
    status: "skipped",
    error: "The previous run was still active.",
  },
  {
    id: "run-cancelled",
    automationId: "fixture-review",
    trigger: "scheduled",
    scheduledFor: at - 3 * 86_400_000,
    createdAt: at - 3 * 86_400_000,
    startedAt: at - 3 * 86_400_000,
    completedAt: at - 3 * 86_400_000 + 30_000,
    status: "cancelled",
    sessionId: "session-cancelled",
  },
  {
    id: "run-pending",
    automationId: "fixture-review",
    trigger: "scheduled",
    scheduledFor: at + 60_000,
    createdAt: at,
    status: "pending",
  },
];
let runReads = 0;
let releaseRuns: () => void = () => {};
const runsHeld = new Promise<void>((resolve) => (releaseRuns = resolve));
const calls: { command: string; args: Record<string, unknown> }[] = [];
const control = {
  holdSave: false,
  remoteAvailable: false,
  finishSave: null as null | ((error?: string) => void),
  releaseRuns: () => releaseRuns(),
};
Object.assign(window, {
  automationFixtureCalls: calls,
  automationFixtureControl: control,
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: async (command: string, args: Record<string, unknown> = {}) => {
      calls.push({ command, args: structuredClone(args) });
      if (command === "default_cwd") return "C:/fixture/home";
      if (command === "plugin:event|listen") return 1;
      if (command === "automations_list")
        return hasLocalAutomation ? [structuredClone(automation)] : [];
      if (command === "automations_upsert") {
        if (control.holdSave) {
          await new Promise<void>((resolve, reject) => {
            control.finishSave = (error) => {
              control.finishSave = null;
              if (error) reject(new Error(error));
              else resolve();
            };
          });
        }
        automation = { ...(args.automation as Automation), createdAt: 1, updatedAt: 2 };
        hasLocalAutomation = true;
        return structuredClone(automation);
      }
      if (command === "automations_delete") throw new Error("Fixture must cancel deletion");
      if (command === "automation_runs_list") {
        runReads++;
        if (runsMode === "slow") await runsHeld;
        if (runsMode === "error" && runReads === 1)
          throw new Error("Fixture: run history is unavailable right now");
        return runsMode ? structuredClone(sampleRuns) : [];
      }
      if (command === "remote_machines")
        return offlineHostMode ? [structuredClone(remoteMachine)] : [];
      if (command === "remote_request" && args.machineId === remoteMachine.id) {
        if (args.method === "environment.describe") {
          if (!control.remoteAvailable) throw new Error("Fixture: tailm is unreachable");
          return { capabilities: ["automations"] };
        }
        if (args.method === "automations.list" || args.method === "projects.list") return [];
        throw new Error(`Unexpected fixture Host operation: ${String(args.method)}`);
      }
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
