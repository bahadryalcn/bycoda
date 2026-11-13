import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { QueryProvider } from "../../../src/app/QueryProvider";
import { CrewsSettings } from "../../../src/features/crews/ui/CrewsSettings";
import { CrewsPage } from "../../../src/features/crews/ui/page/CrewsPage";
import { CrewSidebar } from "../../../src/features/crews/ui/CrewSessions";
import { CrewRailSection } from "../../../src/features/crews/ui/CrewRailSection";
import { OPEN_CREWS_PAGE_EVENT } from "../../../src/features/crews/model/crewsPage";
import { CrewTaskPicker } from "../../../src/features/crews/ui/CrewTaskPicker";
import { CrewFaces } from "../../../src/features/crews/ui/CrewFaces";
import { SourceKindIcon } from "../../../src/features/decision-models/ui/SourceIcon";
import { AccountColorDot } from "../../../src/features/providers/ui/AccountColorDot";
import { GenericAcpSettings } from "../../../src/features/providers/ui/GenericAcpSettings";
import { ScanSettings } from "../../../src/features/decision-models/ui/ScanSettings";
import {
  defaultCrewPolicy,
  type CrewDefinition,
  type SavedCrewAgent,
} from "../../../src/features/crews/model/crew";
import { setLanguagePreference } from "../../../src/shared/i18n";
import { createDefaultCrew } from "../../../src/features/crews/model/crewDefaults";
import { applyThemePreference } from "../../../src/features/settings/model/appearance";
import { Button } from "../../../src/shared/ui/Button";
import "../../../src/styles/index.css";
import "../../../src/features/settings/ui/BycodaSettings.css";

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
if (params.has("longRoster")) {
  // A long, varied roster for scan/scroll evidence. Fixture data only.
  const longNames = [
    "Accessibility and keyboard navigation specialist for the settings surfaces",
    "Database migration engineer",
    "Mobile release lead",
    "Localization reviewer (eleven languages)",
    "Performance profiling engineer",
    "Documentation writer",
    "Security reviewer",
    "Design systems engineer",
    "API contract specialist",
    "QA automation engineer",
    "Release notes editor",
    "Telemetry analyst",
  ];
  definition.agents.push(
    ...longNames.map((name, index) => ({
      id: `long-${index}`,
      name,
      role: (index === 3 ? "advisor" : "specialist") as "advisor" | "specialist",
      selection: (index % 3 === 0 ? "automatic" : "fixed") as "automatic" | "fixed",
      instructions:
        "Own the assigned area end to end and report blockers early.\nKeep a written trail of decisions.",
      candidates: [candidate],
      groups: index % 2 ? ["Quality"] : undefined,
    })),
  );
}
const poolCandidate = (harness: "codex" | "claude", model: string) => ({
  id: `${harness}/${model}`,
  harness,
  model,
  modelSettings: {},
  capabilities: {},
});
let modelPools = [
  {
    id: "pool-fast",
    name: "Fast and cheap",
    candidates: [
      poolCandidate("codex", "gpt-6-mini"),
      poolCandidate("claude", "claude-haiku-5"),
      poolCandidate("codex", "codex:fixture"),
    ],
    updatedAt: 1,
  },
  {
    id: "pool-deep",
    name: "Deep reasoning",
    candidates: [
      poolCandidate("codex", "gpt-6-high-reasoning-extended"),
      poolCandidate("claude", "claude-opus-5"),
    ],
    updatedAt: 1,
  },
];
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
if (params.has("defaults")) {
  const defaults = createDefaultCrew(
    {
      models: {
        codex: [
          {
            id: candidate.model,
            harness: candidate.harness,
            name: "Codex fixture",
            settings: [],
          },
        ],
      },
      errors: {},
    },
    1,
  )!;
  definitions = [defaults.definition];
  agents = defaults.agents;
}

