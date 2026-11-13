import {
  HostAutomationSchema,
  type HostAutomation,
} from "../../../src/shared/model/host-contracts/automations";
import { TriggerRow } from "../../../src/features/automations/ui/TriggerEditor";
import { createAutomationTrigger } from "../../../src/features/automations/model/automations";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AutomationsView } from "../../../src/features/automations/ui/AutomationsView";
import {
  newAutomationDraft,
  type Automation,
  type AutomationRun,
} from "../../../src/features/automations/model/automations";
import { ModelSourceContext } from "../../../src/features/sessions/ui/modelSource";
import {
  modelsFor,
  resolveModel,
  findModel,
  setHarnessModels,
} from "../../../src/features/sessions/model/models";
import { languageReady, setLanguagePreference } from "../../../src/shared/i18n";
import "../../../src/styles/index.css";

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
if (new URLSearchParams(location.search).has("multiTriggers")) {
  automation.triggers = [
    createAutomationTrigger("tasks", "task_blocked"),
    createAutomationTrigger("tasks", "task_completed"),
  ];
}
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
const hostWork = new URLSearchParams(location.search).has("hostWork");
const roomWork = new URLSearchParams(location.search).has("room");
const fixtureHost = {
  id: "fixture-work",
  name: "This computer (local sync)",
  localHost: true,
  environmentId: "fixture-work",
  endpoint: "http://127.0.0.1:1",
};
const hostProject = { id: "fixture-project", cwd: "C:/fixture/project", name: "Fixture project" };
let hostAutomation: HostAutomation = {
  id: "fixture-host-review",
  name: roomWork ? "Room review" : "Project review",
  prompt: "Review fixture activity and report findings",
  projectId: roomWork ? "" : hostProject.id,
  harness: "claude",
  model: "claude:fixture",
  modelSettings: {},
  runtimeMode: "supervised",
  scheduleKind: "daily",
  minute: 0,
  time: "09:00",
  dayOfWeek: 1,
  maxRunMinutes: 30,
  maxRunsPerDay: 3,
  enabled: true,
  nextRunAt: Date.now() + 3600000,
  createdAt: 1,
  updatedAt: 1,
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
        return !hostWork && hasLocalAutomation ? [structuredClone(automation)] : [];
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
      if (hostWork && command === "remote_machines") return [fixtureHost];
      if (hostWork && command === "local_host_connect") return fixtureHost;
      if (hostWork && command === "remote_request" && args.machineId === fixtureHost.id) {
        const input = (args.params ?? {}) as Record<string, unknown>;
        switch (args.method) {
          case "environment.describe":
            return {
              environmentId: fixtureHost.environmentId,
              capabilities: [
                "automations",
                "automations.room.v1",
                "automations.triggers.v1",
                "automations.project-tasks",
                "models.routing.v1",
              ],
            };
          case "projects.list":
            return [hostProject];
          case "modelRouting.get":
            return {
              state: {
                version: 1,
                updatedAt: 1,
                entries: [
                  {
                    id: "fixture-model",
                    harness: "claude",
                    model: "claude:fixture",
                    modelSettings: {},
                    unknownLimit: "use",
                  },
                ],
                pools: [],
                roles: {},
                delegation: { global: {}, providers: {}, accounts: {} },
              },
            };
          case "modelRouting.status":
            return { entries: [{ entryId: "fixture-model", leftPercent: 80 }] };
          case "automations.list":
            return [structuredClone(hostAutomation)];
          case "automations.runs":
            runReads++;
            if (runsMode === "slow") await runsHeld;
            if (runsMode === "error" && runReads === 1)
              throw new Error("Fixture: run history is unavailable right now");
            return sampleRuns.map((run) => ({
              ...run,
              automationId: hostAutomation.id,
              ...(roomWork ? {} : { taskId: `task-${run.id}` }),
            }));
          case "automations.preview":
            return { timeZone: "UTC", nextRunAt: at + 3600000 };
          case "automations.save": {
            const incoming = input.automation as Record<string, unknown>;
            if (
              incoming.expectedConfiguration &&
              JSON.stringify(incoming.expectedConfiguration) !== JSON.stringify(hostAutomation)
            )
              throw new Error("Automation changed. Reload before saving.");
            const { expectedConfiguration: _expected, ...configuration } = incoming;
            hostAutomation = HostAutomationSchema.parse({
              ...configuration,
              createdAt: hostAutomation.createdAt,
              updatedAt: hostAutomation.updatedAt + 1,
              nextRunAt: at + 3600000,
            });
            return structuredClone(hostAutomation);
          }
          default:
            throw new Error(`Unexpected Work automation fixture operation: ${String(args.method)}`);
        }
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
document.documentElement.classList.toggle(
  "theme-light",
  new URLSearchParams(location.search).get("theme") === "light",
);
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
            {new URLSearchParams(location.search).has("triggerDensity") ? (
              <div className="p-3">
                <TriggerRow
                  trigger={createAutomationTrigger("tasks", "task_blocked")}
                  cwd=""
                  onChange={() => {}}
                  onRemove={() => {}}
                />
              </div>
            ) : (
              <AutomationsView
                besideRail
                cwd={roomWork ? undefined : "C:/fixture/project"}
                recents={[]}
                onClose={() => {}}
                onLaunch={() => {}}
                onLaunchAssistant={async (launch) => {
                  (window as unknown as { assistantLaunch: unknown }).assistantLaunch = launch;
                }}
                onOpenSession={() => {}}
                onOpenBackgroundSession={() => {}}
              />
            )}
          </div>
        </ModelSourceContext.Provider>
      </QueryClientProvider>,
    );
  });
