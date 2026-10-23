// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import { rememberRemoteProject } from "../../features/connections/model/remoteProjects";
import { refreshRemoteProjectSessions } from "../../features/connections/model/connections";
import { resetRemoteHealth } from "../../features/connections/model/remoteHealth";
import type { HostSessionSummary } from "../../features/connections/model/protocol";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));
vi.mock("../../features/source-control/hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: () => null,
}));
vi.mock("../../features/source-control/hooks/useGitFileStatuses", () => ({
  useGitFileStatuses: () => ({ files: new Map(), dirs: new Map() }),
}));
vi.mock("./SidebarUpdate", () => ({ SidebarUpdateFooter: () => null }));
vi.mock("../../features/files/ui/FileTree", () => ({ FileTree: () => null }));

let container: HTMLDivElement;
let root: Root;
let props: ComponentProps<typeof Sidebar>;
let hostSessions: HostSessionSummary[];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  resetRemoteHealth();
  refreshRemoteProjectSessions();
  hostSessions = [];
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command, args) => {
      if (command === "remote_machines")
        return [
          {
            id: "host",
            name: "Host",
            endpoint: "ssh://me@host",
            environmentId: "env-host",
            ssh: { target: "me@host", port: null, remotePort: 3774 },
          },
        ];
      if (command === "remote_request" && (args as { method?: string })?.method === "sessions.list")
        return hostSessions;
      return undefined;
    });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  props = {
    cwd: "/workspace/project",
    open: true,
    sessions: [],
    busySessionIds: new Set(),
    approvalSessionIds: new Set(),
    status: "idle",
    pending: false,
    tab: "sessions",
    filesSearchOpen: false,
    onSelectSession: vi.fn(),
    onRenameSession: vi.fn(),
    onOpenFile: vi.fn(),
    onTabChange: vi.fn(),
    onFilesSearchOpenChange: vi.fn(),
    onSelectProject: vi.fn(),
    onOpenProject: vi.fn(),
  };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(createElement(Sidebar, props)));
  await act(async () => {});
}

it("keeps Servers reachable in the compact rail before opening a project", async () => {
  props.cwd = "";
  props.projectRailOpen = false;
  props.compactProjectRail = true;
  props.onOpenServers = vi.fn();
  props.serversActive = true;
  await render();
  const button = container.querySelector<HTMLButtonElement>('button[aria-label="Servers"]')!;
  expect(button).not.toBeNull();
  await act(async () => button.click());
  expect(props.onOpenServers).toHaveBeenCalledOnce();
  expect(props.onSelectProject).not.toHaveBeenCalled();
});

it("keeps Explorer and Changes reachable from the workspace beside a compact rail", async () => {
  props.projectRailOpen = false;
  props.compactProjectRail = true;
  await render();
  const pane = container.querySelector('[data-side-pane="workspace"]')!;
  for (const label of ["Explorer", "Changes"]) {
    const button = pane.querySelector<HTMLButtonElement>(`[role="tab"][aria-label="${label}"]`)!;
    expect(button).not.toBeNull();
    act(() => button.click());
  }
  expect(props.onTabChange).toHaveBeenCalledWith("files");
  expect(props.onTabChange).toHaveBeenCalledWith("changes");
});

function badge() {
  return container.querySelector("[data-workspace-working-count]");
}

it("collapses and reopens Working in the workspace when the project rail is closed", async () => {
  props.projectRailOpen = false;
  props.onSelectAgent = vi.fn();
  props.liveAgents = [
    {
      id: "background",
      cwd: props.cwd,
      title: "Background work",
      harness: "codex",
      activity: "Working",
      needsApproval: false,
      done: false,
    },
  ];
  await render();
  const preview = container.querySelector('[data-live-agents-preview="full"]')!;
  const header = preview.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
  const card = preview.querySelector<HTMLButtonElement>('[data-live-agent-card="background"]')!;
  expect(header.getAttribute("aria-expanded")).toBe("true");
  act(() => header.click());
  expect(header.getAttribute("aria-expanded")).toBe("false");
  expect(card.closest("[hidden]")).not.toBeNull();
  expect(header.textContent).toContain("1");
  expect(props.onSelectAgent).not.toHaveBeenCalled();
  act(() => header.click());
  expect(header.getAttribute("aria-expanded")).toBe("true");
  expect(card.closest("[hidden]")).toBeNull();
  act(() => card.click());
  expect(props.onSelectAgent).toHaveBeenCalledExactlyOnceWith("background");
});

