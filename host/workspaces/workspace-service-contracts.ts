import type {
  BuildIdentity,
  ManagedWorkspace,
  ResolvedWorkspacePolicy,
  TurnGitRecord,
  WorkspaceActivity,
  WorkspaceBootstrapStatus,
  WorkspaceDevEnvironment,
  WorkspaceMutation,
  WorkspaceOperation,
  WorkspacePolicyOverride,
  WorkspacePortKind,
  WorkspacePortLease,
  WorkspaceReservation,
} from "./workspace-contracts";
import type {
  WorkspaceRpcMethod,
  WorkspaceRpcRequest,
  WorkspaceRpcResponse,
} from "./workspace-rpc-contracts";

/** Internal signature reuse only; no dispatch or implementation is installed by this module. */
export type WorkspaceRpcHandler<Method extends WorkspaceRpcMethod> = (
  request: WorkspaceRpcRequest<Method>,
) => Promise<WorkspaceRpcResponse<Method>>;

/** S1. Issued/verified by authenticated owner transport, never accepted as a renderer boolean or agent claim. */
export interface WorkspaceOwnerAuthorization {
  ownerId: string;
  authorizationId: string;
}
/** S1. Creation is atomic/idempotent; all writes use revisions; removed workspaces remain queryable. */
export interface WorkspaceRegistry {
  prepare: WorkspaceRpcHandler<"workspaces.prepare">;
  get: WorkspaceRpcHandler<"workspaces.get">;
  list: WorkspaceRpcHandler<"workspaces.list">;
  resume: WorkspaceRpcHandler<"workspaces.resume">;
  finish: WorkspaceRpcHandler<"workspaces.finish">;
  close: WorkspaceRpcHandler<"workspaces.close">;
  /** Persist lifecycle/directory transitions under the caller's reservation, without losing concurrent updates. */
  update(
    request: WorkspaceMutation & {
      reservationId: string;
      changes: Partial<
        Pick<
          ManagedWorkspace,
          | "state"
          | "directoryState"
          | "lastActivityAt"
          | "finishedAt"
          | "mergedAt"
          | "closedAt"
          | "deliveredCommit"
          | "pinned"
        >
      >;
    },
  ): Promise<ManagedWorkspace>;
  /** Durable compare-and-set journal shared by S1/S2/S3/S4. Recovery must fence unfinished operations. */
  saveOperation(
    operation: WorkspaceOperation,
    expectedPhase: WorkspaceOperation["phase"] | null,
  ): Promise<void>;
  getOperation(operationId: string): Promise<WorkspaceOperation | null>;
  findOperation(request: {
    workspaceId: string;
    kind: WorkspaceOperation["kind"];
    idempotencyKey: string;
  }): Promise<WorkspaceOperation | null>;
  /** Omitting workspaceId is internal startup recovery inventory, never an unscoped public RPC. */
  listOperations(workspaceId?: string): Promise<WorkspaceOperation[]>;
}
/** S1. Execution host owns defaults/project overrides; owner overrides apply only to explicit creation. */
export interface WorkspacePolicyResolver {
  resolve(request: {
    projectId: string;
    environmentId: string;
    choice?: WorkspacePolicyOverride;
  }): Promise<ResolvedWorkspacePolicy>;
  get: WorkspaceRpcHandler<"projects.workspacePolicy.get">;
  update(
    request: WorkspaceRpcRequest<"projects.workspacePolicy.update">,
    owner: WorkspaceOwnerAuthorization,
  ): Promise<WorkspaceRpcResponse<"projects.workspacePolicy.update">>;
}
/** S1. Atomic feature acquisition detects conflicting live scopes across sibling worktrees. */
export interface WorkspaceFeatureClaims {
  list: WorkspaceRpcHandler<"workspaces.featureClaims.list">;
  acquire: WorkspaceRpcHandler<"workspaces.featureClaims.acquire">;
  release: WorkspaceRpcHandler<"workspaces.featureClaims.release">;
}

