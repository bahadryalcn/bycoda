// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import { rememberRemoteProject } from "../../features/connections/model/remoteProjects";
import { refreshRemoteProjectSessions } from "../../features/connections/model/connections";
import { resetRemoteHealth } from "../../features/connections/model/remoteHealth";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));
vi.mock("../../features/source-control/hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: vi.fn(() => null),
}));
vi.mock("../../features/source-control/hooks/useGitFileStatuses", () => ({
  useGitFileStatuses: () => ({ files: new Map(), dirs: new Map() }),
}));
vi.mock("./SidebarUpdate", () => ({ SidebarUpdateFooter: () => null }));
vi.mock("../../features/files/ui/FileTree", () => ({ FileTree: () => null }));

let container: HTMLDivElement;
let root: Root;
let answer: (value: unknown) => void;
let refuse: (reason: unknown) => void;

const machine = {
  id: "mac",
  name: "MacBook",
  endpoint: "ssh://me@mac",
  environmentId: "env-mac",
  ssh: { target: "me@mac", port: null, remotePort: 3774 },
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  resetRemoteHealth();
  refreshRemoteProjectSessions();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "remote_machines") return [machine];
    const method = (args as { method?: string } | undefined)?.method;
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

async function renderRemoteProject(environmentId = "env-mac") {
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
  } as unknown as ComponentProps<typeof Sidebar>;
  await act(async () => root.render(createElement(Sidebar, props)));
  await act(async () => {});
}

it("explains an orphaned project's connection and offers machine settings", async () => {
  await renderRemoteProject("previous-host-identity");
  expect(container.textContent).toContain("Can’t reach this machine");
  expect(container.textContent).toContain("Connect this project’s machine to load its sessions.");
  expect(container.textContent).not.toContain("Loading sessions");
  const settings = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Connection settings",
  );
  expect(settings).toBeDefined();
  const opened = vi.fn();
  window.addEventListener("bycoda:open-connections", opened);
  try {
    await act(async () => settings!.click());
    expect(opened).toHaveBeenCalledTimes(1);
  } finally {
    window.removeEventListener("bycoda:open-connections", opened);
  }
});

it("says it is loading a remote project's sessions until they arrive", async () => {
  await renderRemoteProject();
  expect(container.textContent).toContain("Loading sessions from MacBook…");
  expect(container.textContent).not.toContain("isn’t connected");

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
  expect(container.textContent).not.toContain("Loading sessions");
  expect(container.textContent).toContain("Fix the build");
});

it("says the machine did not answer instead of loading forever", async () => {
  await renderRemoteProject();
  await act(async () => refuse(new Error("ssh: connect timed out")));
  await act(async () => {});
  expect(container.textContent).not.toContain("Loading sessions");
  expect(container.textContent).toContain("Couldn’t refresh sessions from MacBook");
  expect(container.textContent).toContain("ssh: connect timed out");
  expect(container.querySelector('[data-remote-data-state="error"]')).not.toBeNull();
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
  expect(container.querySelector('[data-remote-data-state="ready"]')).not.toBeNull();
  const refreshButton = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Refresh sessions from MacBook"]',
  )!;
  await act(async () => refreshButton.click());
  expect(container.querySelector('[data-remote-data-state="refreshing"]')).not.toBeNull();
  expect(container.textContent).toContain("Current conversation");
  expect(refreshButton.disabled).toBe(true);
  await act(async () => refuse(new Error("permission denied reading sessions")));
  expect(container.querySelector('[data-remote-data-state="error"]')).not.toBeNull();
  expect(container.textContent).toContain("Showing last loaded data");
  expect(container.textContent).toContain("Current conversation");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Retry loading sessions from MacBook"]')!
      .click(),
  );
  await act(async () => answer([]));
  expect(container.querySelector('[data-remote-data-state="empty"]')).not.toBeNull();
  expect(container.textContent).not.toContain("Current conversation");
  expect(container.textContent).not.toContain("permission denied");
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
  expect(container.textContent).toContain("Current conversation");
  expect(container.querySelector("[data-remote-data-state]")).toBeNull();
  expect(container.textContent).not.toContain("connection timed out");
  expect(container.textContent).not.toContain("Couldn’t refresh sessions");
});

it("labels cached rows as unverified while the initial owner read is pending", async () => {
  const project = rememberRemoteProject("env-mac", {
    id: "p1",
    cwd: "/Users/me/shop",
    name: "shop",
  });
  localStorage.setItem(`bycoda.remote-history.v2:${project.key}`, JSON.stringify([freshSession]));
  await renderRemoteProject();
  expect(container.textContent).toContain("Current conversation");
  expect(container.querySelector('[data-remote-data-state="refreshing"]')).not.toBeNull();
  expect(container.textContent).toContain("Showing last loaded data");
  await act(async () => answer([freshSession]));
  expect(container.querySelector('[data-remote-data-state="ready"]')).not.toBeNull();
});
