/** Shared wire records only. Implementations belong to the owner streams in the reference. */
export type WorkspaceOwner = {
  kind: "session" | "task" | "automationRun" | "stewardRun";
  id: string;
};
export type WorkspaceState = "active" | "idle" | "finished" | "merged" | "abandoned";
export type WorkspaceDirectoryState =
  | "present"
  | "pendingRemoval"
  | "removing"
  | "removed"
  | "blocked";

/** S1. IDs are complete identities; shortened naming IDs never establish ownership. Times are epoch ms. */
export interface ManagedWorkspace {
  id: string;
  /** Canonical common Git directory identity, shared by sibling worktrees. */
  repositoryId: string;
  projectId: string;
  environmentId: string;
  owner: WorkspaceOwner;
  path: string;
  branchRef: string;
  baseRef: string;
  /** Immutable committed creation baseline; never a snapshot of another checkout's dirty files. */
  baseCommit: string;
  targetBranchRef: string;
  /** Explicit selected-source or owner-retargeted delivery checkout. */
  targetDirectory?: string;
  state: WorkspaceState;
  directoryState: WorkspaceDirectoryState;
  revision: number;
  lastActivityAt: number;
  finishedAt?: number;
  mergedAt?: number;
  closedAt?: number;
  deliveredCommit?: string;
  featureKey?: string;
  pinned: boolean;
}

/** A positive finite duration in milliseconds, or Never. Active work is never automatically removed. */
export type WorkspaceRetentionPeriod = number | "never";
export interface WorkspacePolicy {
  defaultMode: "worktree" | "current";
  integrationBranchRef: string;
  /** Null selects the existing sibling <repository-name>-worktrees root. Changes affect new workspaces only. */
  root: string | null;
  pinned: boolean;
  retention: Record<Exclude<WorkspaceState, "active">, WorkspaceRetentionPeriod> & {
    active: "never";
  };
  disk: { budgetBytes: number; warningRatio: number; minimumFreeBytes: number };
}
export type WorkspacePolicyOverride = Partial<Omit<WorkspacePolicy, "retention" | "disk">> & {
  retention?: Partial<WorkspacePolicy["retention"]>;
  disk?: Partial<WorkspacePolicy["disk"]>;
};
/** S1 resolves field by field, lowest to highest; nested retention/disk fields merge individually. */
export const WORKSPACE_POLICY_PRECEDENCE = ["host", "project", "owner"] as const;
export interface ResolvedWorkspacePolicy {
  policy: WorkspacePolicy;
  appliedScopes: (typeof WORKSPACE_POLICY_PRECEDENCE)[number][];
}
export const DEFAULT_WORKSPACE_POLICY = {
  defaultMode: "current",
  integrationBranchRef: "refs/heads/main",
  root: null,
  pinned: false,
  retention: {
    active: "never",
    idle: 1_209_600_000,
    finished: 604_800_000,
    merged: 86_400_000,
    abandoned: 604_800_000,
  },
  disk: { budgetBytes: 53_687_091_200, warningRatio: 0.8, minimumFreeBytes: 21_474_836_480 },
} as const satisfies WorkspacePolicy;

export const WORKSPACE_CAPABILITIES = {
  managed: "workspaces.managed.v1",
  policy: "workspaces.policy.v1",
  delivery: "workspaces.delivery.v1",
  prPublication: "workspaces.pr-publication.v1",
  gitRewind: "sessions.git-rewind.v1",
  gitRewindUndo: "sessions.git-rewind-undo.v1",
  lifecycle: "workspaces.lifecycle.v1",
  pinning: "workspaces.pinning.v1",
  buildIdentity: "build.identity.v1",
} as const;
export type WorkspaceCapability =
  (typeof WORKSPACE_CAPABILITIES)[keyof typeof WORKSPACE_CAPABILITIES];
