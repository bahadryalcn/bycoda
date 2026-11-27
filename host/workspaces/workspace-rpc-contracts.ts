import type {
  BranchDeliveryPlan,
  BranchMergeReceipt,
  BranchPublicationReceipt,
  ManagedWorkspace,
  ResolvedWorkspacePolicy,
  SessionRewindPlan,
  SessionRewindReceipt,
  WorkspaceBaseSource,
  WorkspaceCleanupPlan,
  WorkspaceCreationProgress,
  WorkspaceFeatureClaim,
  WorkspaceMutation,
  WorkspaceOperation,
  WorkspaceOwner,
  WorkspacePolicyOverride,
  WorkspaceRemovalReceipt,
  WorkspaceState,
  WorkspaceStorageStatus,
} from "./workspace-contracts";

/** Proposed names only: S1 advertises capabilities/wires dispatch only after each execution path exists. */
export const WORKSPACE_RPC_METHODS = {
  prepare: "workspaces.prepare",
  get: "workspaces.get",
  list: "workspaces.list",
  resume: "workspaces.resume",
  finish: "workspaces.finish",
  close: "workspaces.close",
  pin: "workspaces.pin",
  policyGet: "projects.workspacePolicy.get",
  policyUpdate: "projects.workspacePolicy.update",
  featureClaimsList: "workspaces.featureClaims.list",
  featureClaimsAcquire: "workspaces.featureClaims.acquire",
  featureClaimsRelease: "workspaces.featureClaims.release",
  rewindPlan: "sessions.rewind.plan",
  rewindApply: "sessions.rewind.apply",
  rewindUndo: "sessions.rewind.undo",
  deliveryReview: "workspaces.delivery.review",
  deliveryMerge: "workspaces.delivery.merge",
  deliveryPublish: "workspaces.delivery.publish",
  cleanupPlan: "workspaces.cleanup.plan",
  cleanupApply: "workspaces.cleanup.apply",
  cleanupStatus: "workspaces.cleanup.status",
  storageStatus: "workspaces.storage.status",
  prepareStatus: "workspaces.prepare.status",
  prepareCancel: "workspaces.prepare.cancel",
  renameBranch: "workspaces.renameBranch",
} as const;

