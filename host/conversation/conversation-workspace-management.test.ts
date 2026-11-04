import { expect, it, vi } from "vitest";
import type { ManagedWorkspace, WorkspaceOperation } from "../workspace-contracts";
import {
  dispatchWorkspaceManagement,
  WORKSPACE_MANAGEMENT_TOOLS,
  type WorkspaceManagementPorts,
} from "./conversation-workspace-management";

function setup() {
  const workspace = {
    id: "work",
    projectId: "project",
    environmentId: "machine",
    revision: 3,
    owner: { kind: "session", id: "owner" },
  } as ManagedWorkspace;
  const ports = {
    environmentId: "machine",
    ownerProject: vi.fn(async () => "project"),
    workspace: vi.fn(async () => workspace),
    assertWritable: vi.fn(async () => {}),
    registry: { prepare: vi.fn(async () => ({ workspace, operationId: "create" })) },
    featureClaims: {
      acquire: vi.fn(async () => ({ acquired: false, conflicts: [{ id: "other" }] })),
      release: vi.fn(async () => ({ released: true })),
    },
    removal: {
      plan: vi.fn(async () => ({ blockers: ["Unknown activity"], token: "review", links: [] })),
      status: vi.fn(async () => ({ workspace, operations: [] as WorkspaceOperation[] })),
    },
    delivery: {
      review: vi.fn(async () => ({ token: "review", blockers: [], changedPaths: [] as string[] })),
    },
    reviewTaskDelivery: vi.fn(async () => ({
      token: "task-review",
      blockers: ["Task approval required"],
    })),
  };
  const principal = {
    kind: "assistant-thread" as const,
    threadId: "voice",
    projectId: "project",
    provider: "assistant" as const,
  };
  const authorized = vi.fn(async () => true);
  const call = (action: keyof typeof WORKSPACE_MANAGEMENT_TOOLS, input: Record<string, unknown>) =>
    dispatchWorkspaceManagement(
      action,
      input,
      principal,
      authorized,
      ports as unknown as WorkspaceManagementPorts,
    );
  return { workspace, ports, authorized, call };
}

it("prepares only an explicit worktree for an existing project owner without accepting project or machine overrides", async () => {
  const { ports, call } = setup();
  const input = {
    requestId: "create",
    owner: { kind: "session", id: "owner" },
    slug: "voice",
    mode: "worktree",
  };
  await call("workspaces.prepare", input);
  expect(ports.registry.prepare).toHaveBeenCalledExactlyOnceWith({
    idempotencyKey: "create",
    owner: input.owner,
    slug: "voice",
    choice: { defaultMode: "worktree" },
    projectId: "project",
    environmentId: "machine",
  });
  await expect(call("workspaces.prepare", { ...input, projectId: "other" })).rejects.toThrow();
  await expect(call("workspaces.prepare", { ...input, mode: "current" })).rejects.toThrow();
  ports.ownerProject.mockResolvedValue("other");
  await expect(call("workspaces.prepare", input)).rejects.toThrow("owner does not belong");
  expect(ports.registry.prepare).toHaveBeenCalledOnce();
});

it.each(["project", "machine", "revision", "revoked"])(
  "rejects changed %s before feature mutation",
  async (field) => {
    const { workspace, ports, authorized, call } = setup();
    if (field === "project") workspace.projectId = "foreign";
    if (field === "machine") workspace.environmentId = "foreign";
    if (field === "revision") workspace.revision++;
    if (field === "revoked")
      ports.workspace.mockImplementation(async () => {
        authorized.mockResolvedValue(false);
        return workspace;
      });
    await expect(
      call("workspaces.featureClaims.acquire", {
        workspaceId: "work",
        expectedRevision: 3,
        requestId: "claim",
        featureKey: "voice",
      }),
    ).rejects.toThrow();
    expect(ports.featureClaims.acquire).not.toHaveBeenCalled();
  },
);

it("retains claim conflicts and exact revision/request identity", async () => {
  const { ports, call } = setup();
  await expect(
    call("workspaces.featureClaims.acquire", {
      workspaceId: "work",
      expectedRevision: 3,
      requestId: "claim",
      featureKey: "voice",
      scope: "runtime",
    }),
  ).resolves.toMatchObject({ acquired: false });
  expect(ports.featureClaims.acquire).toHaveBeenCalledExactlyOnceWith({
    workspaceId: "work",
    expectedRevision: 3,
    idempotencyKey: "claim",
    featureKey: "voice",
    scope: "runtime",
  });
  await call("workspaces.featureClaims.release", {
    workspaceId: "work",
    expectedRevision: 3,
    requestId: "release",
    claimId: "mine",
  });
  expect(ports.featureClaims.release).toHaveBeenCalledExactlyOnceWith({
    workspaceId: "work",
    expectedRevision: 3,
    idempotencyKey: "release",
    claimId: "mine",
  });
});

it("returns cleanup blockers without running an apply operation", async () => {
  const { ports, call } = setup();
  await expect(
    call("workspaces.cleanup.plan", { workspaceId: "work", expectedRevision: 3 }),
  ).resolves.toMatchObject({ blockers: ["Unknown activity"], token: "review" });
  expect(ports.assertWritable).toHaveBeenCalledWith("work");
  expect(Object.keys(WORKSPACE_MANAGEMENT_TOOLS)).not.toContain("workspaces.cleanup.apply");
});

it("paginates operation summaries and omits recovery journals", async () => {
  const { workspace, ports, call } = setup();
  ports.removal.status.mockResolvedValue({
    workspace,
    operations: Array.from({ length: 35 }, (_, index) => ({
      id: String(index),
      kind: "cleanup",
      phase: "blocked",
      expectedRevision: 3,
      privateJournal: "large",
    })) as unknown as WorkspaceOperation[],
  });
  const result = await call("workspaces.cleanup.status", {
    workspaceId: "work",
    offset: 30,
    limit: 3,
  });
  expect(result).toMatchObject({
    total: 35,
    nextOffset: 33,
    operations: [{ id: "30" }, { id: "31" }, { id: "32" }],
  });
  expect(JSON.stringify(result)).not.toContain("privateJournal");
});

it("uses task delivery review and never merges or publishes", async () => {
  const { workspace, ports, call } = setup();
  workspace.owner = { kind: "task", id: "task" };
  await expect(
    call("workspaces.delivery.review", {
      workspaceId: "work",
      expectedRevision: 3,
      action: "merge",
    }),
  ).resolves.toMatchObject({ token: "task-review" });
  expect(ports.reviewTaskDelivery).toHaveBeenCalledExactlyOnceWith("task");
  expect(ports.delivery.review).not.toHaveBeenCalled();
  expect(Object.keys(WORKSPACE_MANAGEMENT_TOOLS)).not.toContain("workspaces.delivery.merge");
});

it("marks bounded delivery detail as incomplete", async () => {
  const { ports, call } = setup();
  ports.delivery.review.mockResolvedValue({
    token: "review",
    blockers: [],
    changedPaths: Array.from({ length: 150 }, (_, index) => `file-${index}`),
  });
  const result = await call("workspaces.delivery.review", {
    workspaceId: "work",
    expectedRevision: 3,
    action: "merge",
  });
  expect(result).toMatchObject({ truncated: true, truncatedFields: { changedPaths: 150 } });
  expect((result as { changedPaths: unknown[] }).changedPaths).toHaveLength(100);
});