export const WORKSPACE_REF_NAMESPACES = {
  turns: "refs/bycoda/turns/",
  rewinds: "refs/bycoda/rewinds/",
} as const;
export const WORKSPACE_NAMING = {
  sessionBranchPrefix: "bycoda/s/",
  taskBranchPrefix: "bycoda/t/",
  directoryPrefix: "wt-",
  shortIdLength: 12,
} as const;
export type TurnRefPhase = "before-head" | "before-index" | "before-worktree" | "after-head";
export type RewindRefPhase = "rescue-head" | "rescue-index" | "rescue-worktree";
/** S1 implements naming; S2 implements refs. Validate Git ref components, collisions and full ownership.
 * Session/automation/steward owners use s; task owners use t. turnId is the stable accepted userBlockId.
 */
export interface WorkspaceNames {
  branch(
    owner: WorkspaceOwner,
    slug: string,
    workspaceId: string,
  ): `bycoda/${"s" | "t"}/${string}-${string}`;
  directory(workspaceId: string): `wt-${string}`;
  turnRef(
    workspaceId: string,
    turnId: string,
    phase: TurnRefPhase,
  ): `refs/bycoda/turns/${string}/${string}/${TurnRefPhase}`;
  rewindRef(
    operationId: string,
    phase: RewindRefPhase,
  ): `refs/bycoda/rewinds/${string}/${RewindRefPhase}`;
}

/** S1. Live registry claim, not a tracked feature-card lock. Explicit subscopes may coexist. */
export interface WorkspaceFeatureClaim {
  id: string;
  repositoryId: string;
  projectId: string;
  featureKey: string;
  scope?: string;
  workspaceId: string;
  owner: WorkspaceOwner;
  branchRef: string;
  acquiredAt: number;
}
/** Common optimistic-write envelope. Duplicate keys return the original receipt; changed payloads must fail. */
export interface WorkspaceMutation {
  workspaceId: string;
  idempotencyKey: string;
  expectedRevision: number;
}
export interface WorkspaceOperationBase<
  Kind extends string,
  Phase extends string,
> extends WorkspaceMutation {
  id: string;
  kind: Kind;
  phase: Phase;
  /** Required when blocked: last durable phase, retained so recovery can reconcile rather than replay blindly. */
  resumePhase?: Exclude<Phase, "blocked" | "complete">;
  createdAt: number;
  updatedAt: number;
  error?: { code: string; message: string };
}
/** S1. Reserve a stable workspace ID at revision zero before any Git/directory mutation. */
export interface WorkspaceCreateOperation extends WorkspaceOperationBase<
  "create",
  "prepared" | "registered" | "materialized" | "complete" | "blocked"
> {
  plannedWorkspace: ManagedWorkspace;
}

/** S2. Only captured source paths may be removed during restore, after checking their content fingerprint. */
export interface WorkspacePathManifestEntry {
  path: string;
  kind: "file" | "symlink";
  fingerprint: string;
}
export interface TurnGitSnapshot {
  /** Actual commit OID. Index/worktree OIDs may be private commits wrapping trees. */
  head: string;
  index: string;
  worktree: string;
  /** Private exact index metadata; a tree alone cannot preserve staging flags. Never expose file contents. */
  indexMetadataId: string;
  paths: WorkspacePathManifestEntry[];
  capturedAt: number;
}
/** Complete covers tracked/nonignored source and exact index metadata. Unsupported sparse/unresolved index,
 * nested repos/submodules, unsafe reparse points and uncaptured user inputs must yield blocked.
 * Generated caches are excluded; ignored source/secrets need private capture, never accidental Git refs.
 */
export type TurnGitCapture =
  | { status: "complete"; snapshot: TurnGitSnapshot }
  | { status: "blocked"; reason: string };
