// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getSessions, setSessions } from "../../sessions/model/sessionsStore";
import { newSession } from "../../sessions/model/session";
import type { ManagedWorkspace } from "../model/contracts";
import { getWorkspaceCapabilities, workspaceRequest } from "../model/workspaceClient";
import { SessionWorkspaceActions } from "./SessionWorkspaceActions";

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