it("counts each working conversation once in this workspace and clears on completion", async () => {
  const session = (id: string, cwd = props.cwd) => ({
    id,
    cwd,
    harness: "codex" as const,
    model: "",
    runtimeMode: "supervised" as const,
    title: id,
    createdAt: 1,
    updatedAt: 1,
  });
  props.sessions = [
    session("first"),
    session("second"),
    session("waiting"),
    session("other", "/other"),
  ];
  props.openSessions = [session("first"), session("new")];
  props.busySessionIds = new Set(["first", "second", "waiting", "other", "new"]);
  props.approvalSessionIds = new Set(["waiting"]);
  await render();
  expect(badge()?.getAttribute("aria-label")).toMatch(/^3 working session/);
    expect(badge()?.closest('[role="tab"]')?.textContent).toContain("Sessions");
  expect(container.querySelectorAll("[data-workspace-working-count]")).toHaveLength(1);

  props.busySessionIds = new Set(["first"]);
  await render();
  expect(badge()?.getAttribute("aria-label")).toMatch(/^1 working session/);
  props.busySessionIds = new Set();
  await render();
  expect(badge()).toBeNull();
});

it.each([true, false])(
  "keeps the count visible when the workspace header is collapsed (compact: %s)",
  async (compact) => {
    props.projectRailOpen = false;
    props.compactProjectRail = compact;
    props.sessions = [
      {
        id: "first",
        cwd: props.cwd,
        harness: "codex",
        model: "",
        runtimeMode: "supervised",
        title: "First",
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    props.busySessionIds = new Set(["first"]);
    await render();
    const tab = badge()?.closest('[role="tab"]');
    expect(compact ? tab?.getAttribute("aria-label") : tab?.textContent).toContain("Sessions");
    expect(badge()?.getAttribute("aria-label")).toMatch(/^1 working session/);
  },
);

it("prioritizes input and failures ahead of working remote sessions", async () => {
  const project = rememberRemoteProject("env-host", {
    id: "p1",
    cwd: "/srv/project",
    name: "project",
  });
  props.cwd = project.key;
  hostSessions = [
    { id: "history", status: "idle", updatedAt: 100 },
    { id: "working", status: "running", updatedAt: 90 },
    { id: "failed", status: "idle", updatedAt: 80, issue: "failed" },
    { id: "input", status: "running", updatedAt: 70, needsInput: true },
  ].map((session) => ({
    projectId: "p1",
    revision: 1,
    harness: "codex",
    title: session.id,
    ...session,
  })) as HostSessionSummary[];
  await render();
  expect(
    [...container.querySelectorAll<HTMLElement>("[data-session-card]")].map(
      (element) => element.dataset.sessionCard,
    ),
  ).toEqual(["input", "failed", "working", "history"]);
});

it("counts host work without opening its sessions and updates when it finishes", async () => {
  const project = rememberRemoteProject("env-host", {
    id: "p1",
    cwd: "/srv/project",
    name: "project",
  });
  props.cwd = project.key;
  hostSessions = [
    {
      id: "one",
      projectId: "p1",
      revision: 1,
      status: "running",
      updatedAt: 1,
      title: "One",
      harness: "codex",
    },
    {
      id: "two",
      projectId: "p1",
      revision: 1,
      status: "running",
      updatedAt: 1,
      title: "Two",
      harness: "codex",
    },
    {
      id: "input",
      projectId: "p1",
      revision: 1,
      status: "running",
      needsInput: true,
      updatedAt: 1,
      title: "Input",
      harness: "codex",
    },
  ];
  await render();
  expect(badge()?.getAttribute("aria-label")).toMatch(/^2 working session/);
  hostSessions = hostSessions.map((session) => ({
    ...session,
    status: "idle",
  }));
  await act(async () => refreshRemoteProjectSessions());
  await act(async () => {});
  expect(badge()).toBeNull();
});

it("shows the same turn clock in Working and Sessions, then removes it when work ends", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(200_000);
  try {
    props.projectRailOpen = false;
    props.sessions = [
      {
        id: "timed",
        cwd: props.cwd,
        harness: "codex",
        model: "",
        runtimeMode: "supervised",
        title: "Timed work",
        createdAt: 1,
        updatedAt: 199_000,
      },
    ];
    props.busySessionIds = new Set(["timed"]);
    props.liveAgents = [
      {
        id: "timed",
        cwd: props.cwd,
        title: "Timed work",
        harness: "codex",
        activity: "Working",
        needsApproval: false,
        done: false,
        startedAt: 10_000,
      },
    ];
    await render();
    const rail = () =>
      container.querySelector('[data-live-agent-card="timed"] [data-session-working-status]');
    const card = () =>
      container.querySelector('[data-session-card="timed"] [data-session-working-status]');
    expect(rail()?.textContent).toContain("3m 10s");
    expect(card()?.textContent).toBe(rail()?.textContent);
    act(() => vi.advanceTimersByTime(1000));
    expect(card()?.textContent).toContain("3m 11s");
    expect(card()?.textContent).toBe(rail()?.textContent);
    props.busySessionIds = new Set();
    props.liveAgents = [];
    await render();
    expect(card()).toBeNull();
  } finally {
    act(() => root.render(null));
    vi.useRealTimers();
  }
});
