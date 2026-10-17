import { useState } from "react";
import { createRoot } from "react-dom/client";
import { OrchestrationPreview } from "../../src/features/orchestration/ui/OrchestrationPreview";
import { OrchestrationSidebarAgents } from "../../src/features/orchestration/ui/OrchestrationSidebarAgents";
import { OrchestrationActions } from "../../src/features/orchestration/ui/OrchestrationActions";
import { orchestrator } from "../../src/features/orchestration/model/orchestration";
import { setHarnessModels } from "../../src/features/sessions/model/models";
import { setLanguagePreference } from "../../src/shared/i18n";
import type { OrchestrationProposal } from "../../src/features/orchestration/model/orchestrationPlan";
import "../../src/styles/index.css";
await setLanguagePreference("en");
setHarnessModels("codex", [
  {
    id: "codex:fixture",
    harness: "codex",
    name: "Fixture One",
    settings: [
      {
        id: "reasoningEffort",
        label: "Reasoning",
        kind: "select",
        value: "high",
        options: [
          { value: "high", label: "High" },
          { value: "xhigh", label: "Extra High" },
        ],
      },
      {
        id: "serviceTier",
        label: "Service Tier",
        kind: "select",
        value: "default",
        options: [
          { value: "default", label: "Standard" },
          { value: "fast", label: "Fast" },
        ],
      },
    ],
  },
]);
setHarnessModels("claude", [
  {
    id: "claude:fixture",
    harness: "claude",
    name: "Fixture Two",
    settings: [
      {
        id: "effort",
        label: "Effort",
        kind: "select",
        value: "high",
        options: [
          { value: "high", label: "High" },
          { value: "xhigh", label: "Extra High" },
        ],
      },
    ],
  },
]);
const calls: { kind: string; payload: unknown }[] = [];
let rejectConfirmation: () => void = () => {};
const choices = [
  { harness: "codex" as const, model: "codex:fixture", name: "Fixture One" },
  { harness: "claude" as const, model: "claude:fixture", name: "Fixture Two" },
];
const initial: OrchestrationProposal = {
  version: 1,
  leadId: "fixture-lead",
  cwd: "C:/fixture",
  request: "Review fixture",
  author: choices[0],
  settings: { choices, maxWorkers: 2 },
  status: "ready",
  title: "Review the offline proposal",
  summary: "",
  tasks: [
    {
      id: "ui",
      title: "UI task",
      prompt: "Retained original instructions",
      harness: "codex",
      model: "codex:fixture",
      modelSettings: { reasoningEffort: "high", serviceTier: "fast" },
      files: [],
      dependsOn: [],
    },
  ],
};
// Only the exported facade is replaced inside this offline fixture. No live orchestrator/host is called.
const pausedRuns = [
  {
    leadId: "paused-fixture",
    status: "paused",
    allowedHarnesses: ["codex"],
    maxWorkers: 2,
    tasks: [
      {
        id: "worker",
        sessionId: "worker-session",
        title: "Interrupted worker",
        harness: "codex",
        model: "codex:fixture",
        status: "interrupted",
      },
    ],
  },
];
Object.assign(orchestrator, {
  subscribe: () => () => {},
  snapshot: () => pausedRuns,
  hydrate: async () => {},
  resumeBlocker: () => undefined,
  resumeLeadBusy: () => false,
  start: async (...args: unknown[]) => {
    calls.push({ kind: "resume", payload: args });
  },
  cancelTask: async (...args: unknown[]) => {
    calls.push({ kind: "cancel", payload: args });
  },
});
Object.assign(window, {
  orchestrationFixtureCalls: calls,
  rejectFixtureConfirmation: () => rejectConfirmation(),
});
function Fixture() {
  const [proposal, setProposal] = useState(initial);
  return (
    <main className="mx-auto flex max-w-3xl min-w-0 flex-col gap-4 p-3">
      <OrchestrationActions.Provider
        value={{
          update: (_lead, _block, next) => setProposal(next),
          confirm: async () => {
            calls.push({ kind: "confirm", payload: structuredClone(proposal) });
            await new Promise<void>((_resolve, reject) => {
              rejectConfirmation = () => reject(new Error("Fixture approval unavailable"));
            });
          },
          retry: () => {},
          open: () => {},
        }}
      >
        <OrchestrationPreview
          block={{ id: "fixture-card", role: "plan", text: "", orchestration: proposal }}
        />
        <OrchestrationSidebarAgents
          leadId="paused-fixture"
          summary={{
            status: "paused",
            live: true,
            tasks: [
              {
                sessionId: "worker-session",
                title: "Interrupted worker",
                harness: "codex",
                model: "codex:fixture",
                status: "interrupted",
              },
            ],
          }}
        />
      </OrchestrationActions.Provider>
      <output data-testid="proposal" className="hidden">
        {JSON.stringify(proposal)}
      </output>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