export interface TurnGitRecord {
  workspaceId: string;
  sessionId: string;
  /** Also the turn component in retained refs; never the provider run ID. */
  userBlockId: string;
  runId: string;
  conversationRevision: number;
  branchRef: string;
  before: TurnGitCapture;
  after?: TurnGitCapture;
}
export interface SessionRewindPlan {
  token: string;
  expiresAt: number;
  direction: "rewind" | "undo";
  /** Required for undo; points to the original durable rewind operation. */
  rescueOperationId?: string;
  workspaceId: string;
  sessionId: string;
  userBlockId: string;
  expectedRevision: number;
  expectedConversationRevision: number;
  branchRef: string;
  currentHead: string;
  targetHead: string;
  /** Covers current index/worktree/manifests as well as HEAD; revalidate immediately before mutation. */
  statusFingerprint: string;
  removedUserBlockIds: string[];
  affectedCommits: string[];
  affectedPaths: string[];
  /** Nonempty blockers make the plan non-applicable, including uncaptured/unsupported source state. */
  blockers: string[];
  /** Rewind is local; published refs and a previously merged integration branch are unchanged. */
  published: boolean;
  merged: boolean;
}
export interface SessionRewindReceipt {
  operationId: string;
  workspaceId: string;
  sessionId: string;
  direction: "rewind" | "undo";
  workspaceRevision: number;
  conversationRevision: number;
  head: string;
  /** The original operation can be previewed for undo; later drift requires a fresh plan. */
  undoOperationId?: string;
}
/** S2. Persist transcript + all rescue refs before restore. Block writes until cross-store reconciliation. */
export interface WorkspaceRewindOperation extends WorkspaceOperationBase<
  "rewind",
  "prepared" | "git-restored" | "conversation-restored" | "complete" | "blocked"
> {
  plan: SessionRewindPlan;
  rescue?: TurnGitSnapshot;
  transcriptRescueId?: string;
  receipt?: SessionRewindReceipt;
}

/** S3. Opaque token is host-stored, short-lived and bound to every review field, including publication text. */
export type BranchDeliveryPlan = {
  token: string;
  expiresAt: number;
  workspaceId: string;
  expectedRevision: number;
  sourceBranchRef: string;
  sourceHead: string;
  targetBranchRef: string;
  /** Older Hosts may omit this; acceptance bound to a checkout must reject its absence. */
  targetDirectory?: string;
  targetHead: string;
  targetStatusFingerprint: string;
  commits: string[];
  changedPaths: string[];
  overlappingPaths: string[];
  checks: { name: string; status: "passed" | "failed" | "unknown" }[];
  visualEvidence: string[];
  blockers: string[];
} & (
  | { action: "merge" }
  | {
      action: "publish";
      publication: {
        repository: string;
        remote: string;
        baseBranchRef: string;
        headBranchRef: string;
        title: string;
        body: string;
      };
    }
);
export interface BranchMergeReceipt {
  operationId: string;
  workspaceId: string;
  sourceHead: string;
  previousTargetHead: string;
  targetHead: string;
  workspaceRevision: number;
}
export interface BranchPushReceipt {
  remote: string;
  branchRef: string;
  sourceHead: string;
  pushedAt: number;
}
export interface BranchPrReceipt {
  repository: string;
  number: number;
  url: string;
  sourceHead: string;
  createdAt: number;
}
export interface BranchPublicationReceipt {
  operationId: string;
  workspaceId: string;
  /** Preserve push receipt even when PR creation fails; resume/reconcile, never blindly republish. */
  push?: BranchPushReceipt;
  pullRequest?: BranchPrReceipt;
  status: "complete" | "pending" | "blocked";
}
export interface WorkspaceDeliveryOperation extends WorkspaceOperationBase<
  "delivery",
  "prepared" | "merged" | "pushed" | "pr-created" | "complete" | "blocked"
> {
  plan: BranchDeliveryPlan;
  merge?: BranchMergeReceipt;
  publication?: BranchPublicationReceipt;
}

