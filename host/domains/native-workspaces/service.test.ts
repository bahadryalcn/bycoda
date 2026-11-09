import { expect, it, vi } from "vitest";
import { createNativeWorkspacesService, type NativeWorkspacesPorts } from "./service";
import type { HostDomainContext } from "../context";

function harness(retired: { id: string; revision: number; branchRef: string } | null) {
  const managed = {
    exactGitRewind: { enabled: async () => false },
    assertWritable: vi.fn(async () => {
      throw new Error("Workspace recovery is pending; reconcile before writing");
    }),
    abandonUnmaterializedCreate: vi.fn(async (_id: string, apply: boolean) =>
      retired && apply ? { ...retired, revision: retired.revision + 1 } : retired,
    ),
    removal: {
      plan: vi.fn(async () => ({ token: "plan", blockers: ["Workspace is still in use."] })),
      status: vi.fn(async () => ({})),
    },
  } satisfies NativeWorkspacesPorts["managed"];
  const apply = vi.fn(async () => ({ directoryState: "removed" }));
  const service = createNativeWorkspacesService({
    managed,
    workspace: async (id) => ({ id: String(id), owner: { kind: "session", id: "owner" } }),
    touchActivity: async () => undefined,
  });
  const context = {
    authorized: async () => true,
    workspaceOwner: async (action) => action({ removal: { apply } } as never),
  } satisfies HostDomainContext;
  return { managed, apply, service, context };
}

it("reports a pending recovery as a cleanup blocker instead of failing the preview", async () => {
  const { service, context } = harness(null);
  await expect(
    service.call("workspaces.cleanup.plan", { workspaceId: "w", expectedRevision: 3 }, context),
  ).resolves.toMatchObject({
    blockers: [
      "Workspace recovery is pending; reconcile before writing",
      "Workspace is still in use.",
    ],
  });
});

it("retires a creation that never reached Git without running directory removal", async () => {
  const { managed, apply, service, context } = harness({
    id: "w",
    revision: 0,
    branchRef: "refs/heads/bycoda/s/w",
  });
  const plan = await service.call(
    "workspaces.cleanup.plan",
    { workspaceId: "w", expectedRevision: 0 },
    context,
  );
  expect(plan).toMatchObject({ blockers: ["Workspace is still in use."] });
  expect(managed.assertWritable).not.toHaveBeenCalled();
  const request = { workspaceId: "w", expectedRevision: 0, idempotencyKey: "k", planToken: "p" };
  await expect(service.call("workspaces.cleanup.apply", request, context)).resolves.toEqual({
    operationId: "k",
    workspaceId: "w",
    directoryState: "removed",
    workspaceRevision: 1,
    retainedBranchRef: "refs/heads/bycoda/s/w",
    recoveryIds: [],
  });
  expect(apply).not.toHaveBeenCalled();
  await expect(
    service.call("workspaces.cleanup.apply", { ...request, expectedRevision: 4 }, context),
  ).rejects.toThrow("revision changed");
});
