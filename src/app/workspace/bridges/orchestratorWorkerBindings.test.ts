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
const source = { baseCommit: "a".repeat(40), branchRef: "refs/heads/main", directory: "/repo" };
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
    source,
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
    baseCommit: source.baseCommit,
    baseRef: source.branchRef,
    targetBranchRef: source.branchRef,
    targetDirectory: source.directory,
    state: "finished",
    revision: 1,
    directoryState: "present",
  };
  m.request.mockImplementation(async (method) =>
    method === "workspaces.delivery.review"
      ? {
          blockers: [],
          commits: [],
          targetBranchRef: source.branchRef,
          targetDirectory: source.directory,
        }
      : managed,
  );
  m.listed.mockResolvedValue({
    worktrees: [
      { path: "/worker", head: "worker-commit" },
      { path: "/repo", head: source.baseCommit, branch: "main" },
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
      source,
    }),
    { cwd: "/repo" },
  );
  expect(prepared.workspace.source).toEqual(source);
});

it("pins the selected lead worktree instead of the project integration checkout", async () => {
  const selected = {
    baseCommit: "b".repeat(40),
    branchRef: "refs/heads/feature/lead",
    directory: "/lead",
  };
  m.sessions = [{ ...newSession("codex", "/repo"), id: "lead", worktreeCwd: "/lead" }];
  m.listed.mockResolvedValue({
    worktrees: [{ path: "/lead", head: selected.baseCommit, branch: "feature/lead" }],
  });
  m.request.mockResolvedValue({
    workspace: {
      ...managed,
      baseCommit: selected.baseCommit,
      baseRef: selected.branchRef,
      targetBranchRef: selected.branchRef,
      targetDirectory: selected.directory,
    },
  });
  const prepared = await bindings().createWorker!(
    { ...run, workspace: { projectCwd: "/repo", checkoutCwd: "/lead", branch: "feature/lead" } },
    {
      ...task,
      harness: "codex",
      model: "codex:test",
      workspace: undefined,
    },
  );
  expect(prepared.workspace.source).toEqual(selected);
  expect(m.request).toHaveBeenCalledWith(
    "workspaces.prepare",
    expect.objectContaining({ source: selected }),
    { cwd: "/repo" },
  );
});

it.each([
  { path: "/repo", head: source.baseCommit, branch: null },
  { path: "/repo", head: source.baseCommit, branch: "main", missing: true },
  { path: "/repo", head: "unresolved", branch: "main" },
  { path: "/another", head: source.baseCommit, branch: "main" },
])(
  "rejects an unresolved selected lead without preparing against integration (%j)",
  async (tree) => {
    m.sessions = [{ ...newSession("codex", "/repo"), id: "lead" }];
    m.listed.mockResolvedValue({ worktrees: [tree] });
    await expect(bindings().createWorker!(run, { ...task, workspace: undefined })).rejects.toThrow(
      "cannot be resolved",
    );
    expect(m.request).not.toHaveBeenCalled();
  },
);

it("resumes the retained worker from its immutable baseline when the lead has advanced", async () => {
  m.sessions = [{ ...newSession("codex", "/repo"), id: "lead" }];
  m.listed.mockResolvedValue({
    worktrees: [
      { path: "/worker", head: "c".repeat(40), branch: "bycoda/s/worker" },
      { path: "/repo", head: "d".repeat(40), branch: "main" },
    ],
  });
  const prepared = await bindings().createWorker!(run, {
    ...task,
    harness: "codex",
    model: "codex:test",
  });
  expect(prepared.workspace.source).toEqual(source);
  expect(m.request).not.toHaveBeenCalledWith(
    "workspaces.prepare",
    expect.anything(),
    expect.anything(),
  );
});

it.each([
  { baseCommit: "b".repeat(40) },
  { targetBranchRef: "refs/heads/integration" },
  { targetDirectory: "/integration" },
  { targetDirectory: undefined },
])("rejects a managed worker whose pinned base or target changed (%j)", async (changes) => {
  Object.assign(managed, { state: "merged" }, changes);
  await expect(bindings().integrateWorker!(run, task)).rejects.toThrow(
    "differs from its selected lead",
  );
  expect(m.request).not.toHaveBeenCalledWith(
    "workspaces.delivery.review",
    expect.anything(),
    expect.anything(),
  );
});

it("refuses acceptance when the delivery review identifies a different target", async () => {
  managed.state = "merged";
  m.request.mockImplementation(async (method) =>
    method === "workspaces.delivery.review"
      ? {
          blockers: [],
          commits: [],
          targetBranchRef: "refs/heads/integration",
          targetDirectory: "/integration",
        }
      : managed,
  );
  await expect(bindings().integrateWorker!(run, task)).rejects.toThrow(
    "did not enter the selected lead's target",
  );
});

it("retains old managed workers without a pinned target for explicit owner migration", async () => {
  await expect(
    bindings().integrateWorker!(run, {
      ...task,
      workspace: { ...task.workspace, source: undefined },
    }),
  ).rejects.toThrow("explicit owner migration");
});

it("rejects a lead target whose branch changed since selection", async () => {
  await expect(
    bindings().integrateWorker!(
      { ...run, workspace: { projectCwd: "/repo", checkoutCwd: "/repo", branch: "feature/lead" } },
      task,
    ),
  ).rejects.toThrow("target branch changed");
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
      ? {
          blockers: [],
          commits: ["new unapproved commit"],
          targetBranchRef: source.branchRef,
          targetDirectory: source.directory,
        }
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
