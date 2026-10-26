import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  request: vi.fn(),
  apply: vi.fn(),
  invoke: vi.fn(),
  listed: vi.fn(),
  sessions: [] as any[],
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: m.invoke }));
vi.mock("../../../features/sessions/data/sessionStore", () => ({
  upsertSession: vi.fn(),
  getSession: vi.fn(),
  flushSessionWrites: vi.fn(),
  shouldPersistSession: () => true,
}));
vi.mock("../../../features/sessions/model/sessionsStore", () => ({
  sessionsRef: {
    get current() {
      return m.sessions;
    },
    set current(value) {
      m.sessions = value;
    },
  },
  setSessions: vi.fn(),
}));
vi.mock("../../../features/source-control/model/worktrees", () => ({
  listWorktrees: m.listed,
  createOrchestrationWorktree: vi.fn(),
  orchestrationWorktreeBranchName: vi.fn(),
  removeOrchestrationWorktree: vi.fn(),
  detachSessionWorktree: vi.fn(),
}));
vi.mock("../../../features/workspaces/model/workspaceClient", () => ({
  workspaceRequest: m.request,
  resolveWorkspaceContext: vi.fn(async () => ({ projectId: "p", environmentId: "e" })),
  workspaceOperationKey: () => "operation",
}));
vi.mock("../../../integrations/harness", () => ({
  bindHarnessSession: vi.fn(),
  stopHarnessSession: vi.fn(),
  forgetHarnessSession: vi.fn(),
}));
vi.mock("../../../features/sessions/model/checkpoint", () => ({
  flushSessionCheckpoint: vi.fn(),
  applySessionCheckpoint: m.apply,
  sessionCheckpointCleanupSafe: vi.fn(),
  forgetSessionCheckpoint: vi.fn(),
  notifyReviewChanged: vi.fn(),
}));
import { newSession } from "../../../features/sessions/model/session";
import { createOrchestratorWorkerBindings } from "./orchestratorWorkerBindings";
const run = { leadId: "lead", cwd: "/repo" } as any;
const task = {
  id: "task",
  title: "Work",
  sessionId: "worker",
  workspace: {
    id: "checkout:/worker",
    projectCwd: "/repo",
    checkoutCwd: "/worker",
    kind: "worktree",
    branch: "bycoda/s/worker",
    managedWorkspaceId: "managed",
  },
} as any;
let managed: any;
beforeEach(() => {
  vi.clearAllMocks();
  m.sessions = [];
  managed = {
    id: "managed",
    owner: { kind: "session", id: "worker" },
    path: "/worker",
    branchRef: "refs/heads/bycoda/s/worker",
    state: "finished",
    revision: 1,
    directoryState: "present",
  };
  m.request.mockImplementation(async (method) =>
    method === "workspaces.delivery.review" ? { blockers: [], commits: [] } : managed,
  );
  m.listed.mockResolvedValue({
    worktrees: [
      { path: "/worker", head: "worker-commit" },
      { path: "/repo", head: "lead-commit" },
    ],
  });
});
const bindings = () =>
  createOrchestratorWorkerBindings({
    checkOpenWorktreeFiles: vi.fn(),
    onStop: vi.fn(),
    setHistory: vi.fn(),
    setStoredLinkedSessions: vi.fn(),
  });
it("retains a committed worker for owner delivery instead of accepting its checkpoint", async () => {
  await expect(bindings().integrateWorker!(run, task)).rejects.toThrow(
    "owner-approved managed delivery",
  );
  expect(m.apply).not.toHaveBeenCalled();
});
it("accepts a branch-backed result only after managed owner delivery despite different checkout HEADs", async () => {
  managed.state = "merged";
  await expect(bindings().integrateWorker!(run, task)).resolves.toMatchObject({
    files: [],
    alreadyApplied: 0,
  });
  expect(m.apply).not.toHaveBeenCalled();
  expect(m.request).toHaveBeenCalledWith(
    "workspaces.get",
    { workspaceId: "managed" },
    { cwd: "/repo" },
  );
});

it("creates new workers in managed session-owned branches and persists their registry identity", async () => {
  m.sessions = [{ ...newSession("codex", "/repo"), id: "lead" }];
  m.request.mockResolvedValue({
    workspace: { ...managed, projectId: "p", environmentId: "e", state: "idle" },
  });
  const prepared = await bindings().createWorker!(run, {
    ...task,
    harness: "codex",
    model: "codex:test",
    workspace: undefined,
  });
  expect(prepared.workspace.managedWorkspaceId).toBe("managed");
  expect(m.sessions.find((session) => session.id === "worker")).toMatchObject({
    workspaceId: "managed",
    worktreeCwd: "/worker",
    branch: "bycoda/s/worker",
  });
  expect(m.request).toHaveBeenCalledWith(
    "workspaces.prepare",
    expect.objectContaining({
      owner: { kind: "session", id: "worker" },
      choice: { defaultMode: "worktree" },
    }),
    { cwd: "/repo" },
  );
});
it("keeps unmerged managed branches and routes merged cleanup through the shared guarded lifecycle", async () => {
  expect(await bindings().cleanupWorker!(run, task, false)).toBe(false);
  expect(m.request).not.toHaveBeenCalledWith(
    "workspaces.cleanup.apply",
    expect.anything(),
    expect.anything(),
  );
  managed.state = "merged";
  m.request.mockImplementation(async (method) =>
    method === "workspaces.cleanup.plan" ? { token: "reviewed" } : managed,
  );
  expect(await bindings().cleanupWorker!(run, task, false)).toBe(true);
  expect(m.request).toHaveBeenCalledWith(
    "workspaces.cleanup.apply",
    {
      workspaceId: "managed",
      expectedRevision: 1,
      idempotencyKey: "operation",
      planToken: "reviewed",
    },
    { cwd: "/repo" },
  );
  expect(m.apply).not.toHaveBeenCalled();
});

it("rejects new commits after an earlier owner merge instead of trusting a stale merged state", async () => {
  managed.state = "merged";
  m.request.mockImplementation(async (method) =>
    method === "workspaces.delivery.review"
      ? { blockers: [], commits: ["new unapproved commit"] }
      : managed,
  );
  await expect(bindings().integrateWorker!(run, task)).rejects.toThrow("fresh owner review");
  expect(m.apply).not.toHaveBeenCalled();
});

it("retires an untouched cancelled managed worker while retaining any committed result", async () => {
  managed.baseCommit = "baseline";
  m.request.mockImplementation(async (method) =>
    method === "workspaces.cleanup.plan"
      ? { token: "safe", head: "worker-result", dirty: false, blockers: [] }
      : managed,
  );
  expect(await bindings().cleanupWorker!(run, task, true)).toBe(false);
  expect(m.request).not.toHaveBeenCalledWith(
    "workspaces.close",
    expect.anything(),
    expect.anything(),
  );
  m.request.mockImplementation(async (method) =>
    method === "workspaces.cleanup.plan"
      ? { token: "safe", head: "baseline", dirty: false, blockers: [] }
      : managed,
  );
  expect(await bindings().cleanupWorker!(run, task, true)).toBe(true);
  expect(m.request).toHaveBeenCalledWith(
    "workspaces.close",
    expect.objectContaining({ workspaceId: "managed", expectedRevision: 1 }),
    { cwd: "/repo" },
  );
});
