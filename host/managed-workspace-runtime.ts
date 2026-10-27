import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import {
  canonicalWorkspaceDirectory,
  canonicalWorkspaceEntry,
  workspacePathKey,
} from "./workspace-paths";
import type { HostEngine } from "./engine";
import type { HostStore } from "./store";
import type { ManagedWorkspace, WorkspaceActivity } from "./workspace-contracts";
import type { WorkspaceOwnerAuthorization } from "./workspace-service-contracts";
import { createManagedWorkspaceRegistry } from "./managed-workspaces";
import { createWorkspacePolicyResolver } from "./workspace-policy";
import { createWorkspaceFeatureClaims } from "./feature-claims";
import {
  createExecutionActivityReservations,
  createWorkspaceRemovalService,
} from "./workspace-cleanup";
import {
  createWorkspaceRetentionScheduler,
  measureWorkspaceStorage,
  workspaceRetentionEligibility,
} from "./workspace-retention";
import { managedWorkspaceRoot } from "./git-worktrees";
import { hostGitRepositoryKey } from "./git-mutations";
import { GitTurnHistory, gitText } from "./turn-git-history";
import { HostBranchDeliveryService } from "./branch-delivery";
import { WorkspaceBootstrapService } from "./workspace-bootstrap";
import { createManagedNativeTurns } from "./managed-native-turns";
import { createManagedNativeRewind } from "./managed-native-rewind";
import { createManagedNativeActivity } from "./managed-native-activity";

export { workspacePathKey } from "./workspace-paths";
export const inManagedWorkspace = (path: string, root: string) =>
  workspacePathKey(path) === workspacePathKey(root) ||
  workspacePathKey(path).startsWith(`${workspacePathKey(root)}${sep}`);