if (params.has("rich")) {
  // Identity, tools, library links and teams for the Crews page evidence. Fixture data only.
  const look = (
    outfit: "cardigan" | "vest" | "jacket",
    palette: number,
    headwear?: "flat-cap" | "takke" | "beret",
  ) => ({
    outfit,
    palette,
    ...(headwear ? { headwear } : {}),
  });
  Object.assign(definition.agents[0]!, {
    avatar: look("jacket", 1, "flat-cap"),
    handle: "lead",
  });
  Object.assign(definition.agents[1]!, {
    pool: { id: "pool-deep" },
    candidates: modelPools[1]!.candidates,
    avatar: look("vest", 3, "beret"),
    handle: "ui",
    source: { id: "lib-ui", updatedAt: 1 },
    tools: { preset: "design" },
  });
  Object.assign(definition.agents[2]!, {
    avatar: look("cardigan", 4),
    handle: "reviewer",
  });
  definition.agents.push({
    id: "api",
    name: "API engineer",
    role: "specialist",
    selection: "fixed",
    instructions: "Owns backend contracts for this crew",
    candidates: [candidate],
    groups: ["Backend"],
    avatar: look("cardigan", 2, "takke"),
    handle: "api",
    source: { id: "lib-api", updatedAt: 1 },
    customized: true,
    tools: { preset: "read-only" },
  } as CrewDefinition["agents"][number]);
}
if (params.has("rich")) {
  agents = agents.map((agent) =>
    agent.id === "lib-ui"
      ? {
          ...agent,
          handle: "ui",
          avatar: { outfit: "vest", palette: 3, headwear: "beret" },
        }
      : {
          ...agent,
          handle: "api",
          avatar: { outfit: "cardigan", palette: 2, headwear: "takke" },
        },
  );
  agents.push({
    id: "lib-pooled",
    name: "Triage engineer",
    role: "specialist",
    selection: "automatic",
    pool: { id: "pool-fast" },
    instructions: "Sorts incoming issues and picks the cheapest capable model",
    candidates: modelPools[0]!.candidates,
    groups: ["Backend"],
    updatedAt: 1,
    handle: "triage",
    avatar: { outfit: "vest", palette: 6 },
  } as SavedCrewAgent);
  agents.push({
    id: "lib-research",
    name: "Researcher",
    role: "advisor",
    selection: "fixed",
    instructions: "Finds prior art and summarises it",
    candidates: [candidate],
    groups: ["Research"],
    updatedAt: 1,
    handle: "research",
    avatar: { outfit: "jacket", palette: 5, headwear: "flat-cap" },
  });
  definitions = [
    definition,
    {
      id: "mobile",
      name: "Mobile Crew",
      projectId: "project",
      updatedAt: 1,
      policy: defaultCrewPolicy,
      agents: [
        {
          ...definition.agents[0]!,
          id: "m-coordinator",
          name: "Release lead",
          handle: "release",
        },
        { ...definition.agents[1]!, id: "m-ui", name: "UI designer" },
        {
          ...definition.agents[2]!,
          id: "m-review",
          name: "Mobile reviewer",
          handle: "mreview",
        },
      ],
    },
  ];
}
// Realistic recent times for the work list (fixture data; ordering is unchanged).
const baseTime = Date.now() - 3 * 60 * 60_000;
const at = (minutes: number) => baseTime + minutes * 60_000;
let starts = 0;
let groupFailure = false;
let copyFailure = false;
const agentSaveCounts: Record<string, number> = {};
if (params.has("groupRetry")) agents = agents.map((agent) => ({ ...agent, groups: ["UI"] }));
let opens = 0;
const startReceipts = new Map<string, { id: string; coordinatorSessionId: string }>();
const startRequestIds: string[] = [];
let runs = [
  {
    id: "run",
    projectId: "project",
    definition,
    coordinatorSessionId: "lead-session",
    coordinatorStatus: "idle" as "idle" | "running" | "interrupted",
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
        text: params.has("blocked")
          ? "Choose a fallback image provider before continuing. The current account has no remaining image generation capacity, so the owner needs to confirm the next provider and budget."
          : "Need image generation for the hero",
        createdAt: at(1),
      },
    ],
    notifications: {},
    createdAt: at(1),
    updatedAt: at(2),
    tasks: [
      {
        id: "task",
        title: "Build settings",
        harness: "codex",
        model: "codex:fixture",
        status: params.has("reviewingAgain")
          ? "verifying"
          : params.has("blocked")
            ? "blocked"
            : "review",
        reviewer: params.has("reviewingAgain")
          ? { sessionId: "current-review-session" }
          : undefined,
        error: params.has("blocked")
          ? "The design asset is unavailable. Keep the existing layout draft and select a replacement before retrying this task."
          : undefined,
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
    createdAt: at(0),
    updatedAt: at(1),
    tasks: [],
  },
];
if (params.has("multiple")) {
  runs.push({
    ...structuredClone(runs[0]),
    id: "second-run",
    coordinatorSessionId: "second-lead",
    launch: {
      candidate,
      runtimeMode: "supervised",
      prompt: "Improve mobile navigation",
    },
    assignments: [],
    tasks: [],
    messages: [],
    createdAt: at(2),
    updatedAt: at(3),
  });
}
if (params.has("manyRuns")) {
  // Many runs with long titles and mixed states for the work list.
  const states = ["active", "paused", "active", "finished", "finished", "paused", "active"];
  for (let index = 0; index < states.length; index += 1) {
    runs.push({
      ...structuredClone(runs[0]),
      id: `many-${index}`,
      coordinatorSessionId: `many-lead-${index}`,
      status: states[index]!,
      launch: {
        candidate,
        runtimeMode: "supervised",
        prompt: `Work item ${index + 1}: reconcile the mobile session list with the desktop sidebar ordering and keep every draft`,
      },
      assignments: [],
      tasks: [],
      messages: [],
      createdAt: at(10 + index),
      updatedAt: at(10 + index),
    });
  }
}
if (params.has("pausedPlanning")) {
  runs[0] = {
    ...runs[0],
    status: "paused",
    coordinatorStatus: params.has("running") ? "running" : "idle",
    launch: {
      ...runs[0].launch,
      prompt:
        "Review mobile session choices against the desktop application and preserve the full request text\nKeep current drafts and provider selections.",
    },
    assignments: [],
    tasks: [],
    messages: [],
  };
}
if (params.has("rich")) {
  // A finished delivery with accepted work, usage and history for the summary card.
  const doneTask = (id: string, title: string, minutes: number) => ({
    id,
    title,
    harness: "codex",
    model: "codex:fixture",
    status: "done",
    sessionId: `${id}-session`,
    startedAt: at(0),
    completedAt: at(minutes),
    updatedAt: at(minutes),
    budgetUsage: {
      attempts: 1,
      agentMinutes: minutes,
      tokens: 48_000,
      reportedTokens: 48_000,
      reportedCostUsd: 0.42,
    },
  });
  runs[1] = {
    ...runs[1]!,
    definition,
    assignments: [
      {
        id: "a1",
        taskId: "t1",
        memberId: "ui",
        title: "Landing hero",
        candidate,
        reason: "Fixed",
      },
      {
        id: "a2",
        taskId: "t2",
        memberId: "api",
        title: "Contact API",
        candidate,
        reason: "Fixed",
      },
    ],
    tasks: [
      doneTask("t1", "Rebuild the landing hero", 22),
      doneTask("t2", "Add the contact form endpoint", 15),
      { ...doneTask("t3", "Polish footer links", 5), status: "blocked" },
    ],
  } as unknown as (typeof runs)[number];
}
if (params.has("singleRun")) runs = runs.filter((run) => run.id === "run");
if (params.has("unknownActivity")) {
  delete (runs[0] as { coordinatorStatus?: string }).coordinatorStatus;
}
if (params.has("deletedDefinition")) definitions = [];
const operationCalls: string[] = [];
let releaseOperation: () => void = () => {};
const operationGate = new Promise<void>((resolve) => {
  releaseOperation = resolve;
});
Object.assign(window, {
  crewFixtureOperations: operationCalls,
  crewFixtureReleaseOperation: () => releaseOperation(),
});
mockIPC(async (command, args) => {
  if (command === "generic_acp_list")
    return [
      { id: "a", name: "Fixture agent A", command: "agent-a", args: [], envKeys: [] },
      { id: "b", name: "Fixture agent B", command: "agent-b", args: [], envKeys: [] },
    ];
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
    operationCalls.push(String(args?.method));
    if (args?.method === params.get("slowOperation")) await operationGate;
    if (args?.method === params.get("failOperation"))
      throw new Error("The Host could not complete this action. Try again in a moment.");
    switch (args?.method) {
      case "environment.describe":
        return {
          capabilities: [
            "crews.v1",
            "crews.tasks.v1",
            "crews.delete.v1",
            ...(params.has("noAccess") ? [] : ["crews.access.v1"]),
            ...(params.has("noTools") ? [] : ["crews.tools.v1"]),
            ...(params.has("rich") ? ["crews.active.v1", "crews.model-pools.v1"] : []),
            ...(params.has("noIdentity") ? [] : ["crews.identity.v1"]),
            ...(params.get("legacy") ? [] : ["crews.agent-groups.v1", "crews.run-delete.v1"]),
          ],
          environmentId: "fixture",
        };
      case "crews.active.list": {
        const base = Date.now();
        const row = (
          memberId: string,
          memberName: string,
          memberRole: string,
          kind: string,
          extra: Record<string, unknown>,
        ) => ({
          runId: "run",
          projectId: "project",
          projectName: "Fixture",
          definitionId: "crew",
          definitionName: "Website Crew",
          runStatus: "active",
          memberId,
          memberName,
          memberRole,
          kind,
          ...extra,
        });
        return {
          items: [
            row("coordinator", "Coordinator", "coordinator", "coordinator", {
              handle: "lead",
              startedAt: base - 7 * 60_000,
              sessionId: "lead-session",
              avatar: { outfit: "jacket", palette: 1, headwear: "flat-cap" },
            }),
            row("ui", "UI", "specialist", "worker", {
              handle: "ui",
              taskId: "task",
              taskTitle: "Build settings",
              startedAt: base - 3 * 60_000,
              sessionId: "ui-session",
              attention: "review",
              avatar: { outfit: "vest", palette: 3, headwear: "beret" },
            }),
            row("api", "API engineer", "specialist", "worker", {
              handle: "api",
              taskId: "task-api",
              taskTitle: "Contact endpoint",
              startedAt: base - 90_000,
              sessionId: "api-session",
              avatar: { outfit: "cardigan", palette: 2, headwear: "takke" },
            }),
          ],
        };
      }
      case "projects.list":
        return [
          { id: "project", cwd, name: "Fixture" },
          ...(params.has("longProjects")
            ? [
                {
                  id: "long-project",
                  cwd: "C:/fixture/projects/product-team/customer-experience/design-system/accessibility-review-and-implementation",
                  name: "Accessibility review",
                },
              ]
            : []),
        ];
      case "projects.createDirectory":
        return { path: `${String(p.path)}/${String(p.name)}` };
      case "projects.open":
        return { id: "created-project", cwd: String(p.cwd), name: "Created project" };
      case "models.list":
        if (params.has("catalogUnavailable"))
          throw new Error("Model catalog temporarily unavailable");
        return {
          models: {
            codex: [
              {
                id: "codex:fixture",
                harness: "codex",
                name: "Codex fixture",
                settings: [],
              },
              { id: "gpt-6-mini", harness: "codex", name: "GPT-6 mini", settings: [] },
              {
                id: "gpt-6-high-reasoning-extended",
                harness: "codex",
                name: "GPT-6 high reasoning extended",
                settings: [],
              },
            ],
            claude: [
              { id: "claude-haiku-5", harness: "claude", name: "Claude Haiku 5", settings: [] },
              { id: "claude-opus-5", harness: "claude", name: "Claude Opus 5", settings: [] },
            ],
          },
          errors: {},
        };
      case "crews.pools.list":
        return { pools: modelPools };
      case "crews.list":
        return { definitions, runs, agents };
      case "crews.schema":
        return {
          version: 1,
          hostTools: [
            { action: "files.read", write: false, summary: "Read a project file." },
            { action: "files.write", write: true, summary: "Write a project file." },
            { action: "files.search", write: false, summary: "Search project files by name." },
            { action: "git.status", write: false, summary: "Show the working tree status." },
            { action: "git.commit", write: true, summary: "Commit staged changes." },
            { action: "browser.open", write: true, summary: "Open a page in the Host browser." },
            { action: "browser.read", write: false, summary: "Read the open page." },
            { action: "images.generate", write: true, summary: "Generate an image." },
          ],
        };
      case "crews.save": {
        const input = p.definition as CrewDefinition;
        if (params.has("saveError"))
          throw new Error("The Host rejected this crew: storage is read-only right now.");
        const previous = definitions.find((d) => d.id === input.id);
        // Like the Host: an editor holding a deleted crew must not recreate it.
        if (!previous && p.expectedUpdatedAt !== undefined)
          throw new Error("This crew was deleted");
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
        agentSaveCounts[input.id] = (agentSaveCounts[input.id] ?? 0) + 1;
        if (params.has("groupRetry") && input.id === "lib-api" && !groupFailure) {
          groupFailure = true;
          throw new Error("Second profile unavailable. Retry group update.");
        }
        const previous = agents.find((a) => a.id === input.id);
        if (previous && previous.updatedAt !== p.expectedUpdatedAt)
          throw new Error("Agent changed. Reload before saving");
        const saved = { ...input, updatedAt: (previous?.updatedAt ?? 0) + 1 };
        agents = [...agents.filter((a) => a.id !== saved.id), saved];
        if (params.has("copyUnknown") && !previous && !copyFailure) {
          copyFailure = true;
          throw new Error("Profile save response unavailable");
        }
        return saved;
      }
      case "crews.agent.delete":
        agents = agents.filter((a) => a.id !== p.agentId);
        return { deleted: true };
      case "crews.delete":
        definitions = definitions.filter((d) => d.id !== p.definitionId);
        return { deleted: true };
      case "crews.start": {
        const requestId = String(p.requestId);
        startRequestIds.push(requestId);
        const existing = startReceipts.get(requestId);
        if (existing) return existing;
        starts += 1;
        document.querySelector("[aria-label='Started work']")!.textContent = String(starts);
        const receipt = {
          id: `run-${starts}`,
          coordinatorSessionId: `started-${starts}`,
        };
        startReceipts.set(requestId, receipt);
        if (params.has("startUnknownOnce") && starts === 1)
          throw new Error("Start response unavailable. Delivery unknown.");
        return receipt;
      }
      case "crews.pause":
        runs = runs.map((r) =>
          r.id === p.runId ? { ...r, status: "paused", updatedAt: r.updatedAt + 1 } : r,
        );
        return runs.find((run) => run.id === p.runId);
      case "crews.stop":
        runs = runs.map((r) =>
          r.id === p.runId
            ? {
                ...r,
                status: "paused",
                coordinatorStatus: "idle",
                updatedAt: r.updatedAt + 1,
              }
            : r,
        );
        return runs.find((run) => run.id === p.runId);
      case "crews.resume":
        runs = runs.map((r) =>
          r.id === p.runId ? { ...r, status: "active", updatedAt: r.updatedAt + 1 } : r,
        );
        return runs.find((run) => run.id === p.runId);
      case "crews.deleteRun": {
        const run = runs.find((run) => run.id === p.runId);
        if (!run || run.updatedAt !== p.expectedUpdatedAt)
          throw new Error("Crew work changed. Reload before deleting");
        if (run.status === "active") throw new Error("Stop work before deleting it");
        runs = runs.filter((r) => r.id !== p.runId);
        return { deleted: true };
      }
    }
  }
  if (command === "mcp_discover")
    return [
      { provider: "claude", name: "github", scope: "user", configPath: "", transport: "http" },
      { provider: "codex", name: "github", scope: "user", configPath: "", transport: "http" },
      { provider: "claude", name: "figma", scope: "user", configPath: "", transport: "http" },
    ];
  if (command === "list_skills")
    return [
      {
        name: "frontend-design",
        description: "Build polished interfaces.",
        path: "",
        scope: "user",
        source: "claude",
      },
      {
        name: "code-review",
        description: "Review a change for bugs.",
        path: "",
        scope: "user",
        source: "claude",
      },
    ];
  if (command.startsWith("plugin:")) return null;
  throw new Error(`Unsupported fixture operation ${command}`);
});
if (params.has("defaults")) runs = [];
// Another session saving the same crew while it is open here.
Object.assign(window, {
  crewFixtureStartRequestIds: startRequestIds,
  simulateRunFinish: (id: string) => {
    runs = runs.map((run) =>
      run.id === id ? { ...run, status: "finished", updatedAt: run.updatedAt + 1 } : run,
    );
  },
  simulateCrewDelete: () => {
    definitions = [];
  },
  crewFixtureSnapshot: () => ({
    definitions: definitions.map((crew) => crew.id),
    runs: runs.map((run) => ({ id: run.id, status: run.status })),
    agents: agents.map((agent) => ({ id: agent.id, groups: agent.groups })),
    agentSaveCounts,
  }),
  simulateRunUpdate: (id: string) => {
    const next = Math.max(...runs.map((run) => run.updatedAt)) + 1;
    runs = runs.map((run) => (run.id === id ? { ...run, updatedAt: next } : run));
  },
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
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [view, setView] = useState("sessions");
  useEffect(() => {
    const open = () => setView("page");
    window.addEventListener(OPEN_CREWS_PAGE_EVENT, open);
    return () => window.removeEventListener(OPEN_CREWS_PAGE_EVENT, open);
  }, []);
  const [opened, setOpened] = useState("");
  const [crew, setCrew] = useState<string | undefined>();
  const [valid, setValid] = useState(true);
  const openSession = (target: { sessionId: string }) => {
    if (params.has("openFailsOnce") && opens++ === 0)
      throw new Error("Conversation temporarily unavailable");
    setOpened(target.sessionId);
  };
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
            collapsed={railCollapsed}
            onToggleCollapsed={
              params.has("headingRegression")
                ? () => setRailCollapsed((current) => !current)
                : undefined
            }
            onOpenSession={openSession}
          />
        </aside>
        <aside className="w-80 max-w-full shrink-0 border-e border-(--ui-tone-neutral-border)">
          <CrewSidebar cwd={cwd} onOpen={openSession} onManagedChange={() => {}} />
        </aside>
        <div className="min-w-0 flex-1 p-4" style={{ flexBasis: "24rem" }}>
          <Button variant="ghost" onClick={() => setView("settings")}>
            Crew settings page
          </Button>
          <Button variant="ghost" onClick={() => setView("page")}>
            Crews page
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
          ) : view === "page" ? (
            <div className="flex h-[600px] min-w-0 flex-col border border-(--ui-pane-border)">
              <CrewsPage cwd={cwd} onOpenSession={openSession} />
            </div>
          ) : view === "settings" ? (
            <div className="bycoda-settings-content bycoda-settings-form">
              <CrewsSettings />
            </div>
          ) : null}
        </div>
      </main>
    </QueryProvider>
  );
}
createRoot(document.getElementById("root")!).render(
  params.has("shared-settings-fixture") ? (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <GenericAcpSettings cwd="/fixture" embedded />
      <ScanSettings
        client={
          {
            discovery: { settings: { get: async () => ({ extraPorts: [], extraFolders: [] }) } },
          } as never
        }
        onScan={async () => {}}
      />
    </main>
  ) : params.has("shared-static-fixture") ? (
    <main style={{ padding: 24, display: "flex", gap: 16, alignItems: "center" }}>
      <CrewFaces members={[...agents, { ...agents[0], id: "fixture-extra" }]} max={2} />
      <SourceKindIcon kind="api" />
      <AccountColorDot account={{ id: "fixture", provider: "codex", color: "orange" }} />
    </main>
  ) : (
    <Fixture />
  ),
);
