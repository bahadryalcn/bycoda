import { createRoot } from "react-dom/client";
import { useState } from "react";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { QueryProvider } from "../../src/app/QueryProvider";
import { CrewsSettings } from "../../src/features/crews/ui/CrewsSettings";
import { CrewSidebar } from "../../src/features/crews/ui/CrewSessions";
import { CrewTaskPicker } from "../../src/features/crews/ui/CrewTaskPicker";
import { defaultCrewPolicy, type CrewDefinition } from "../../src/features/crews/model/crew";
import { setLanguagePreference } from "../../src/shared/i18n";
import { applyThemePreference } from "../../src/features/settings/model/appearance";
import { Button } from "../../src/shared/ui/Button";
import "../../src/styles/index.css";
import "../../src/features/settings/ui/BycodaSettings.css";

// Isolated transport. No owner hosts, accounts or paid providers are reached.
mockWindows("main");
const cwd = "C:/fixture/crew-project";
const candidate = {
  id: "codex/codex:fixture",
  harness: "codex" as const,
  model: "codex:fixture",
  modelSettings: {},
  capabilities: {},
};
const definition: CrewDefinition = {
  id: "crew",
  name: "Website Crew",
  projectId: "project",
  updatedAt: 1,
  policy: defaultCrewPolicy,
  agents: [
    {
      id: "coordinator",
      name: "Coordinator",
      role: "coordinator",
      selection: "fixed",
      instructions: "Delegate implementation and review",
      candidates: [candidate],
    },
    {
      id: "ui",
      name: "UI",
      role: "specialist",
      selection: "automatic",
      instructions: "Build accessible UI",
      candidates: [candidate],
    },
    {
      id: "review",
      name: "Reviewer",
      role: "reviewer",
      selection: "fixed",
      instructions: "Review independently",
      candidates: [candidate],
    },
  ],
};
let definitions = [definition];
let runs = [
  {
    id: "run",
    projectId: "project",
    definition,
    coordinatorSessionId: "lead-session",
    status: "active",
    assignments: [
      {
        id: "assignment",
        taskId: "task",
        memberId: "ui",
        title: "Build settings",
        candidate,
        reason: "Fixed model; verified catalog",
      },
    ],
    messages: [
      {
        id: "request",
        from: "ui-session",
        text: "Need image generation for the hero",
        createdAt: 1,
      },
    ],
    notifications: {},
    createdAt: 1,
    updatedAt: 1,
    tasks: [
      {
        id: "task",
        title: "Build settings",
        harness: "codex",
        model: "codex:fixture",
        status: "review",
        sessionId: "ui-session",
        verification: { review: { verdict: "pass", sessionId: "review-session" } },
      },
    ],
  },
];
mockIPC((command, args) => {
  if (command === "remote_machines")
    return [
      {
        id: "machine",
        name: "Fixture",
        localHost: true,
        environmentId: "fixture",
        endpoint: "http://127.0.0.1:1",
      },
    ];
  if (command === "remote_request") {
    const p = args?.params as Record<string, unknown>;
    switch (args?.method) {
      case "environment.describe":
        return { capabilities: ["crews.v1", "crews.tasks.v1"], environmentId: "fixture" };
      case "projects.list":
        return [{ id: "project", cwd, name: "Fixture" }];
      case "models.list":
        return {
          models: {
            codex: [{ id: "codex:fixture", harness: "codex", name: "Codex fixture", settings: [] }],
          },
          errors: {},
        };
      case "crews.list":
        return { definitions, runs, agents: [] };
      case "crews.save": {
        const input = p.definition as CrewDefinition;
        const previous = definitions.find((d) => d.id === input.id);
        if (previous && p.expectedUpdatedAt !== previous.updatedAt)
          throw new Error("Crew changed. Reload before saving");
        const d = { ...input, updatedAt: Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1) };
        definitions = [...definitions.filter((a) => a.id !== d.id), d];
        return d;
      }
      case "crews.pause":
        runs = runs.map((r) => ({ ...r, status: "paused" }));
        return runs[0];
      case "crews.resume":
        runs = runs.map((r) => ({ ...r, status: "active" }));
        return runs[0];
    }
  }
  if (command.startsWith("plugin:")) return null;
  throw new Error(`Unsupported fixture operation ${command}`);
});
setLanguagePreference("en");
applyThemePreference(
  new URLSearchParams(location.search).get("theme") === "light" ? "light" : "dark",
);
function Fixture() {
  const [view, setView] = useState("sessions");
  const [opened, setOpened] = useState("");
  const [crew, setCrew] = useState<string | undefined>();
  const [valid, setValid] = useState(true);
  return (
    <QueryProvider>
      <main className="bycoda-arc flex min-h-screen flex-wrap bg-(--ui-surface) text-(--color-content)">
        <aside className="w-80 max-w-full shrink-0 border-e border-(--ui-tone-neutral-border)">
          <CrewSidebar
            cwd={cwd}
            onOpen={(target) => setOpened(target.sessionId)}
            onSettings={() => setView("settings")}
            onManagedChange={() => {}}
          />
        </aside>
        <div className="min-w-0 flex-1 p-4" style={{ flexBasis: "32rem" }}>
          <Button variant="ghost" onClick={() => setView("settings")}>
            Crew settings
          </Button>
          <Button variant="ghost" onClick={() => setView("sessions")}>
            Leave settings
          </Button>
          <Button variant="ghost" onClick={() => setView("task")}>
            Task crew selection
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              definitions = definitions.map((d) =>
                d.id === "crew"
                  ? { ...d, name: "Updated by another session", updatedAt: d.updatedAt + 1 }
                  : d,
              );
            }}
          >
            Simulate external crew update
          </Button>
          <output aria-label="Opened session">{opened}</output>
          {view === "task" ? (
            <div>
              <CrewTaskPicker
                cwd={cwd}
                machineId="machine"
                value={crew}
                onChange={setCrew}
                onValidityChange={setValid}
              />
              <output aria-label="Selected crew">
                {valid ? (crew ?? "Single agent") : "Unavailable"}
              </output>
            </div>
          ) : view === "settings" ? (
            <div className="bycoda-settings-content bycoda-settings-form">
              <CrewsSettings cwd={cwd} />
            </div>
          ) : (
            <p>Open any member to continue its conversation.</p>
          )}
        </div>
      </main>
    </QueryProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
