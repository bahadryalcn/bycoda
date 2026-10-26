import { randomUUID } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { hostGitRepositoryKey, withHostGitMutation } from "./git-mutations";
import { runGitText } from "../src/shared/lib/processExecution.node";
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
import type {
  WorkspaceOwnerAuthorization,
  WorkspacePolicyResolver,
  WorkspaceRegistry,
} from "./workspace-service-contracts";
import type { WorkspaceRpcRequest } from "./workspace-rpc-contracts";

type Options = {
  isActive?: (workspace: ManagedWorkspace) => Promise<boolean>;
  /** S4 may pause new materialization when safe disk reclamation is insufficient. */
  beforeMaterialize?: (workspace: ManagedWorkspace) => Promise<void>;
  /** S4 verifies this against the exclusive execution-activity reservation gate. */
  verifyReservation?: (request: WorkspaceMutation & { reservationId: string }) => Promise<void>;
  /** External ingress fence; reservation-proven recovery updates intentionally bypass it. */
  assertWritable?: (workspaceId: string) => Promise<void>;
  authorizeOwner?: (owner: WorkspaceOwnerAuthorization) => Promise<boolean>;
};

export function createManagedWorkspaceRegistry(
  store: HostStore,
  policy: WorkspacePolicyResolver,
  options: Options = {},
): WorkspaceRegistry & {
  touchActivity(workspaceId: string): Promise<void>;
  touchOwnerActivity(owner: WorkspaceOwner): Promise<void>;
  recoverCreate(operationId: string): Promise<ManagedWorkspace>;
  pin(
    request: WorkspaceMutation & { pinned: boolean },
    owner: WorkspaceOwnerAuthorization,
  ): Promise<ManagedWorkspace>;
  retarget(
    request: WorkspaceMutation & { targetBranchRef: string; targetDirectory: string },
    owner: WorkspaceOwnerAuthorization,
  ): Promise<ManagedWorkspace>;
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
    if (
      (await store.workspaceOperations(id)).some(
        (operation) =>
          operation.phase !== "complete" ||
          (operation.kind === "rewind" &&
            !(operation as typeof operation & { finalized?: boolean }).finalized),
      )
    )
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
    async recoverCreate(operationId) {
      const stored = await store.workspaceOperation(operationId);
      if (!stored || stored.kind !== "create")
        throw new Error("Workspace creation operation not found");
      const current = await required(stored.workspaceId);
      const project = await store.project(current.projectId);
      return withHostGitMutation(project.cwd, async () => {
        const operation = await store.workspaceOperation(operationId);
        if (!operation || operation.kind !== "create" || operation.workspaceId !== current.id)
          throw new Error("Workspace creation operation identity changed");
        const workspace = await required(operation.workspaceId);
        const planned = operation.plannedWorkspace;
        for (const key of [
          "id",
          "repositoryId",
          "projectId",
          "environmentId",
          "path",
          "branchRef",
          "baseRef",
          "baseCommit",
        ] as const)
          if (workspace[key] !== planned[key])
            throw new Error(`Workspace creation identity changed: ${key}`);
        if (
          workspace.owner.kind !== planned.owner.kind ||
          workspace.owner.id !== planned.owner.id ||
          planned.id !== operation.workspaceId ||
          planned.revision !== operation.expectedRevision
        )
          throw new Error("Workspace creation ownership or planned revision changed");
        // Resume journals use this namespace and a retained post-creation revision.
        // Initial caller-provided creation keys may coincidentally share the prefix.
        const creating = !(operation.idempotencyKey.startsWith("resume:") && planned.revision > 0);
        if (operation.phase === "complete") return complete(operation, project.cwd, creating);
        revision(workspace, operation.expectedRevision);
        if (
          workspace.targetBranchRef !== planned.targetBranchRef ||
          workspace.targetDirectory !== planned.targetDirectory
        )
          throw new Error("Workspace creation target identity changed");
        if (
          (await store.workspaceOperations(workspace.id)).some(
            (other) =>
              other.id !== operation.id &&
              (other.phase !== "complete" ||
                (other.kind === "rewind" &&
                  !(other as typeof other & { finalized?: boolean }).finalized)),
          )
        )
          throw new Error("Another workspace operation recovery is pending");
        if (await options.isActive?.(workspace))
          throw new Error("Workspace is still active or activity is unknown");
        return complete(operation, project.cwd, creating);
      });
    },
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
        let targetBranchRef = resolved.integrationBranchRef;
        let targetDirectory: string | undefined;
        if (request.source !== undefined) {
          if (request.baseRef !== undefined || request.dependency !== undefined)
            throw new Error("Selected source cannot be combined with another base or dependency");
          const source = request.source;
          if (
            !source ||
            typeof source.directory !== "string" ||
            !isAbsolute(source.directory) ||
            typeof source.branchRef !== "string" ||
            !source.branchRef.startsWith("refs/heads/") ||
            typeof source.baseCommit !== "string" ||
            !/^[a-f0-9]{40,64}$/i.test(source.baseCommit)
          )
            throw new Error(
              "Selected source requires an absolute checkout, full branch ref and committed SHA",
            );
          const directory = await realpath(source.directory);
          if ((await hostGitRepositoryKey(directory)) !== repositoryId)
            throw new Error("Selected source belongs to a different repository");
          const git = (args: string[]) =>
            runGitText(args, {
              cwd: directory,
              windowsHide: true,
              timeout: 30_000,
              env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
            });
          await git(["check-ref-format", source.branchRef]);
          if ((await git(["symbolic-ref", "--quiet", "HEAD"])).trim() !== source.branchRef)
            throw new Error("Selected source checkout is not on the requested target branch");
          const registered = (await git(["worktree", "list", "--porcelain", "-z"]))
            .split("\0\0")
            .some((record) => {
              const fields = record.split("\0");
              return (
                fields.some((line) => {
                  if (!line.startsWith("worktree ")) return false;
                  const path = resolve(line.slice(9));
                  return process.platform === "win32"
                    ? path.toLowerCase() === directory.toLowerCase()
                    : path === directory;
                }) && fields.includes(`branch ${source.branchRef}`)
              );
            });
          if (!registered) throw new Error("Selected source is not a registered target checkout");
          baseCommit = await managedWorkspaceBase(project.cwd, source.baseCommit);
          if ((await git(["rev-parse", "--verify", "HEAD^{commit}"])).trim() !== baseCommit)
            throw new Error("Selected source commit changed; resolve the lead checkout again");
          baseRef = source.branchRef;
          targetBranchRef = source.branchRef;
          targetDirectory = directory;
        } else if (request.dependency) {
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
          targetBranchRef,
          ...(targetDirectory ? { targetDirectory } : {}),
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
        await options.assertWritable?.(workspace.id);
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
    async pin(request, owner) {
      if (typeof request.pinned !== "boolean") throw new Error("Pinned must be a boolean");
      return ownerMutation("pin", request, owner, async (workspace) => ({
        ...workspace,
        pinned: request.pinned,
        revision: workspace.revision + 1,
      }));
    },
    async retarget(request, owner) {
      return ownerMutation("retarget", request, owner, async (workspace) => {
        if (
          !isAbsolute(request.targetDirectory) ||
          !request.targetBranchRef.startsWith("refs/heads/")
        )
          throw new Error(
            "Retarget requires an absolute registered directory and full local branch ref",
          );
        if (
          workspace.state === "merged" ||
          workspace.directoryState !== "present" ||
          (await options.isActive?.(workspace))
        )
          throw new Error("Workspace must be idle and undelivered before retargeting");
        const directory = await realpath(request.targetDirectory);
        if ((await hostGitRepositoryKey(directory)) !== workspace.repositoryId)
          throw new Error("Retarget directory belongs to a different repository");
        const git = (args: string[]) =>
          runGitText(args, {
            cwd: directory,
            windowsHide: true,
            timeout: 30_000,
            env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
          });
        await git(["check-ref-format", request.targetBranchRef]);
        if ((await git(["symbolic-ref", "--quiet", "HEAD"])).trim() !== request.targetBranchRef)
          throw new Error("Retarget directory is not on the requested target branch");
        const registered = (await git(["worktree", "list", "--porcelain", "-z"]))
          .split("\0\0")
          .some(
            (record) =>
              record.split("\0").some((line) => {
                if (!line.startsWith("worktree ")) return false;
                const path = resolve(line.slice(9));
                return process.platform === "win32"
                  ? path.toLowerCase() === directory.toLowerCase()
                  : path === directory;
              }) && record.split("\0").includes(`branch ${request.targetBranchRef}`),
          );
        if (!registered || resolve(directory) === resolve(workspace.path))
          throw new Error("Retarget requires a separate registered target checkout");
        await git(["rev-parse", "--verify", `${request.targetBranchRef}^{commit}`]);
        return {
          ...workspace,
          targetBranchRef: request.targetBranchRef,
          targetDirectory: directory,
          revision: workspace.revision + 1,
        };
      });
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
    await options.assertWritable?.(request.workspaceId);
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
        (current.state === "active" && !options.isActive) ||
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
  async function ownerMutation(
    action: "pin" | "retarget",
    request: WorkspaceMutation,
    owner: WorkspaceOwnerAuthorization,
    change: (workspace: ManagedWorkspace) => Promise<ManagedWorkspace>,
  ) {
    validateMutation(request);
    if (
      !owner?.ownerId ||
      !owner.authorizationId ||
      (options.authorizeOwner && !(await options.authorizeOwner(owner)))
    )
      throw new Error("Workspace mutation requires authenticated owner authorization");
    const current = await required(request.workspaceId);
    const project = await store.project(current.projectId);
    return withHostGitMutation(project.cwd, async () => {
      const scope = `workspace.${action}:${request.workspaceId}`;
      const previous = await store.workspaceReceipt<ManagedWorkspace>(
        scope,
        request.idempotencyKey,
        request,
      );
      if (previous) return previous;
      await options.assertWritable?.(request.workspaceId);
      const fresh = await required(request.workspaceId);
      revision(fresh, request.expectedRevision);
      await settled(fresh.id);
      const next = await change(fresh);
      return store.transaction(async () => {
        await settled(fresh.id);
        await store.updateManagedWorkspace(next, fresh.revision, {
          retarget: action === "retarget",
        });
        await store.saveWorkspaceReceipt(scope, request.idempotencyKey, request, next);
        return next;
      });
    });
  }
  return registry;
}