/** S1 owns routing/auth. Requests convey intent; owner authorization is supplied by trusted transport. */
export interface WorkspaceRpcContract {
  "workspaces.prepare": {
    request: {
      idempotencyKey: string;
      projectId: string;
      environmentId: string;
      owner: WorkspaceOwner;
      slug: string;
      /** Explicit owner choice only; agent callers cannot manufacture policy exceptions. */
      choice?: WorkspacePolicyOverride;
      baseRef?: string;
      /** Pin a selected lead's committed checkout and its intended delivery target. */
      source?: { baseCommit: string; branchRef: string; directory: string };
      /** A committed dependency, never another workspace's dirty directory. */
      dependency?: { workspaceId: string; commit: string };
      featureKey?: string;
      /**
       * `workspaces.creation.v2`. Extra project folders that each get a sibling worktree on the
       * same branch. Absent means none. At most WORKSPACE_CREATION_MAX_REPOSITORIES.
       */
      repositories?: string[];
      /** `workspaces.creation.v2`. Fetch the base's upstream and start from it. Absent means false. */
      baseFromRemote?: boolean;
      /** `workspaces.creation.v2`. Client-chosen key for `workspaces.prepare.status/cancel`. */
      progressId?: string;
    };
    response: {
      workspace: ManagedWorkspace;
      operationId: string;
      /** Extra folder to its worktree path; empty when none were requested. */
      extraWorktrees?: Record<string, string>;
      /** "local" when a remote start was requested but no upstream branch existed. */
      baseSource?: WorkspaceBaseSource;
    };
  };
  "workspaces.prepare.status": {
    request: { progressId: string };
    response: WorkspaceCreationProgress;
  };
  /** Aborts the git child and rolls back what this operation created. Idempotent. */
  "workspaces.prepare.cancel": {
    request: { progressId: string };
    response: WorkspaceCreationProgress;
  };
  /**
   * Renames the temporary `by/<8hex>` branch (primary and sibling worktrees) to `by/<fragment>`.
   * Refused while a mutation is active, an upstream is set or a delivery review is pending.
   */
  "workspaces.renameBranch": {
    request: WorkspaceMutation & { fragment: string };
    response: { branchRef: string; renamed: boolean; revision: number };
  };
  "workspaces.get": { request: { workspaceId: string }; response: ManagedWorkspace | null };
  "workspaces.list": {
    request: { projectId: string; environmentId?: string; states?: WorkspaceState[] };
    response: ManagedWorkspace[];
  };
  /** Resume materializes the retained owned branch if needed, never the project/main directory. */
  "workspaces.resume": { request: WorkspaceMutation; response: ManagedWorkspace };
  "workspaces.finish": { request: WorkspaceMutation; response: ManagedWorkspace };
  /** Close marks abandoned; it does not imply directory or branch deletion. */
  "workspaces.close": { request: WorkspaceMutation; response: ManagedWorkspace };
  "workspaces.pin": {
    request: WorkspaceMutation & { pinned: boolean };
    response: ManagedWorkspace;
  };
  "projects.workspacePolicy.get": {
    request: { projectId: string; environmentId: string };
    response: { revision: number; resolved: ResolvedWorkspacePolicy };
  };
  "projects.workspacePolicy.update": {
    request: {
      projectId: string;
      environmentId: string;
      expectedRevision: number;
      idempotencyKey: string;
      /** Replace the project override; omitted fields inherit host defaults. */
      policy: WorkspacePolicyOverride;
    };
    response: WorkspaceRpcContract["projects.workspacePolicy.get"]["response"];
  };
  "workspaces.featureClaims.list": {
    request: { projectId: string; featureKey?: string };
    response: WorkspaceFeatureClaim[];
  };
  "workspaces.featureClaims.acquire": {
    request: WorkspaceMutation & { featureKey: string; scope?: string };
    response:
      | { acquired: true; claim: WorkspaceFeatureClaim }
      | { acquired: false; conflicts: WorkspaceFeatureClaim[] };
  };
  "workspaces.featureClaims.release": {
    request: WorkspaceMutation & { claimId: string };
    response: { released: boolean };
  };
  "sessions.rewind.plan": {
    request: {
      authorityGeneration?: number;
      workspaceId: string;
      sessionId: string;
      expectedRevision: number;
      expectedConversationRevision: number;
    } & ({ direction: "rewind"; userBlockId: string } | { direction: "undo"; operationId: string });
    response: SessionRewindPlan;
  };
  "sessions.rewind.apply": {
    request: WorkspaceMutation & {
      authorityGeneration?: number;
      sessionId: string;
      expectedConversationRevision: number;
      planToken: string;
    };
    response: SessionRewindReceipt;
  };
  /** Uses a fresh direction:undo plan from sessions.rewind.plan; never blindly restores stale rescue state. */
  "sessions.rewind.undo": WorkspaceRpcContract["sessions.rewind.apply"];
  "workspaces.delivery.review": {
    request: { workspaceId: string; expectedRevision: number } & (
      | { action: "merge" }
      | {
          action: "publish";
          publication: Extract<BranchDeliveryPlan, { action: "publish" }>["publication"];
        }
    );
    response: BranchDeliveryPlan;
  };
  "workspaces.delivery.merge": {
    request: WorkspaceMutation & { planToken: string };
    response: BranchMergeReceipt;
  };
  "workspaces.delivery.publish": {
    request: WorkspaceMutation & { planToken: string };
    response: BranchPublicationReceipt;
  };
  "workspaces.cleanup.plan": {
    request: { workspaceId: string; expectedRevision: number };
    response: WorkspaceCleanupPlan;
  };
  "workspaces.cleanup.apply": {
    request: WorkspaceMutation & { planToken: string };
    response: WorkspaceRemovalReceipt;
  };
  "workspaces.cleanup.status": {
    request: { workspaceId: string; operationId?: string };
    response: { workspace: ManagedWorkspace; operations: WorkspaceOperation[] };
  };
  "workspaces.storage.status": {
    request: { projectId: string; environmentId: string };
    response: WorkspaceStorageStatus;
  };
}
export type WorkspaceRpcMethod = (typeof WORKSPACE_RPC_METHODS)[keyof typeof WORKSPACE_RPC_METHODS];
export type WorkspaceRpcRequest<Method extends WorkspaceRpcMethod> =
  WorkspaceRpcContract[Method]["request"];
export type WorkspaceRpcResponse<Method extends WorkspaceRpcMethod> =
  WorkspaceRpcContract[Method]["response"];
