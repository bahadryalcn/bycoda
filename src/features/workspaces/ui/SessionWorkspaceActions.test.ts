// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getSessions, setSessions } from "../../sessions/model/sessionsStore";
import { newSession } from "../../sessions/model/session";
import type { ManagedWorkspace } from "../model/contracts";
import { getWorkspaceCapabilities, workspaceRequest } from "../model/workspaceClient";
import { SessionWorkspaceActions } from "./SessionWorkspaceActions";
import { notifyRemoteRecovered } from "../../connections/model/remoteHealth";
import { remotePath } from "../../connections/model/remoteProjects";

const connection = vi.hoisted(() => ({ status: "connected", reconnecting: false }));
vi.mock("../../connections/model/useRemoteConnection", () => ({
  useRemoteConnection: () => connection,
}));

vi.mock("../model/workspaceClient", () => ({
  getWorkspaceCapabilities: vi.fn(),
  workspaceRequest: vi.fn(),
  workspaceOperationKey: () => "operation",
  resolveWorkspaceContext: async () => ({
    projectId: "project",
    environmentId: "env",
    cwd: "/project",
    machineId: "host",
  }),
}));
vi.mock("../../sessions/data/sessionStore", () => ({
  shouldPersistSession: () => false,
  upsertSession: vi.fn(),
}));
const workspace: ManagedWorkspace = {
  id: "workspace",
  projectId: "project",
  repositoryId: "repo",
  environmentId: "env",
  owner: { kind: "session", id: "session" },
  path: "/worktrees/retained",
  branchRef: "refs/heads/bycoda/s/retained",
  baseRef: "refs/heads/main",
  baseCommit: "a".repeat(40),
  targetBranchRef: "refs/heads/main",
  state: "merged",
  directoryState: "removed",
  revision: 7,
  lastActivityAt: 1,
  pinned: false,
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  connection.status = "connected";
  connection.reconnecting = false;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(getWorkspaceCapabilities).mockResolvedValue([
    "workspaces.managed.v1",
    "workspaces.delivery.v1",
    "workspaces.lifecycle.v1",
  ]);
  vi.mocked(workspaceRequest).mockImplementation(
    async (method) => (method === "workspaces.list" ? [workspace] : workspace) as never,
  );
  setSessions([{ ...newSession("codex", "/project"), id: "session", worktreeCwd: workspace.path }]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  setSessions([]);
  container.remove();
  vi.unstubAllGlobals();
});

it("hydrates the retained managed identity and prevents sending into a removed directory after reload", async () => {
  await act(async () =>
    root.render(createElement(SessionWorkspaceActions, { sessionId: "session", cwd: "/project" })),
  );
  expect(getSessions()[0]).toMatchObject({
    workspaceId: "workspace",
    workspaceRevision: 7,
    worktreeRemoved: true,
    worktreeCwd: workspace.path,
  });
  expect(container.textContent).toContain("Resume");
});

it("reconciles a rematerialized directory without replacing the conversation", async () => {
  const blocks = getSessions()[0].blocks;
  vi.mocked(workspaceRequest).mockImplementation(
    async (method) =>
      (method === "workspaces.list"
        ? [{ ...workspace, directoryState: "present" }]
        : { ...workspace, directoryState: "present" }) as never,
  );
  setSessions((sessions) => sessions.map((session) => ({ ...session, worktreeRemoved: true })));
  await act(async () =>
    root.render(createElement(SessionWorkspaceActions, { sessionId: "session", cwd: "/project" })),
  );
  expect(getSessions()[0].worktreeRemoved).toBe(false);
  expect(getSessions()[0].blocks).toBe(blocks);
});

it("shows one workspace retry after a scoped load failure and recovers from it", async () => {
  vi.mocked(workspaceRequest).mockRejectedValueOnce(
    new Error("Path is outside this machine’s projects"),
  );
  await act(async () =>
    root.render(
      createElement(SessionWorkspaceActions, {
        sessionId: "session",
        cwd: "/project",
      }),
    ),
  );
  expect(container.textContent).toContain(
    "Path is outside this machine’s projects",
  );
  const retries = [...container.querySelectorAll("button")].filter(
    (button) => button.textContent === "Retry workspace",
  );
  expect(retries).toHaveLength(1);
  await act(async () => retries[0].click());
  expect(container.textContent).not.toContain("Retry workspace");
  expect(container.textContent).toContain("Resume");
});

it("leaves shared connection recovery to the conversation and reloads only for its machine", async () => {
  connection.status = "disconnected";
  vi.mocked(workspaceRequest).mockRejectedValue(
    new Error("Machine is unreachable"),
  );
  await act(async () =>
    root.render(
      createElement(SessionWorkspaceActions, {
        sessionId: "session",
        cwd: remotePath("env", "/project"),
      }),
    ),
  );
  expect(container.textContent).toBe("");
  const before = vi.mocked(workspaceRequest).mock.calls.length;
  await act(async () => notifyRemoteRecovered("another-machine"));
  expect(vi.mocked(workspaceRequest).mock.calls).toHaveLength(before);
  connection.status = "connected";
  vi.mocked(workspaceRequest).mockImplementation(async (method) =>
    (method === "workspaces.list" ? [workspace] : workspace) as never,
  );
  await act(async () => notifyRemoteRecovered("env"));
  expect(container.textContent).toContain("Resume");
});

it("shows loading state without an extra retry before the workspace result", async () => {
  let resolve!: (value: never) => void;
  vi.mocked(workspaceRequest).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(async () =>
    root.render(
      createElement(SessionWorkspaceActions, {
        sessionId: "session",
        cwd: "/project",
      }),
    ),
  );
  expect(container.querySelector('[role="status"]')).not.toBeNull();
  expect(container.textContent).not.toContain("Retry workspace");
  await act(async () => resolve([workspace] as never));
  expect(container.textContent).toContain("Resume");
});