/** S2. Capture before provider execution; retain every advertised boundary and expose capture failures. */
export interface TurnGitHistory {
  begin(request: {
    workspaceId: string;
    sessionId: string;
    userBlockId: string;
    runId: string;
    conversationRevision: number;
  }): Promise<TurnGitRecord>;
  end(request: {
    workspaceId: string;
    sessionId: string;
    userBlockId: string;
    runId: string;
  }): Promise<TurnGitRecord>;
  get(workspaceId: string, userBlockId: string): Promise<TurnGitRecord | null>;
  list(workspaceId: string, sessionId: string): Promise<TurnGitRecord[]>;
}
/** S2. Uses S4 reservations + session/common-Git gates. Rescue first, reconcile both stores, invalidate provider. */
export interface SessionRewindService {
  plan: WorkspaceRpcHandler<"sessions.rewind.plan">;
  apply: WorkspaceRpcHandler<"sessions.rewind.apply">;
  undo: WorkspaceRpcHandler<"sessions.rewind.undo">;
  /** Recovery is idempotent and keeps writers blocked until Git and conversation receipts agree. */
  recover(operationId: string): Promise<WorkspaceOperation>;
}
/** S3. SHA/revision/fingerprint-bound plans; owner proof supplied separately by S1, never conversation tools. */
export interface BranchDeliveryService {
  review: WorkspaceRpcHandler<"workspaces.delivery.review">;
  merge(
    request: WorkspaceRpcRequest<"workspaces.delivery.merge">,
    owner: WorkspaceOwnerAuthorization,
  ): Promise<WorkspaceRpcResponse<"workspaces.delivery.merge">>;
  publish(
    request: WorkspaceRpcRequest<"workspaces.delivery.publish">,
    owner: WorkspaceOwnerAuthorization,
  ): Promise<WorkspaceRpcResponse<"workspaces.delivery.publish">>;
  /** Inspect authoritative push/PR receipts before resuming unknown external effects. */
  recover(operationId: string): Promise<WorkspaceOperation>;
}

/** S4 owns the gate; S3 supplies process/activity adapters; S2/S3 reserve before destructive work. */
export interface ExecutionActivityReservations {
  /** Atomic with reserve: reject new starts in a reserved/recovery-blocked workspace. */
  start(activity: Omit<WorkspaceActivity, "id" | "startedAt">): Promise<WorkspaceActivity>;
  stop(activityId: string): Promise<void>;
  list(workspaceId: string): Promise<WorkspaceActivity[]>;
  /** Freshly reject in-use/dirty-buffer/unknown activity; one exclusive reservation fences new starts. */
  reserve(request: {
    workspaceId: string;
    operationId: string;
    purpose: WorkspaceReservation["purpose"];
    expectedRevision: number;
  }): Promise<WorkspaceReservation>;
  /** May release only after the operation is settled, or recovery has explicitly reconciled it. */
  release(reservationId: string): Promise<void>;
}
/** S4. All managed removals use this service; manual owner plans may preserve dirty source before removal. */
export interface WorkspaceRemovalService {
  plan: WorkspaceRpcHandler<"workspaces.cleanup.plan">;
  apply(
    request: WorkspaceRpcRequest<"workspaces.cleanup.apply">,
    authority: WorkspaceOwnerAuthorization | { kind: "retentionScheduler" },
  ): Promise<WorkspaceRpcResponse<"workspaces.cleanup.apply">>;
  status: WorkspaceRpcHandler<"workspaces.cleanup.status">;
  storageStatus: WorkspaceRpcHandler<"workspaces.storage.status">;
  /** No-follow link-entry detach only, after canonical-root validation and an exclusive removal reservation. */
  detachDependencyLinks(request: {
    workspaceId: string;
    reservationId: string;
    planToken: string;
  }): Promise<{ detachedPaths: string[] }>;
  recover(operationId: string): Promise<WorkspaceOperation>;
}
/** S4. Startup, hourly and lifecycle triggers; pins/Never/activity/unknown status always win over disk pressure. */
export interface RetentionScheduler {
  run(request: {
    trigger: "startup" | "hourly" | "lifecycle";
    workspaceId?: string;
  }): Promise<{ removed: string[]; blocked: { workspaceId: string; reason: string }[] }>;
}

/** S6. Explicit, cancellable, deduplicated workspace+lockfile bootstrap. No implicit installs at creation. */
export interface WorkspaceBootstrap {
  prepare(request: {
    workspaceId: string;
    lockfileFingerprint: string;
    idempotencyKey: string;
  }): Promise<WorkspaceBootstrapStatus>;
  status(bootstrapId: string): Promise<WorkspaceBootstrapStatus>;
  cancel(bootstrapId: string): Promise<WorkspaceBootstrapStatus>;
  /** Own data/output/executable identity per run; shared build caches require a build lease. */
  devEnvironment(request: {
    workspaceId: string;
    runId: string;
    ports: WorkspacePortLease;
  }): Promise<WorkspaceDevEnvironment>;
}
/** S6. Reserve before launch; on a bind race release/reallocate, never kill another process. */
export interface PortLeases {
  acquire(request: {
    workspaceId: string;
    runId: string;
    kinds: WorkspacePortKind[];
    preferred?: Partial<Record<WorkspacePortKind, number>>;
  }): Promise<WorkspacePortLease>;
  release(leaseId: string): Promise<void>;
  list(workspaceId: string): Promise<WorkspacePortLease[]>;
}
/** S6. Capture once with frozen bytes; reject source drift and carry identical identity to every build stage. */
export interface BuildIdentityManifest {
  capture(request: {
    sourceRoot: string;
    frozenRoot: string;
    buildId: string;
    version: string;
    channel: string;
    mode: string;
  }): Promise<BuildIdentity>;
  read(manifestPath: string): Promise<BuildIdentity | null>;
}