/** S4. Every process start/editor writer and destructive service participates in one reservation gate. */
export interface WorkspaceActivity {
  id: string;
  workspaceId: string;
  kind: "provider" | "shell" | "editor" | "devServer" | "readLease" | "mutation" | "operation";
  ownerId: string;
  startedAt: number;
  dirtyBuffer?: boolean;
}
export interface WorkspaceReservation {
  id: string;
  workspaceId: string;
  operationId: string;
  purpose: "rewind" | "delivery" | "removal";
  expectedRevision: number;
  acquiredAt: number;
}
export interface WorkspaceCleanupPlan {
  token: string;
  expiresAt: number;
  workspaceId: string;
  expectedRevision: number;
  path: string;
  branchRef: string;
  head: string;
  statusFingerprint: string;
  dirty: boolean;
  preservationRequired: boolean;
  blockers: string[];
  /** No-follow inventory. Unknown/unsafe reparse entries block removal, rather than being traversed. */
  links: { path: string; kind: "dependencyJunction" | "dependencySymlink" | "unsafe" }[];
}
export interface WorkspaceRemovalReceipt {
  operationId: string;
  workspaceId: string;
  directoryState: WorkspaceDirectoryState;
  workspaceRevision: number;
  retainedBranchRef: string;
  recoveryIds: string[];
  evidenceArchivePath?: string;
}
/** S4. Phase order is reserve, detach links, preserve, Git remove, reconcile. Branch/refs are never deleted. */
export interface WorkspaceRemovalOperation extends WorkspaceOperationBase<
  "removal",
  | "prepared"
  | "reserved"
  | "links-detached"
  | "evidence-preserved"
  | "git-removed"
  | "reconciled"
  | "complete"
  | "blocked"
> {
  plan: WorkspaceCleanupPlan;
  reservationId?: string;
  recoveryIds: string[];
  receipt?: WorkspaceRemovalReceipt;
}
export type WorkspaceOperation =
  | WorkspaceCreateOperation
  | WorkspaceRewindOperation
  | WorkspaceDeliveryOperation
  | WorkspaceRemovalOperation;
export interface WorkspaceStorageStatus {
  root: string;
  /** Null means unknown measurement, never zero. Shared hardlinked content is not counted twice. */
  materializedBytes: number | null;
  sharedCacheBytes: number | null;
  recoveryBytes: number | null;
  freeBytes: number | null;
  budgetBytes: number;
  warningRatio: number;
  minimumFreeBytes: number;
  materialization: "allowed" | "paused" | "unknown";
  requiredFreeBytes: number | null;
}

/** S6. Bootstrap owns workspace dependencies, not a junction to another checkout's node_modules. */
export interface WorkspaceBootstrapStatus {
  id: string;
  workspaceId: string;
  lockfileFingerprint: string;
  state: "pending" | "installing" | "waitingForBuildCache" | "ready" | "cancelled" | "failed";
  error?: { code: string; message: string };
}
export type WorkspacePortKind = "vite" | "hmr" | "host" | "cdp";
export interface WorkspacePortLease {
  id: string;
  workspaceId: string;
  runId: string;
  ports: Partial<Record<WorkspacePortKind, number>>;
}
/** S6. Allocated before launch; propagate URL to Vite, Tauri devUrl and CSP together. */
export interface WorkspaceDevEnvironment {
  workspaceId: string;
  runId: string;
  ports: WorkspacePortLease;
  devUrl: string;
  hostDataPath: string;
  desktopDataPath: string;
  cargoTargetDir: string;
  executableRunDir: string;
  instanceId: string;
}
export const BUILD_IDENTITY_SCHEMA_VERSION = 1;
/** S6. One immutable manifest captured with frozen bytes. Absent identity means unknown source. */
export interface BuildIdentity {
  schemaVersion: typeof BUILD_IDENTITY_SCHEMA_VERSION;
  buildId: string;
  version: string;
  channel: string;
  mode: string;
  repositoryId: string;
  branch: string;
  head: string;
  sourceFingerprint: string;
  /** Repository-relative paths with Git status codes; no credentials or source contents. */
  dirtyPaths: { path: string; status: string }[];
  capturedAt: number;
  components: { web: string; native: string; host: string };
  includedSources: { repositoryId: string; sourceHead: string; deliveryCommit?: string }[];
}
