// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import { rememberRemoteProject } from "../../features/connections/model/remoteProjects";
import { refreshRemoteProjectSessions } from "../../features/connections/model/connections";
import { LOADING_DELAY_MS } from "../../shared/hooks/useDelayedVisible";
import {
  setWorktreeFocus,
  type WorktreeFocus,
} from "../../features/source-control/model/worktreeFocus";
import type { Worktrees } from "../../features/source-control/model/worktrees";
import {
  recordRemoteConnection,
  resetRemoteHealth,
} from "../../features/connections/model/remoteHealth";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));
vi.mock("../../features/source-control/hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: vi.fn(() => null),
  useProjectsDiffStats: vi.fn(() => []),
}));
vi.mock("../../features/source-control/hooks/useProjectWorktrees", () => ({
  useProjectWorktrees: () => ({ data: worktrees.data, refresh: async () => false }),
}));
vi.mock("../../features/source-control/hooks/useGitFileStatuses", () => ({
  useGitFileStatuses: () => ({ files: new Map(), dirs: new Map() }),
}));
vi.mock("./SidebarUpdate", () => ({ SidebarUpdateFooter: () => null }));
vi.mock("../../features/files/ui/FileTree", () => ({ FileTree: () => null }));
vi.mock("../../features/crews/ui/CrewSessions", () => ({ CrewSidebar: () => "Crew work" }));

let container: HTMLDivElement;
let root: Root;
let answer: (value: unknown) => void;
let refuse: (reason: unknown) => void;
const worktrees = vi.hoisted(() => ({ data: undefined as Worktrees | undefined }));

const machine = {
  id: "mac",
  name: "MacBook",
  endpoint: "ssh://me@mac",
  environmentId: "env-mac",
  ssh: { target: "me@mac", port: null, remotePort: 3774 },
};

beforeEach(() => {
  worktrees.data = undefined;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  resetRemoteHealth();
  refreshRemoteProjectSessions();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "remote_machines") return [machine];
    const method = (args as { method?: string } | undefined)?.method;
    // A cold SSH machine is discovered once before its first list read; the Host answers that at once.
    if (command === "remote_request" && method === "environment.describe")
      return { capabilities: [] };
    if (command === "remote_request" && method === "sessions.list")
      return new Promise((resolve, reject) => {
        answer = resolve;
        refuse = reject;
      });
    return undefined;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function renderRemoteProject(environmentId = "env-mac", extra: object = {}) {
  const project = rememberRemoteProject(environmentId, {
    id: "p1",
    cwd: "/Users/me/shop",
    name: "shop",
  });
  const props = {
    cwd: project.key,
    open: true,
    sessions: [],
    busySessionIds: new Set<string>(),
    approvalSessionIds: new Set<string>(),
    status: "idle",
    pending: false,
    tab: "sessions",
    filesSearchOpen: false,
    onSelectSession: vi.fn(),
    onRenameSession: vi.fn(),
    onOpenFile: vi.fn(),
    onTabChange: vi.fn(),
    onFilesSearchOpenChange: vi.fn(),
    ...extra,
  } as unknown as ComponentProps<typeof Sidebar>;
  await act(async () => root.render(createElement(Sidebar, props)));
  await act(async () => {});
}

it("shows one short line for an orphaned project, leaving the explanation to the session pane", async () => {
  await renderRemoteProject("previous-host-identity", { onOpenCrewSession: vi.fn() });
  // Crews read through the same machine; their failure would repeat the notice in red.
  expect(document.body.textContent).not.toContain("Crew");
  // The list shows the one shared notice for a machine this computer does not have, not a
  // second load status beside it, and no reason or button the page already has.
  const notice = container.querySelector('[data-machine-unavailable="not-added"]');
  expect(notice?.textContent).toContain("isn’t available");
  expect(notice?.textContent).not.toContain("Add it in Connections");
  expect(notice?.querySelector('[role="img"][aria-label="Help"]')).not.toBeNull();
  expect(notice?.querySelector("button")).toBeNull();
  expect(document.body.textContent).not.toContain("Can’t reach this machine");
  expect(document.body.textContent).not.toContain("Loading sessions");
});

it("says it is loading a remote project's sessions until they arrive", async () => {
  await renderRemoteProject();
  // Passive loaders stay hidden for LOADING_DELAY_MS so a quick load never flashes one.
  expect(document.body.textContent).not.toContain("Loading sessions");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, LOADING_DELAY_MS + 100));
  });
  expect(document.body.textContent).toContain("Loading sessions from MacBook…");
  expect(document.body.textContent).not.toContain("isn’t connected");
  // The cold SSH route is discovered once, and only then is the first list read sent.
  const methods = vi
    .mocked(invoke)
    .mock.calls.filter(([command]) => command === "remote_request")
    .map(([, args]) => (args as { method: string }).method);
  expect(methods.indexOf("environment.describe")).toBeGreaterThanOrEqual(0);
  expect(methods.indexOf("environment.describe")).toBeLessThan(methods.indexOf("sessions.list"));

  await act(async () =>
    answer([
      {
        id: "s1",
        projectId: "p1",
        revision: 1,
        status: "idle",
        updatedAt: Date.now(),
        title: "Fix the build",
        harness: "claude",
      },
    ]),
  );
  await act(async () => {});
  expect(document.body.textContent).not.toContain("Loading sessions");
  expect(document.body.textContent).toContain("Fix the build");
});

