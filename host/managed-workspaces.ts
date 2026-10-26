import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { withHostGitMutation } from "./git-mutations";
import {
  managedWorkspaceBase,
  managedWorkspaceNames,
  managedWorkspaceRoot,
  materializeManagedWorkspace,
} from "./git-worktrees";
import { projectRepositoryIdentity } from "./workspace-policy";
import type { HostStore } from "./store";
import type {
  ManagedWorkspace,
  WorkspaceCreateOperation,
  WorkspaceMutation,
  WorkspaceOwner,
} from "./workspace-contracts";
import type { WorkspacePolicyResolver, WorkspaceRegistry } from "./workspace-service-contracts";
import type { WorkspaceRpcRequest } from "./workspace-rpc-contracts";

type Options = {
  isActive?: (workspace: ManagedWorkspace) => Promise<boolean>;
  /** S4 may pause new materialization when safe disk reclamation is insufficient. */
  beforeMaterialize?: (workspace: ManagedWorkspace) => Promise<void>;
  /** S4 verifies this against the exclusive execution-activity reservation gate. */
  verifyReservation?: (request: WorkspaceMutation & { reservationId: string }) => Promise<void>;
};

export function createManagedWorkspaceRegistry(
  store: HostStore,
  policy: WorkspacePolicyResolver,
  options: Options = {},
): WorkspaceRegistry & {
  touchActivity(workspaceId: string): Promise<void>;
  touchOwnerActivity(owner: WorkspaceOwner): Promise<void>;
} {
  const required = async (id: string) => {
    const workspace = await store.managedWorkspace(id);
    if (!workspace) throw new Error("Managed workspace not found");
    return workspace;
  };
  const revision = (workspace: ManagedWorkspace, expected: number) => {
    if (workspace.revision !== expected)
      throw new Error("Workspace revision changed; refresh and retry");
  };
  const validateMutation = (request: WorkspaceMutation) => {
    if (
      typeof request.idempotencyKey !== "string" ||
      !request.idempotencyKey.trim() ||
      !Number.isSafeInteger(request.expectedRevision) ||
      request.expectedRevision < 0
    )
      throw new Error("Workspace mutation requires an idempotency key and nonnegative revision");
  };
  const settled = async (id: string) => {
    if ((await store.workspaceOperations(id)).some((operation) => operation.phase !== "complete"))
      throw new Error("Workspace operation recovery required before further writes");
  };
  const releaseClaims = async (id: string) => {
    for (const claim of await store.workspaceFeatureClaims({ workspaceId: id }))
      await store.deleteWorkspaceFeatureClaim(claim.id, id);
  };
  const complete = async (operation: WorkspaceCreateOperation, cwd: string, creating: boolean) => {
    if (operation.phase === "complete") {
      const receipt = await store.workspaceReceipt<ManagedWorkspace>(
        "workspace.materialized",
        operation.id,
        { operationId: operation.id },
      );
      if (!receipt) throw new Error("Workspace creation completion receipt missing");
      return receipt;
    }
    let op = operation;
    try {
      await options.beforeMaterialize?.(op.plannedWorkspace);
      await materializeManagedWorkspace(cwd, op.plannedWorkspace, creating);
      await store.transaction(async () => {
        const current = await required(op.workspaceId);
        revision(current, op.expectedRevision);
        const materialized = {
          ...op,
          phase: "materialized" as const,
          resumePhase: undefined,
          error: undefined,
          updatedAt: Date.now(),
        };
        await store.saveWorkspaceOperation(materialized, op.phase);
        op = materialized;
        const workspace: ManagedWorkspace = {
          ...current,
          directoryState: "present",
          state: "idle",
          lastActivityAt: Date.now(),
          revision: current.revision + 1,
        };
        await store.updateManagedWorkspace(workspace, current.revision);
        await store.saveWorkspaceOperation(
          { ...op, phase: "complete", updatedAt: Date.now() },
          "materialized",
        );
        await store.saveWorkspaceReceipt(
          "workspace.materialized",
          op.id,
          { operationId: op.id },
          workspace,
        );
      });
      return (await store.workspaceReceipt<ManagedWorkspace>("workspace.materialized", op.id, {
        operationId: op.id,
      }))!;
    } catch (error) {
      // Keep the last durable phase. Never delete a possibly materialized directory or branch.
      const latest = await store.workspaceOperation(op.id);
      if (latest?.kind === "create" && latest.phase !== "complete") {
        await store.saveWorkspaceOperation(
          {
            ...latest,
            phase: "blocked",
            resumePhase: latest.phase === "blocked" ? latest.resumePhase : latest.phase,
            error: {
              code: "WORKSPACE_MATERIALIZATION_BLOCKED",
              message: error instanceof Error ? error.message : "Workspace materialization failed",
            },
            updatedAt: Date.now(),
          },
          latest.phase,
        );
      }
      throw error;
    }
  };

  const registry: ReturnType<typeof createManagedWorkspaceRegistry> = {
    async prepare(request) {
      if (
        !request.environmentId?.trim() ||
        !request.idempotencyKey?.trim() ||
        !request.owner?.id?.trim() ||
        !["session", "task", "automationRun", "stewardRun"].includes(request.owner.kind)
      )
        throw new Error("Invalid workspace creation identity");
      const project = await store.project(request.projectId);
      const repositoryId = await projectRepositoryIdentity(store, request.projectId);
      return withHostGitMutation(project.cwd, async () => {
        const scope = `workspace.prepare:${repositoryId}:${request.environmentId}`;
        const existing = await store.workspaceReceipt<{ operationId: string }>(
          scope,
          request.idempotencyKey,
          request,
        );
        if (existing) {
          const op = await store.workspaceOperation(existing.operationId);
          if (!op || op.kind !== "create") throw new Error("Workspace creation journal missing");
          return { workspace: await complete(op, project.cwd, true), operationId: op.id };
        }
        const resolved = (
          await policy.resolve({
            projectId: request.projectId,
            environmentId: request.environmentId,
            choice: request.choice,
          })
        ).policy;
        if (resolved.defaultMode === "current")
          throw new Error(
            "Current checkout is an explicit exception; managed preparation requires worktree mode",
          );
        let baseRef = request.baseRef ?? resolved.integrationBranchRef;
        let baseCommit: string;
        if (request.dependency) {
          const dependency = await required(request.dependency.workspaceId);
          if (
            dependency.repositoryId !== repositoryId ||
            dependency.environmentId !== request.environmentId
          )
            throw new Error("Dependency belongs to a different repository or environment");
          if (!/^[a-f0-9]{40,64}$/i.test(request.dependency.commit))
            throw new Error("Dependency must be a committed SHA");
          baseCommit = await managedWorkspaceBase(project.cwd, request.dependency.commit);
          baseRef = dependency.branchRef;
          // The caller cannot label an unrelated object as this dependency's committed result.
          const { execFileAsync } = await import("../src/shared/lib/processExecution.node");
          await execFileAsync(
            "git",
            ["merge-base", "--is-ancestor", baseCommit, dependency.branchRef],
            { cwd: project.cwd, windowsHide: true, timeout: 10_000 },
          );
        } else baseCommit = await managedWorkspaceBase(project.cwd, baseRef);
        const id = randomUUID();
        const names = managedWorkspaceNames(request.owner, request.slug, id);
        const root = await managedWorkspaceRoot(project.cwd, resolved.root);
        const workspace: ManagedWorkspace = {
          id,
          repositoryId,
          projectId: request.projectId,
          environmentId: request.environmentId,
          owner: request.owner,
          path: join(root, names.directory),
          branchRef: `refs/heads/${names.branch}`,
          baseRef,
          baseCommit,
          targetBranchRef: resolved.integrationBranchRef,
          state: "idle",
          directoryState: "blocked",
          revision: 0,
          lastActivityAt: Date.now(),
          pinned: resolved.pinned,
          ...(request.featureKey ? { featureKey: request.featureKey } : {}),
        };
        const op: WorkspaceCreateOperation = {
          id: randomUUID(),
          kind: "create",
          phase: "registered",
          workspaceId: id,
          expectedRevision: 0,
          idempotencyKey: request.idempotencyKey,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          plannedWorkspace: workspace,
        };
        await store.transaction(async () => {
          const existingOwner = (
            await store.managedWorkspaces({ repositoryId, environmentId: request.environmentId })
          ).find(
            (entry) =>
              entry.owner.kind === request.owner.kind && entry.owner.id === request.owner.id,
          );
          if (existingOwner)
            throw Object.assign(
              new Error("This writer already owns a managed workspace; resume that workspace"),
              { code: "WORKSPACE_OWNER_CONFLICT", workspaceId: existingOwner.id },
            );
          await store.insertManagedWorkspace(workspace);
          await store.saveWorkspaceOperation(op, null);
          await store.saveWorkspaceReceipt(scope, request.idempotencyKey, request, {
            operationId: op.id,
          });
        });
        return { workspace: await complete(op, project.cwd, true), operationId: op.id };
      });
    },
    async get({ workspaceId }) {
      return store.managedWorkspace(workspaceId);
    },
    async list(request) {
      const repositoryId = await projectRepositoryIdentity(store, request.projectId);
      return store.managedWorkspaces({
        repositoryId,
        environmentId: request.environmentId,
        states: request.states,
      });
    },
    async resume(request) {
      validateMutation(request);
      const workspace = await required(request.workspaceId);
      const project = await store.project(workspace.projectId);
      return withHostGitMutation(project.cwd, async () => {
        const scope = `workspace.resume:${workspace.id}`;
        const prior = await store.workspaceReceipt<ManagedWorkspace>(
          scope,
          request.idempotencyKey,
          request,
        );
        if (prior) return prior;
        if (await options.isActive?.(await required(workspace.id)))
          throw new Error("Workspace is active");
        let op = await store.findWorkspaceOperation({
          workspaceId: workspace.id,
          kind: "create",
          idempotencyKey: `resume:${request.idempotencyKey}`,
        });
        if (!op) {
          await store.transaction(async () => {
            const current = await required(workspace.id);
            revision(current, request.expectedRevision);
            await settled(current.id);
            if (
              current.state === "active" ||
              ["removing", "pendingRemoval", "blocked"].includes(current.directoryState)
            )
              throw new Error("Workspace is active or requires recovery");
            op = {
              id: randomUUID(),
              kind: "create",
              phase: "registered",
              workspaceId: current.id,
              idempotencyKey: `resume:${request.idempotencyKey}`,
              expectedRevision: current.revision,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              plannedWorkspace: current,
            };
            await store.saveWorkspaceOperation(op, null);
          });
        }
        if (op!.kind !== "create") throw new Error("Invalid resume operation");
        revision(op!.plannedWorkspace, request.expectedRevision);
        const result = await complete(op!, project.cwd, false);
        await store.saveWorkspaceReceipt(scope, request.idempotencyKey, request, result);
        return result;
      });
    },
    async finish(request) {
      return transition(request, "finished");
    },
    async close(request) {
      return transition(request, "abandoned");
    },
    async update(request) {
      validateMutation(request);
      const original = await store.workspaceReceipt<ManagedWorkspace>(
        `workspace.update:${request.workspaceId}`,
        request.idempotencyKey,
        request,
      );
      if (original) return original;
      if (!options.verifyReservation) throw new Error("Workspace reservation service required");
      await options.verifyReservation(request);
      return store.transaction(async () => {
        const scope = `workspace.update:${request.workspaceId}`;
        const prior = await store.workspaceReceipt<ManagedWorkspace>(
          scope,
          request.idempotencyKey,
          request,
        );
        if (prior) return prior;
        const current = await required(request.workspaceId);
        revision(current, request.expectedRevision);
        const result = { ...current, ...request.changes, revision: current.revision + 1 };
        await store.updateManagedWorkspace(result, current.revision);
        if (["merged", "abandoned"].includes(result.state)) await releaseClaims(result.id);
        await store.saveWorkspaceReceipt(scope, request.idempotencyKey, request, result);
        return result;
      });
    },
    async saveOperation(operation, expectedPhase) {
      return store.transaction(async () => {
        if (expectedPhase === null) {
          revision(await required(operation.workspaceId), operation.expectedRevision);
          await settled(operation.workspaceId);
        }
        await store.saveWorkspaceOperation(operation, expectedPhase);
      });
    },
    async getOperation(id) {
      return store.workspaceOperation(id);
    },
    async findOperation(request) {
      return store.findWorkspaceOperation(request);
    },
    async listOperations(id) {
      return store.workspaceOperations(id);
    },
    async touchActivity(id) {
      const active = await options.isActive?.(await required(id));
      await store.transaction(async () => {
        const current = await required(id);
        await settled(id);
        if (current.directoryState !== "present")
          throw new Error("Workspace directory is not available");
        await store.updateManagedWorkspace(
          {
            ...current,
            ...((current.state === "active" || current.state === "idle") && active !== undefined
              ? { state: active ? ("active" as const) : ("idle" as const) }
              : {}),
            lastActivityAt: Math.max(Date.now(), current.lastActivityAt + 1),
            revision: current.revision + 1,
          },
          current.revision,
        );
      });
    },
    async touchOwnerActivity(owner) {
      for (const workspace of await store.managedWorkspaces()) {
        if (workspace.owner.kind === owner.kind && workspace.owner.id === owner.id)
          await registry.touchActivity(workspace.id);
      }
    },
  };
  async function transition(
    request: WorkspaceRpcRequest<"workspaces.finish">,
    state: "finished" | "abandoned",
  ) {
    validateMutation(request);
    const original = await store.workspaceReceipt<ManagedWorkspace>(
      `workspace.${state}:${request.workspaceId}`,
      request.idempotencyKey,
      request,
    );
    if (original) return original;
    const active = await options.isActive?.(await required(request.workspaceId));
    return store.transaction(async () => {
      const scope = `workspace.${state}:${request.workspaceId}`;
      const prior = await store.workspaceReceipt<ManagedWorkspace>(
        scope,
        request.idempotencyKey,
        request,
      );
      if (prior) return prior;
      const current = await required(request.workspaceId);
      revision(current, request.expectedRevision);
      await settled(current.id);
      if (
        active ||
        current.state === "active" ||
        current.state === "merged" ||
        ["removing", "pendingRemoval"].includes(current.directoryState)
      )
        throw new Error("Workspace must be idle before this lifecycle transition");
      const result = {
        ...current,
        state,
        revision: current.revision + 1,
        ...(state === "finished" ? { finishedAt: Date.now() } : { closedAt: Date.now() }),
      };
      await store.updateManagedWorkspace(result, current.revision);
      if (state === "abandoned") await releaseClaims(result.id);
      await store.saveWorkspaceReceipt(scope, request.idempotencyKey, request, result);
      return result;
    });
  }
  return registry;
}
