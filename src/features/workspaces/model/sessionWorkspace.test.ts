// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { newSession } from "../../sessions/model/session";
import type { ManagedWorkspace, WorkspacePolicy } from "./contracts";
import {
  isNewWorkspaceSession,
  needsSessionWorkspace,
  prepareSessionWorkspace,
} from "./sessionWorkspace";
import {
  getWorkspaceCapabilities,
  requireWorkspaceCapability,
  workspaceRequest,
} from "./workspaceClient";
import { clearConversation } from "../../sessions/model/clearConversation";

vi.mock("./workspaceClient", () => ({
  getWorkspaceCapabilities: vi.fn(async () => ["workspaces.policy.v1", "workspaces.managed.v1"]),
  resolveWorkspaceContext: vi.fn(async () => ({
    cwd: "/project",
    projectId: "project-id",
    environmentId: "environment",
    machineId: "machine",
  })),
  requireWorkspaceCapability: vi.fn(async () => {}),
  workspaceRequest: vi.fn(),
}));
const policy: WorkspacePolicy = {
  defaultMode: "worktree",
  integrationBranchRef: "refs/heads/main",
  pinned: false,
  root: null,
  retention: {
    active: "never",
    idle: "never",
    finished: "never",
    merged: "never",
    abandoned: "never",
  },
  disk: { budgetBytes: 100, minimumFreeBytes: 20, warningRatio: 0.8 },
};
const session = { ...newSession("codex", "/project"), id: "session-id" };
const workspace: ManagedWorkspace = {
  id: "managed-id",
  repositoryId: "repository",
  projectId: "project-id",
  environmentId: "environment",
  owner: { kind: "session", id: session.id },
  path: "/worktrees/wt-managed-id",
  branchRef: "refs/heads/bycoda/s/feature-managed-id",
  baseRef: "refs/heads/main",
  baseCommit: "baseline-sha",
  targetBranchRef: "refs/heads/main",
  state: "idle",
  directoryState: "present",
  revision: 1,
  lastActivityAt: 1,
  pinned: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getWorkspaceCapabilities).mockResolvedValue([
    "workspaces.policy.v1",
    "workspaces.managed.v1",
  ]);
  vi.mocked(requireWorkspaceCapability).mockResolvedValue(undefined);
  vi.mocked(workspaceRequest).mockImplementation(async (method) => {
    if (method === "projects.workspacePolicy.get")
      return { revision: 1, resolved: { policy, appliedScopes: ["host"] } } as never;
    if (method === "workspaces.prepare")
      return { workspace, operationId: "create-operation" } as never;
    throw new Error(`Unexpected method ${method}`);
  });
});

it("prepares a new session from project policy using authoritative IDs and a stable retry key", async () => {
  expect(isNewWorkspaceSession(session)).toBe(true);
  expect(needsSessionWorkspace(session)).toBe(true);
  await expect(prepareSessionWorkspace(session)).resolves.toEqual(workspace);
  await prepareSessionWorkspace(session);
  const requests = vi
    .mocked(workspaceRequest)
    .mock.calls.filter(([method]) => method === "workspaces.prepare");
  expect(requests).toHaveLength(2);
  expect(requests[0]?.[1]).toMatchObject({
    projectId: "project-id",
    environmentId: "environment",
    owner: { kind: "session", id: session.id },
    baseRef: "refs/heads/main",
  });
  expect(requests[1]?.[1]).toEqual(requests[0]?.[1]);
  expect(requests[0]?.[1]).not.toHaveProperty("choice");
});

it("keeps established conversations in their existing checkout", async () => {
  const old = {
    ...session,
    blocks: [{ id: "turn", role: "user" as const, text: "Existing conversation" }],
  };
  expect(needsSessionWorkspace(old)).toBe(false);
  await expect(prepareSessionWorkspace(old)).resolves.toBeNull();
  expect(workspaceRequest).not.toHaveBeenCalled();
});