it("says the machine did not answer instead of loading forever", async () => {
  await renderRemoteProject();
  await act(async () => refuse(new Error("ssh: connect timed out")));
  await act(async () => {});
  expect(document.body.textContent).not.toContain("Loading sessions");
  expect(document.body.textContent).toContain("Couldn’t refresh sessions from MacBook");
  expect(document.body.textContent).toContain("ssh: connect timed out");
  expect(document.body.querySelector('[data-remote-data-state="error"]')).not.toBeNull();
});

const freshSession = {
  id: "s1",
  projectId: "p1",
  revision: 1,
  status: "idle",
  updatedAt: 1,
  title: "Current conversation",
  harness: "claude",
};

it("refreshes within the cache TTL, retains rows on failure and retries to a verified empty list", async () => {
  await renderRemoteProject();
  await act(async () => answer([freshSession]));
  expect(document.body.querySelector('[data-remote-data-state="ready"]')).not.toBeNull();
  const refreshButton = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Refresh sessions from MacBook"]',
  )!;
  await act(async () => refreshButton.click());
  expect(document.body.querySelector('[data-remote-data-state="refreshing"]')).not.toBeNull();
  expect(document.body.textContent).toContain("Current conversation");
  expect(refreshButton.disabled).toBe(true);
  await act(async () => refuse(new Error("permission denied reading sessions")));
  expect(document.body.querySelector('[data-remote-data-state="error"]')).not.toBeNull();
  expect(document.body.textContent).toContain("Showing last loaded data");
  expect(document.body.textContent).toContain("Current conversation");
  await act(async () =>
    document.body
      .querySelector<HTMLButtonElement>('button[aria-label="Retry loading sessions from MacBook"]')!
      .click(),
  );
  await act(async () => answer([]));
  expect(document.body.querySelector('[data-remote-data-state="empty"]')).not.toBeNull();
  expect(document.body.textContent).not.toContain("Current conversation");
  expect(document.body.textContent).not.toContain("permission denied");
});

it("retains cached sessions without repeating the shared connection warning", async () => {
  const project = rememberRemoteProject("env-mac", {
    id: "p1",
    cwd: "/Users/me/shop",
    name: "shop",
  });
  localStorage.setItem(`bycoda.remote-history.v2:${project.key}`, JSON.stringify([freshSession]));
  await renderRemoteProject();
  await act(async () =>
    refuse(new Error("SSH connection failed (exit 255, host unreachable): connection timed out")),
  );
  expect(document.body.textContent).toContain("Current conversation");
  expect(container.querySelector("[data-workspace-header] .lucide-server")).not.toBeNull();
  expect(document.body.querySelector('[role="alert"]')).toBeNull();
  expect(document.body.textContent).not.toContain("connection timed out");
  expect(document.body.textContent).not.toContain("Couldn’t refresh sessions");
});