/** One execution-host graph. Construct before exposing transports; recover before starts. */
export function createManagedWorkspaceRuntime(
  store: HostStore,
  engine: HostEngine,
  options: {
    probe?(workspace: ManagedWorkspace): Promise<WorkspaceActivity[]>;
    artifactPending?(workspaceId: string, completedDeliveryOperationId?: string): Promise<boolean>;
    canReconcileActivity?(activity: WorkspaceActivity): Promise<boolean>;
    afterNativeReceiptSaved?(): Promise<void>;
  } = {},
) {
  const root = join(dirname(store.attachmentDir), "managed-workspaces");
  const policy = createWorkspacePolicyResolver(store);
  let started = false;
  const startupRecovery = new AsyncLocalStorage<boolean>();
  const authorities = new Set<WorkspaceOwnerAuthorization>();
  const authorized = (owner: WorkspaceOwnerAuthorization) => authorities.has(owner);
  const get = async (workspaceId: string) => {
    const workspace = await store.managedWorkspace(workspaceId);
    if (!workspace || workspace.environmentId !== store.environmentId)
      throw new Error("Managed workspace is unavailable on this execution host");
    await store.project(workspace.projectId);
    return { ...workspace, path: await canonicalWorkspaceEntry(workspace.path) };
  };
  const list = async () =>
    Promise.all(
      (
        await Promise.all(
          (await store.projects()).map((project) =>
            store.managedWorkspaces({ projectId: project.id, environmentId: store.environmentId }),
          ),
        )
      )
        .flat()
        .map(async (workspace) => {
          try {
            return { ...workspace, path: await canonicalWorkspaceEntry(workspace.path) };
          } catch {
            // Keep unavailable rows visible for recovery. A targeted operation
            // must validate its own entry without blocking unrelated workspaces.
            return workspace;
          }
        }),
    );
  const probe = async (workspaceId: string) => [
    ...((await options.probe?.(await get(workspaceId))) ?? []),
    ...(await nativeActivity.probe(workspaceId)),
  ];
  const pending = async (workspaceId: string, except?: string) => {
    const operations = await store.workspaceOperations(workspaceId);
    const completedDelivery = operations.find(
      (operation) =>
        operation.id === except &&
        operation.kind === "delivery" &&
        operation.phase === "complete" &&
        operation.merge,
    );
    return (
      operations.some(
        (operation) =>
          operation.id !== except &&
          (operation.phase !== "complete" ||
            (operation.kind === "rewind" &&
              !(operation as unknown as { finalized?: boolean }).finalized)),
      ) || (await options.artifactPending?.(workspaceId, completedDelivery?.id)) === true
    );
  };
  const activity = createExecutionActivityReservations({
    get,
    probe,
    pending,
    persistence: store.workspaceActivityPersistence(),
    operation: (id) => store.workspaceOperation(id),
    canReconcileActivity: (entry) =>
      options.canReconcileActivity?.(entry) ?? Promise.resolve(false),
  });
  const assertWritable = async (workspaceId: string, deliveryRecoveryOperationId?: string) => {
    if (!started && !startupRecovery.getStore())
      throw new Error("Managed workspace startup recovery is pending");
    if (deliveryRecoveryOperationId) {
      const operations = await registry.listOperations(workspaceId);
      const recovering = operations.find(
        (operation) =>
          operation.id === deliveryRecoveryOperationId && operation.kind === "delivery",
      );
      if (
        !recovering ||
        operations.some(
          (operation) =>
            operation.id !== deliveryRecoveryOperationId &&
            (operation.phase !== "complete" ||
              (operation.kind === "rewind" && !(operation as { finalized?: boolean }).finalized)),
        )
      )
        throw new Error("Another workspace recovery is pending; reconcile before writing");
    } else await rewind.assertWritable(workspaceId);
    if (
      startupRecovery.getStore() &&
      (await activity.list(workspaceId)).some((entry) => entry.ownerId.startsWith("native-turn:"))
    )
      throw new Error(
        "Native execution must reconcile before host startup can settle this session",
      );
  };
  const storageStatus = async (request: { projectId: string; environmentId: string }) => {
    if (request.environmentId !== store.environmentId) throw new Error("Wrong execution host");
    const project = await store.project(request.projectId);
    const currentPolicy = (await policy.resolve(request)).policy;
    const storageRoot = await managedWorkspaceRoot(project.cwd, currentPolicy.root);
    await mkdir(storageRoot, { recursive: true });
    const workspaces = (await list()).filter(
      (workspace) =>
        workspace.directoryState === "present" && inManagedWorkspace(workspace.path, storageRoot),
    );
    return measureWorkspaceStorage({
      root: storageRoot,
      workspaces,
      recoveryRoots: [root],
      disk: currentPolicy.disk,
    });
  };
  const registry = createManagedWorkspaceRegistry(store, policy, {
    assertWritable,
    authorizeOwner: async (owner) => authorized(owner),
    isActive: async (workspace) => (await activity.list(workspace.id)).length > 0,
    verifyReservation: (request) => activity.verifyReservation(request),
    beforeMaterialize: async (workspace) => {
      // Creation journals themselves are pending here; do not re-enter the writer fence.
      const status = await storageStatus(workspace);
      if (status.materialization !== "allowed")
        throw new Error("Workspace storage admission is paused or unknown; inspect storage status");
    },
  });
  const workspace = async (workspaceId: string) => {
    const value = await get(workspaceId);
    if (value.directoryState !== "present")
      throw new Error("Workspace directory is unavailable; resume it first");
    const project = await store.project(value.projectId);
    if (
      (await hostGitRepositoryKey(project.cwd)) !== value.repositoryId ||
      (await hostGitRepositoryKey(value.path)) !== value.repositoryId
    )
      throw new Error("Managed repository identity changed");
    const registrations = await gitText(project.cwd, ["worktree", "list", "--porcelain", "-z"]);
    const registered = registrations.split("\0\0").some((record) => {
      const fields = record.split("\0");
      return (
        fields.some(
          (field) =>
            field.startsWith("worktree ") &&
            workspacePathKey(field.slice(9)) === workspacePathKey(value.path),
        ) &&
        fields.includes(`branch ${value.branchRef}`) &&
        !fields.some((field) => field.startsWith("locked"))
      );
    });
    if (!registered) throw new Error("Owned Git worktree registration changed");
    return value;
  };
  const history = new GitTurnHistory({ root, workspace });
  const nativeActivity = createManagedNativeActivity({
    root,
    workspace,
    listWorkspaces: list,
    activity,
    assertWritable,
    authorize: async (owner) => authorized(owner),
  });
  const nativeTurns = createManagedNativeTurns({
    workspace,
    history,
    activity,
    assertWritable,
    authorize: async (owner) => authorized(owner),
  });
  const nativeRewind = createManagedNativeRewind({
    root,
    history,
    registry,
    activity,
    conversation: engine.conversationRewindAdapter(join(root, "transcripts")),
    authorize: async (owner) => authorized(owner),
    isHostSession: async (id) => !!(await store.sessionAuthority(id)),
    afterReceiptSaved: options.afterNativeReceiptSaved,
  });
  const rewind = nativeRewind.service;
  const delivery = new HostBranchDeliveryService({
    registry,
    reservations: activity,
    targetDirectory: async (value) => {
      const target = (value as ManagedWorkspace & { targetDirectory?: string }).targetDirectory;
      return target ?? (await store.project(value.projectId)).cwd;
    },
    authorize: async (owner) => {
      if (!authorized(owner)) throw new Error("Authenticated owner approval required");
    },
  });
  const currentPolicy = async (value: ManagedWorkspace) => (await policy.resolve(value)).policy;
  const removal = createWorkspaceRemovalService({
    registry,
    reservations: activity,
    location: async (value) => ({
      projectCwd: (await store.project(value.projectId)).cwd,
      managedRoot: dirname(value.path),
      archiveRoot: join(root, "recovery", value.id),
    }),
    storageStatus,
    retentionEligible: async (value) =>
      workspaceRetentionEligibility(value, await currentPolicy(value)).eligible,
    authorize: async (owner) => authorized(owner),
  });
  const retention = createWorkspaceRetentionScheduler({
    list,
    get,
    policy: currentPolicy,
    removal,
    onError: () => console.warn("Managed workspace retention is pending"),
  });
  for (const action of ["finish", "close"] as const) {
    const transition = registry[action].bind(registry);
    registry[action] = async (request) => {
      const result = await transition(request);
      await retention.onLifecycle(result.id);
      return result;
    };
  }
  const bootstrap = new WorkspaceBootstrapService({
    resolveWorkspace: async (id) => {
      await assertWritable(id);
      return (await workspace(id)).path;
    },
  });
  engine.setManagedTurnHistoryAdapter({
    history,
    assertWritable,
    workspaceForSession: async (value) => {
      const id = value.session.workspaceId;
      if (!id) {
        const cwd = await canonicalWorkspaceDirectory(
          value.session.worktreeCwd ?? value.session.cwd,
        );
        for (const registered of await list()) {
          const registeredPath = await canonicalWorkspaceDirectory(registered.path).catch(
            () => registered.path,
          );
          if (inManagedWorkspace(cwd, registeredPath))
            throw new Error(
              "This managed directory requires its authoritative workspace identity; create a separate managed workspace",
            );
        }
        return null;
      }
      const registered = await workspace(id);
      if (
        registered.projectId !== value.projectId ||
        (registered.owner.kind === "session" && registered.owner.id !== value.session.id) ||
        !value.session.worktreeCwd ||
        workspacePathKey(await canonicalWorkspaceEntry(value.session.worktreeCwd)) !==
          workspacePathKey(registered.path)
      )
        throw new Error("Session managed workspace identity changed");
      return { workspaceId: id, path: registered.path };
    },
    prepareWorkspaceForCreate: async (request) => {
      const resolved = await policy.resolve({
        projectId: request.projectId,
        environmentId: store.environmentId,
        ...(request.workspaceMode ? { choice: { defaultMode: request.workspaceMode } } : {}),
      });
      if (resolved.policy.defaultMode === "current") return null;
      if (!started && !startupRecovery.getStore())
        throw new Error("Managed workspace startup recovery is pending");
      const prepared = await registry.prepare({
        projectId: request.projectId,
        environmentId: store.environmentId,
        owner: { kind: "session", id: request.sessionId },
        idempotencyKey: request.idempotencyKey,
        slug: "session",
        choice: { defaultMode: "worktree" },
      });
      return { workspaceId: prepared.workspace.id };
    },
    workspaceForCreate: async (request) => {
      await assertWritable(request.workspaceId);
      const value = await workspace(request.workspaceId);
      if (value.owner.kind === "session" && (await nativeRewind.isNativeSession(value.owner.id)))
        throw new Error("This workspace already belongs to a native transcript");
      if (
        value.projectId !== request.projectId ||
        (request.worktreeCwd &&
          workspacePathKey(await canonicalWorkspaceEntry(request.worktreeCwd)) !==
            workspacePathKey(value.path))
      )
        throw new Error("Session workspace belongs to another project or path");
      return {
        workspaceId: value.id,
        path: value.path,
        branchRef: value.branchRef,
        revision: value.revision,
        sessionId: value.owner.kind === "session" ? value.owner.id : undefined,
      };
    },
    prepareContextualWorkspace: async (request) => {
      const resolved = await policy.resolve({
        projectId: request.source.projectId,
        environmentId: store.environmentId,
      });
      if (resolved.policy.defaultMode === "current")
        return {
          workspaceMode: "current" as const,
          // A managed source's owned directory cannot become an unowned writer.
          path: request.source.session.workspaceId
            ? (await store.project(request.source.projectId)).cwd
            : (request.source.session.worktreeCwd ?? request.source.session.cwd),
        };
      if (!started && !startupRecovery.getStore())
        throw new Error("Managed workspace startup recovery is pending");
      const source = request.source.session.workspaceId
        ? await workspace(request.source.session.workspaceId)
        : undefined;
      if (source) await assertWritable(source.id);
      const baseRef =
        source?.branchRef ??
        (
          await gitText(request.source.session.worktreeCwd ?? request.source.session.cwd, [
            "rev-parse",
            "HEAD",
          ])
        ).trim();
      const prepared = await registry.prepare({
        projectId: request.source.projectId,
        environmentId: store.environmentId,
        owner: { kind: "session", id: request.sessionId },
        idempotencyKey: request.idempotencyKey,
        slug: request.source.session.title ?? "context",
        baseRef,
        choice: { defaultMode: "worktree" },
      });
      return { workspaceId: prepared.workspace.id };
    },
    startActivity: async (value, kind) => {
      const id = value.session.workspaceId;
      if (!id) return async () => {};
      await assertWritable(id);
      const hasNativeWriter = async () =>
        (await activity.list(id)).some(
          (entry) => entry.kind === "provider" && entry.ownerId.startsWith("native-turn:"),
        );
      if (await hasNativeWriter())
        throw new Error("A native provider is already executing in this workspace");
      const entry = await activity.start({ workspaceId: id, kind, ownerId: value.session.id });
      if (await hasNativeWriter()) {
        await activity.stop(entry.id);
        throw new Error("A native provider is already executing in this workspace");
      }
      return async () => {
        await activity.stop(entry.id);
        await registry.touchActivity(id);
      };
    },
  });
  return {
    registry,
    policy,
    activity,
    history,
    rewind,
    delivery,
    removal,
    retention,
    bootstrap,
    nativeTurns,
    nativeRewind,
    nativeActivity,
    claims: createWorkspaceFeatureClaims(store),
    workspace,
    get,
    list,
    assertWritable,
    storageStatus,
    /** Proof is issued only inside an already-authenticated owner transport scope. */
    async withOwner<T>(
      ownerId: string,
      action: (owner: WorkspaceOwnerAuthorization) => Promise<T>,
    ) {
      const owner = {
        ownerId: createHash("sha256").update(ownerId).digest("hex"),
        authorizationId: randomUUID(),
      };
      authorities.add(owner);
      try {
        return await action(owner);
      } finally {
        authorities.delete(owner);
      }
    },
    services: {
      registry,
      activity,
      removal,
      delivery,
      environmentId: store.environmentId,
      retargetWorkspace: async (
        request: Parameters<typeof registry.retarget>[0],
        owner: WorkspaceOwnerAuthorization,
      ) => {
        if (!authorized(owner)) throw new Error("Authenticated owner approval required");
        return registry.retarget(request, owner);
      },
    },
    async recover(reconcileDelivery?: (workspaceId: string) => Promise<unknown>) {
      const initialStartup = !started;
      // Settle only unfenced prior Host turns. The AsyncLocal scope admits startup
      // normalization without exposing managed writes to any transport or caller.
      if (initialStartup) await startupRecovery.run(true, () => engine.recoverManagedStartup());
      for (const operation of await registry.listOperations())
        if (
          operation.phase !== "complete" ||
          (operation.kind === "rewind" && !(operation as { finalized?: boolean }).finalized)
        )
          await activity.reconcilePreviousActivities({
            workspaceId: operation.workspaceId,
            operationId: operation.id,
          });
      await activity.reconcilePreviousActivities();
      const results = await rewind.recoverPending();
      for (const operation of await registry.listOperations()) {
        if (operation.kind === "rewind") continue;
        try {
          if (operation.kind === "create" && operation.phase !== "complete")
            await registry.recoverCreate(operation.id);
          else if (operation.kind === "delivery") {
            if (operation.phase !== "complete") await delivery.recover(operation.id);
            await reconcileDelivery?.(operation.workspaceId);
          } else if (operation.kind === "removal" && operation.phase !== "complete")
            await removal.recover(operation.id);
        } catch (error) {
          results.push({
            operationId: operation.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      await activity.recoverOrphanReservations();
      started = true;
      if (initialStartup) await startupRecovery.run(true, () => engine.recoverManagedStartup());
      return results;
    },
    async prepareBootstrap(request: Parameters<typeof bootstrap.prepare>[0]) {
      await assertWritable(request.workspaceId);
      const entry = await activity.start({
        workspaceId: request.workspaceId,
        kind: "operation",
        ownerId: request.idempotencyKey,
      });
      try {
        const status = await bootstrap.prepare(request);
        void bootstrap
          .wait(status.id)
          .finally(() => activity.stop(entry.id))
          .catch(() => {});
        return status;
      } catch (error) {
        await activity.stop(entry.id);
        throw error;
      }
    },
  };
}
