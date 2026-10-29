import { z } from "zod";
import { JsonObjectSchema, SafeCounterSchema } from "./schemas";
import {
  NativeBufferOwnerSnapshotSchema,
  NativeBufferRecoveryListParamsSchema,
  NativeBufferRecoverySourceSchema,
  NativeBufferRecoveryPageSchema,
  NativeBufferRecoveryReadSchema,
  NativeBufferRecoveryStatusSchema,
} from "./native-buffer-recovery";

// Identity, canonical path, byte, unique-boundary and durable-owner checks remain
// in the existing Host services. These DTOs confer no Native execution authority.
const identity = z.string();
const counter = SafeCounterSchema;
const direction = z.enum(["rewind", "undo"]);
const mutation = {
  workspaceId: identity,
  idempotencyKey: identity,
  expectedRevision: counter,
};
const turn = {
  workspaceId: identity,
  sessionId: identity,
  userBlockId: identity,
  runId: identity,
};
export const NativeTurnBeginParamsSchema = z.strictObject({
  ...turn,
  conversationRevision: counter,
});
export const NativeTurnEndParamsSchema = z.strictObject({
  ...turn,
  // Native sends the original accepted begin envelope at completion.
  conversationRevision: counter.optional(),
});
export const NativeActivityStartParamsSchema = z.strictObject({
  activityId: identity,
  cwd: z.string(),
  kind: z.enum(["provider", "shell", "terminal"]),
  sessionId: identity.optional(),
});
export const NativeActivityEndParamsSchema = z.strictObject({ activityId: identity });
export const NativeBufferUpdateParamsSchema = z.strictObject({
  clientId: identity,
  instanceId: identity,
  processId: counter.min(1),
  owners: z.array(NativeBufferOwnerSnapshotSchema).max(1000),
});
export const NativeBufferRetireParamsSchema = z.strictObject({
  clientId: identity,
  instanceId: identity,
  processId: counter.min(1),
});
export const NativeBufferReconcileParamsSchema = z.strictObject({
  clientId: identity,
  instanceId: identity,
  predecessors: z.array(z.strictObject({ instanceId: identity, processId: counter.min(1) })),
});
const boundary = z.strictObject({
  revision: counter,
  userBlockIds: z.array(identity).max(100_000),
});
const rewindPlanBase = {
  authorityGeneration: counter.optional(),
  workspaceId: identity,
  sessionId: identity,
  expectedRevision: counter,
  expectedConversationRevision: counter,
};
export const NativeRewindPlanParamsSchema = z.strictObject({
  request: z.union([
    z.strictObject({ ...rewindPlanBase, direction: z.literal("rewind"), userBlockId: identity }),
    z.strictObject({ ...rewindPlanBase, direction: z.literal("undo"), operationId: identity }),
  ]),
  conversation: boundary,
});
const rewindMutation = z.strictObject({
  ...mutation,
  authorityGeneration: counter.optional(),
  sessionId: identity,
  expectedConversationRevision: counter,
  planToken: identity,
});
export const NativeRewindPrepareParamsSchema = z.strictObject({
  request: rewindMutation,
  direction,
  conversation: boundary,
});
export const NativeRewindApplyParamsSchema = z.strictObject({
  operationId: identity,
  request: rewindMutation,
  direction,
  transcriptRescueId: identity,
});
export const NativeRewindKeyParamsSchema = z.strictObject({
  workspaceId: identity,
  sessionId: identity,
  idempotencyKey: identity,
});
export const NativeRewindStatusParamsSchema = z.strictObject({ operationId: identity });
export const NativeRewindAckParamsSchema = z.strictObject({
  operationId: identity,
  receipt: z.strictObject({ revision: counter }),
});
export const WorkspaceCleanupPlanParamsSchema = z.strictObject({
  workspaceId: identity,
  expectedRevision: counter,
});
export const WorkspaceCleanupApplyParamsSchema = z.strictObject({
  ...mutation,
  planToken: identity,
});
export const WorkspaceCleanupStatusParamsSchema = z.strictObject({
  workspaceId: identity,
  operationId: identity.optional(),
});