it("retains a legacy current checkout after clear and persistence reload", async () => {
  const legacy = {
    ...session,
    blocks: [{ id: "turn", role: "user" as const, text: "Existing conversation" }],
  };
  expect(needsSessionWorkspace(legacy)).toBe(false);
  const cleared = JSON.parse(JSON.stringify(clearConversation(legacy)));
  expect(cleared.id).toBe(legacy.id);
  expect(cleared.blocks).toEqual([]);
  expect(cleared.workspaceMode).toBe("current");
  expect(needsSessionWorkspace(cleared)).toBe(false);
  await expect(prepareSessionWorkspace(cleared)).resolves.toBeNull();
  expect(workspaceRequest).not.toHaveBeenCalled();
});

it("preserves explicit worktree migration and a fresh blank session across clear", () => {
  expect(needsSessionWorkspace(clearConversation(session))).toBe(true);
  const migration = clearConversation({
    ...session,
    workspaceMode: "worktree",
    blocks: [{ id: "turn", role: "user" as const, text: "Existing conversation" }],
  });
  expect(migration.workspaceMode).toBe("worktree");
  expect(needsSessionWorkspace(migration)).toBe(true);
});

it("honors current-checkout policy and explicit worktree override without creating a fallback", async () => {
  vi.mocked(workspaceRequest).mockImplementation(async (method) =>
    method === "projects.workspacePolicy.get"
      ? ({
          revision: 1,
          resolved: { policy: { ...policy, defaultMode: "current" }, appliedScopes: ["project"] },
        } as never)
      : ({ workspace, operationId: "created" } as never),
  );
  await expect(prepareSessionWorkspace(session)).resolves.toBeNull();
  expect(
    vi.mocked(workspaceRequest).mock.calls.filter(([method]) => method === "workspaces.prepare"),
  ).toHaveLength(0);
  await expect(
    prepareSessionWorkspace({ ...session, workspaceMode: "worktree", worktreeBase: "release" }),
  ).resolves.toEqual(workspace);
  expect(workspaceRequest).toHaveBeenLastCalledWith(
    "workspaces.prepare",
    expect.objectContaining({ choice: { defaultMode: "worktree" }, baseRef: "release" }),
    expect.anything(),
  );
});

it("refuses an older Host before any workspace mutation", async () => {
  vi.mocked(requireWorkspaceCapability).mockRejectedValue(new Error("Update bycoda Host"));
  await expect(prepareSessionWorkspace(session)).rejects.toThrow("Update bycoda Host");
  expect(workspaceRequest).not.toHaveBeenCalled();
});

it("keeps preparation failures as errors and rejects a workspace belonging to another session", async () => {
  vi.mocked(workspaceRequest).mockImplementation(async (method) =>
    method === "projects.workspacePolicy.get"
      ? ({ revision: 1, resolved: { policy, appliedScopes: ["host"] } } as never)
      : ({
          workspace: { ...workspace, owner: { kind: "session", id: "another-session" } },
          operationId: "create",
        } as never),
  );
  await expect(prepareSessionWorkspace(session)).rejects.toThrow("preparation is incomplete");
});

it("does not create another workspace for an already managed session", async () => {
  await expect(
    prepareSessionWorkspace({ ...session, workspaceId: "managed-id" } as typeof session),
  ).resolves.toBeNull();
  expect(workspaceRequest).not.toHaveBeenCalled();
});

it("uses current by default when a known legacy Host has no policy capability", async () => {
  vi.mocked(getWorkspaceCapabilities).mockResolvedValue([]);
  await expect(prepareSessionWorkspace(session)).resolves.toBeNull();
  expect(requireWorkspaceCapability).not.toHaveBeenCalled();
  expect(workspaceRequest).not.toHaveBeenCalled();
});

it("rejects policy worktree before preparation if remote managed creation is unavailable", async () => {
  await expect(prepareSessionWorkspace(session, false)).rejects.toThrow(
    "Update bycoda to create managed sessions",
  );
  expect(
    vi.mocked(workspaceRequest).mock.calls.some(([method]) => method === "workspaces.prepare"),
  ).toBe(false);
});
