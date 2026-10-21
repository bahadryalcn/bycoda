import { createRoot } from "react-dom/client";
import { useState } from "react";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { QueryProvider } from "../../src/app/QueryProvider";
import { CrewsSettings } from "../../src/features/crews/ui/CrewsSettings";
import { CrewSidebar } from "../../src/features/crews/ui/CrewSessions";
import { CrewRailSection } from "../../src/features/crews/ui/CrewRailSection";
import { CrewTaskPicker } from "../../src/features/crews/ui/CrewTaskPicker";
import {
  defaultCrewPolicy,
  type CrewDefinition,
  type SavedCrewAgent,
} from "../../src/features/crews/model/crew";
import { setLanguagePreference } from "../../src/shared/i18n";
import { applyThemePreference } from "../../src/features/settings/model/appearance";
import { Button } from "../../src/shared/ui/Button";
import "../../src/styles/index.css";
import "../../src/features/settings/ui/BycodaSettings.css";

// Isolated transport. No owner hosts, accounts or paid providers are reached.
mockWindows("main");
const params = new URLSearchParams(location.search);
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
let agents: SavedCrewAgent[] =
  params.get("library") === "empty"
    ? []
    : [
        {
          id: "lib-ui",
          name: "UI designer",
          role: "specialist",
          selection: "fixed",
          instructions: "Owns screens shared by web and mobile",
          candidates: [candidate],
          groups: ["UI", "Mobile"],
          updatedAt: 1,
        },
        {
          id: "lib-api",
          name: "API engineer",
          role: "specialist",
          selection: "fixed",
          instructions: "Owns backend contracts",
          candidates: [candidate],
          groups: ["Backend"],
          projectId: "project",
          updatedAt: 1,
        },
      ];
let starts = 0;
let runs = [
  {
    id: "run",
    projectId: "project",
    definition,
    coordinatorSessionId: "lead-session",
    status: "active",
    launch: {
      candidate,
      runtimeMode: "supervised",
      prompt: "Build settings page\nWith tests",
    },
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
    updatedAt: 2,
    tasks: [
      {
        id: "task",
        title: "Build settings",
        harness: "codex",
        model: "codex:fixture",
        status: "review",
        sessionId: "ui-session",
        verification: {
          review: { verdict: "pass", sessionId: "review-session" },
        },
      },
    ],
  },
  {
    id: "old-run",
    projectId: "project",
    definition,
    coordinatorSessionId: "old-lead",
    status: "finished",
    launch: {
      candidate,
      runtimeMode: "supervised",
      prompt: "Audit landing page",
    },
    assignments: [],
    messages: [],
    notifications: {},
    createdAt: 0,
    updatedAt: 1,
    tasks: [],
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
        return {
          capabilities: [
            "crews.v1",
            "crews.tasks.v1",
            "crews.delete.v1",
            ...(params.get("legacy") ? [] : ["crews.agent-groups.v1"]),
          ],
          environmentId: "fixture",
        };
      case "projects.list":
        return [{ id: "project", cwd, name: "Fixture" }];
      case "models.list":
        return {
          models: {
            codex: [
              {
                id: "codex:fixture",
                harness: "codex",
                name: "Codex fixture",
                settings: [],
              },
            ],
          },
          errors: {},
        };
      case "crews.list":
        return { definitions, runs, agents };
      case "crews.save": {
        const input = p.definition as CrewDefinition;
        const previous = definitions.find((d) => d.id === input.id);
        if (previous && p.expectedUpdatedAt !== previous.updatedAt)
          throw new Error("Crew changed. Reload before saving");
        const d = {
          ...input,
          updatedAt: Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1),
        };
        definitions = [...definitions.filter((a) => a.id !== d.id), d];
        return d;
      }
      case "crews.agent.save": {
        const input = p.agent as SavedCrewAgent;
        const previous = agents.find((a) => a.id === input.id);
        if (previous && previous.updatedAt !== p.expectedUpdatedAt)
          throw new Error("Agent changed. Reload before saving");
        const saved = { ...input, updatedAt: (previous?.updatedAt ?? 0) + 1 };
        agents = [...agents.filter((a) => a.id !== saved.id), saved];
        return saved;
      }
      case "crews.agent.delete":
        agents = agents.filter((a) => a.id !== p.agentId);
        return { deleted: true };
      case "crews.delete":
        definitions = definitions.filter((d) => d.id !== p.definitionId);
        return { deleted: true };
      case "crews.start":
        starts += 1;
        document.querySelector("[aria-label='Started work']")!.textContent = String(starts);
        return {
          id: `run-${starts}`,
          coordinatorSessionId: `started-${starts}`,
        };
      case "crews.pause":
        runs = runs.map((r) => (r.id === p.runId ? { ...r, status: "paused" } : r));
        return runs[0];
      case "crews.resume":
        runs = runs.map((r) => (r.id === p.runId ? { ...r, status: "active" } : r));
        return runs[0];
      case "crews.stop":
        runs = runs.map((r) => (r.id === p.runId ? { ...r, status: "finished" } : r));
        return runs[0];
    }
  }
  if (command.startsWith("plugin:")) return null;
  throw new Error(`Unsupported fixture operation ${command}`);
});
// Another session saving the same crew while it is open here.
Object.assign(window, {
  simulateCrewUpdate: () => {
    definitions = definitions.map((d) =>
      d.id === "crew"
        ? {
            ...d,
            name: "Updated by another session",
            updatedAt: d.updatedAt + 1,
          }
        : d,
    );
  },
});
setLanguagePreference("en");
applyThemePreference(params.get("theme") === "light" ? "light" : "dark");
const drag = {
  setRef: () => {},
  folded: false,
  headerProps: {
    onPointerDown: () => {},
    onClickCapture: () => {},
    onKeyDown: () => {},
    onContextMenu: () => {},
  },
  openMenu: () => {},
};
function Fixture() {
  const [view, setView] = useState("sessions");
  const [opened, setOpened] = useState("");
  const [crew, setCrew] = useState<string | undefined>();
  const [valid, setValid] = useState(true);
  return (
    <QueryProvider>
      <main className="bycoda-arc flex min-h-screen flex-wrap bg-(--ui-surface) text-(--color-content)">
        <aside
          className="@container/rail flex shrink-0 flex-col border-e border-(--ui-tone-neutral-border) pt-2"
          style={{ width: 256 }}
        >
          <CrewRailSection
            cwd={cwd}
            drag={drag}
            onOpenSession={(target) => setOpened(target.sessionId)}
          />
        </aside>
        <aside className="w-80 max-w-full shrink-0 border-e border-(--ui-tone-neutral-border)">
          <CrewSidebar
            cwd={cwd}
            onOpen={(target) => setOpened(target.sessionId)}
            onManagedChange={() => {}}
          />
        </aside>
        <div className="min-w-0 flex-1 p-4" style={{ flexBasis: "24rem" }}>
          <Button variant="ghost" onClick={() => setView("settings")}>
            Crew settings page
          </Button>
          <Button variant="ghost" onClick={() => setView("task")}>
            Task crew selection
          </Button>
          <output aria-label="Opened session">{opened}</output>
          <output aria-label="Started work">0</output>
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
          ) : null}
        </div>
      </main>
    </QueryProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