const directoryState = z.enum(["present", "pendingRemoval", "removing", "removed", "blocked"]);
export const ManagedWorkspaceSchema = z.strictObject({
  id: identity,
  repositoryId: identity,
  projectId: identity,
  environmentId: identity,
  owner: z.strictObject({
    kind: z.enum(["session", "task", "automationRun", "stewardRun"]),
    id: identity,
  }),
  path: z.string(),
  branchRef: z.string(),
  baseRef: z.string(),
  baseCommit: z.string(),
  targetBranchRef: z.string(),
  targetDirectory: z.string().optional(),
  state: z.enum(["active", "idle", "finished", "merged", "abandoned"]),
  directoryState,
  revision: counter,
  lastActivityAt: counter,
  finishedAt: counter.optional(),
  mergedAt: counter.optional(),
  closedAt: counter.optional(),
  deliveredCommit: z.string().optional(),
  featureKey: z.string().optional(),
  pinned: z.boolean(),
});
const capture = z.union([
  z.strictObject({ status: z.literal("blocked"), reason: z.string() }),
  z.strictObject({
    status: z.literal("complete"),
    snapshot: z.strictObject({
      head: z.string(),
      index: z.string(),
      worktree: z.string(),
      indexMetadataId: identity,
      paths: z.array(
        z.strictObject({
          path: z.string(),
          kind: z.enum(["file", "symlink"]),
          fingerprint: z.string(),
        }),
      ),
      capturedAt: counter,
    }),
  }),
]);
export const NativeTurnRecordSchema = z.strictObject({
  ...turn,
  conversationRevision: counter,
  branchRef: z.string(),
  before: capture,
  after: capture.optional(),
});
export const NativeRewindPlanSchema = z.strictObject({
  ...rewindPlanBase,
  token: identity,
  expiresAt: counter,
  direction,
  rescueOperationId: identity.optional(),
  userBlockId: identity,
  branchRef: z.string(),
  currentHead: z.string(),
  targetHead: z.string(),
  statusFingerprint: z.string(),
  removedUserBlockIds: z.array(identity),
  affectedCommits: z.array(z.string()),
  affectedPaths: z.array(z.string()),
  blockers: z.array(z.string()),
  published: z.boolean(),
  merged: z.boolean(),
});
const rewindReceipt = z.strictObject({
  authorityGeneration: counter.optional(),
  operationId: identity,
  workspaceId: identity,
  sessionId: identity,
  direction,
  workspaceRevision: counter,
  conversationRevision: counter,
  head: z.string(),
  undoOperationId: identity.optional(),
});
const prepared = z.strictObject({
  operationId: identity,
  workspaceId: identity,
  sessionId: identity,
  direction,
  expectedConversationRevision: counter,
});
const rewindPhase = z.enum([
  "prepared",
  "git-restored",
  "conversation-restored",
  "complete",
  "blocked",
]);
export const NativeRewindStatusSchema = z.strictObject({
  operationId: identity,
  phase: rewindPhase,
  finalized: z.boolean(),
  receipt: rewindReceipt.optional(),
  restoreRequest: z
    .strictObject({
      operationId: identity,
      sessionId: identity,
      userBlockId: identity,
      direction,
      transcriptRescueId: identity.optional(),
      expectedRevision: counter,
    })
    .optional(),
});
export const WorkspaceCleanupPlanSchema = z.strictObject({
  token: identity,
  expiresAt: counter,
  workspaceId: identity,
  expectedRevision: counter,
  path: z.string(),
  branchRef: z.string(),
  head: z.string(),
  statusFingerprint: z.string(),
  dirty: z.boolean(),
  preservationRequired: z.boolean(),
  blockers: z.array(z.string()),
  links: z.array(
    z.strictObject({
      path: z.string(),
      kind: z.enum(["dependencyJunction", "dependencySymlink", "unsafe"]),
    }),
  ),
});
export const WorkspaceCleanupReceiptSchema = z.strictObject({
  operationId: identity,
  workspaceId: identity,
  directoryState,
  workspaceRevision: counter,
  retainedBranchRef: z.string(),
  recoveryIds: z.array(identity),
  evidenceArchivePath: z.string().optional(),
});
const acknowledged = z.strictObject({ acknowledged: z.literal(true) });
export const NATIVE_WORKSPACE_RPC_SCHEMAS = {
  "native.turn.begin": { params: NativeTurnBeginParamsSchema, result: NativeTurnRecordSchema },
  "native.turn.end": { params: NativeTurnEndParamsSchema, result: NativeTurnRecordSchema },
  "native.activity.start": {
    params: NativeActivityStartParamsSchema,
    result: z.strictObject({ activityId: identity, workspaceId: identity }),
  },
  "native.activity.end": { params: NativeActivityEndParamsSchema, result: acknowledged },
  "native.buffers.update": { params: NativeBufferUpdateParamsSchema, result: acknowledged },
  "native.buffers.retire": { params: NativeBufferRetireParamsSchema, result: acknowledged },
  "native.buffers.reconcile": { params: NativeBufferReconcileParamsSchema, result: acknowledged },
  "native.buffers.recovery.list": {
    params: NativeBufferRecoveryListParamsSchema,
    result: NativeBufferRecoveryPageSchema,
  },
  "native.buffers.recovery.read": {
    params: NativeBufferRecoverySourceSchema,
    result: NativeBufferRecoveryReadSchema,
  },
  "native.buffers.recovery.status": {
    params: NativeBufferRecoverySourceSchema,
    result: NativeBufferRecoveryStatusSchema,
  },
  "native.rewind.plan": { params: NativeRewindPlanParamsSchema, result: NativeRewindPlanSchema },
  "native.rewind.prepare": { params: NativeRewindPrepareParamsSchema, result: prepared },
  "native.rewind.apply": {
    params: NativeRewindApplyParamsSchema,
    result: z.strictObject({ operationId: identity, phase: rewindPhase }),
  },
  "native.rewind.status": {
    params: NativeRewindStatusParamsSchema,
    result: NativeRewindStatusSchema,
  },
  "native.rewind.lookup": { params: NativeRewindKeyParamsSchema, result: prepared.nullable() },
  "native.rewind.cancelPreparation": {
    params: NativeRewindKeyParamsSchema,
    result: z.union([
      z.strictObject({ ...NativeRewindKeyParamsSchema.shape, cancelled: z.literal(true) }),
      z.strictObject({
        ...NativeRewindKeyParamsSchema.shape,
        cancelled: z.literal(false),
        operation: prepared,
      }),
    ]),
  },
  "native.rewind.ack": {
    params: NativeRewindAckParamsSchema,
    result: z.strictObject({
      operationId: identity,
      acknowledged: z.literal(true),
      finalized: z.literal(true),
      receipt: rewindReceipt,
    }),
  },
  "workspaces.cleanup.plan": {
    params: WorkspaceCleanupPlanParamsSchema,
    result: WorkspaceCleanupPlanSchema,
  },
  "workspaces.cleanup.apply": {
    params: WorkspaceCleanupApplyParamsSchema,
    result: WorkspaceCleanupReceiptSchema,
  },
  "workspaces.cleanup.status": {
    params: WorkspaceCleanupStatusParamsSchema,
    // Existing status includes heterogeneous durable operation journals. Keep
    // every journal field; schema extraction must not truncate recovery state.
    result: z.strictObject({
      workspace: ManagedWorkspaceSchema,
      operations: z.array(JsonObjectSchema),
    }),
  },
} as const;
export type NativeWorkspaceMethod = keyof typeof NATIVE_WORKSPACE_RPC_SCHEMAS;
export const NATIVE_WORKSPACE_METHODS = Object.freeze(
  Object.keys(NATIVE_WORKSPACE_RPC_SCHEMAS) as NativeWorkspaceMethod[],
);
export function nativeWorkspaceMethod(method: string): method is NativeWorkspaceMethod {
  return Object.prototype.hasOwnProperty.call(NATIVE_WORKSPACE_RPC_SCHEMAS, method);
}
/** Retry names never override effect ownership or authorize Native ingress. */
export function nativeWorkspaceReadOnly(method: NativeWorkspaceMethod): boolean {
  return (
    method.startsWith("native.buffers.recovery.") ||
    method === "native.rewind.lookup" ||
    method === "workspaces.cleanup.plan" ||
    method === "workspaces.cleanup.status"
  );
}