it("labels cached rows as unverified while the initial owner read is pending", async () => {
  const project = rememberRemoteProject("env-mac", {
    id: "p1",
    cwd: "/Users/me/shop",
    name: "shop",
  });
  localStorage.setItem(`bycoda.remote-history.v2:${project.key}`, JSON.stringify([freshSession]));
  await renderRemoteProject();
  expect(document.body.textContent).toContain("Current conversation");
  expect(document.body.querySelector('[data-remote-data-state="refreshing"]')).not.toBeNull();
  expect(document.body.textContent).toContain("Showing last loaded data");
  await act(async () => answer([freshSession]));
  expect(document.body.querySelector('[data-remote-data-state="ready"]')).not.toBeNull();
});

it("keeps the loaded session list when the machine goes offline", async () => {
  await renderRemoteProject();
  await act(async () => answer([freshSession]));
  expect(document.body.textContent).toContain("Current conversation");

  await act(async () => recordRemoteConnection("env-mac", new Error("Machine is unreachable")));

  expect(document.body.textContent).toContain("Current conversation");
  expect(container.querySelector("[data-machine-unavailable]")).toBeNull();
});

// The list kept its last "ready" state while the machine was offline: rows stayed undimmed,
// no notice said they were stale, and its poller kept asking the machine.
it("dims a retained session list, says the machine is unreachable and stops reading it", async () => {
  await renderRemoteProject();
  await act(async () => answer([freshSession]));

  // From now on the machine does not answer, so its reconnect attempts keep it offline.
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "remote_machines") return [machine];
    throw new Error("Machine is unreachable");
  });
  vi.mocked(invoke).mockClear();
  await act(async () => recordRemoteConnection("env-mac", new Error("Machine is unreachable")));
  // The fallback poller asks every three seconds in the foreground.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 3_500)));

  expect(document.body.textContent).toContain("Current conversation");
  expect(document.body.textContent).toContain("Can’t reach MacBook");
  expect(container.querySelector("[data-session-list-panel] .opacity-60")).not.toBeNull();
  const reads = vi
    .mocked(invoke)
    .mock.calls.filter(([, args]) => (args as { method?: string })?.method === "sessions.list");
  expect(reads).toEqual([]);
});

it("waits before showing the shared notice for an offline machine with no cached list", async () => {
  vi.useFakeTimers();
  try {
    // Every request to the machine fails, so nothing marks it connected while the list opens.
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "remote_machines") return [machine];
      throw new Error("Machine is unreachable");
    });
    recordRemoteConnection("env-mac", new Error("Machine is unreachable"));
    await renderRemoteProject();
    expect(container.querySelector('[data-machine-unavailable="offline"]')).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    expect(container.querySelector('[data-machine-unavailable="offline"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("Loading sessions");
  } finally {
    vi.useRealTimers();
  }
});

it("replaces a cached session list when the machine refuses this computer", async () => {
  await renderRemoteProject();
  await act(async () => answer([freshSession]));
  await act(async () =>
    recordRemoteConnection("env-mac", "Host rejected request [RPC_AUTHORIZATION] (401)"),
  );

  expect(document.body.textContent).not.toContain("Current conversation");
  expect(container.querySelector('[data-machine-unavailable="pairing-refused"]')).not.toBeNull();
});

it("puts the server control before the shared project and worktree picker", async () => {
  const project = "remote://env-mac/Users/me/shop";
  const main = { path: project, branch: "main" };
  worktrees.data = {
    defaultRoot: project,
    worktrees: [main, { path: "remote://env-mac/Users/me/shop-feature", branch: "feature" }].map(
      (tree) => ({
        ...tree,
        head: "abc",
        isMain: tree === main,
        locked: false,
        missing: false,
        prunable: false,
        dirty: null,
        unpushed: null,
        sessionIds: [],
      }),
    ),
  };
  const onSelectWorkspace = vi.fn((focus?: WorktreeFocus) => setWorktreeFocus(project, focus));
  try {
    await renderRemoteProject("env-mac", { onSelectWorkspace });
    const server = container.querySelector('button[aria-label="Refresh sessions from MacBook"]')!;
    const picker = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Switch worktree"]',
    )!;
    expect(picker).not.toBeNull();
    expect(server.compareDocumentPosition(picker)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(picker.textContent).toContain("All worktrees");
    await act(async () => picker.click());
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((row) =>
      row.textContent?.includes("main"),
    )!;
    await act(async () => option.click());
    expect(onSelectWorkspace).toHaveBeenCalledWith(main);
    expect(picker.textContent).toContain("main");
  } finally {
    await act(async () => setWorktreeFocus(project, undefined));
  }
});
