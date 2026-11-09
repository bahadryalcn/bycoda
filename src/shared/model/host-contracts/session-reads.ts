import { z } from "zod";
import type { HostRpcMethodDefinition } from "./methods";
import { DelegationParentSchema } from "./delegation";
import { IdentifierSchema, JsonObjectSchema, SafeCounterSchema } from "./schemas";
import { SessionProviderSchema, SessionRuntimeModeSchema } from "./session-commands";

export const SessionsListParamsSchema = z.strictObject({
  projectId: IdentifierSchema,
  parentSessionId: IdentifierSchema.optional(),
  known: z.string().optional(),
});
export const SessionsPageParamsSchema = z.strictObject({
  sessionId: IdentifierSchema,
  before: SafeCounterSchema.optional(),
  revision: SafeCounterSchema.optional(),
  preview: z.boolean().optional(),
  digests: z.boolean().optional(),
});
export const SessionsSyncParamsSchema = z.strictObject({
  sessionId: IdentifierSchema,
  sourceEpoch: IdentifierSchema.optional(),
  preview: z.boolean().optional(),
  revision: SafeCounterSchema.optional(),
  waitMs: SafeCounterSchema.max(30_000).optional(),
  partial: z.boolean().optional(),
  loadedBlockIds: z.array(z.string()).max(32_768).optional(),
  digests: z.boolean().optional(),
});
export const SessionsSyncChunkParamsSchema = z.strictObject({
  sessionId: IdentifierSchema,
  transfer: IdentifierSchema,
  offset: SafeCounterSchema,
});
export const SessionsBlockParamsSchema = z.strictObject({
  sessionId: IdentifierSchema,
  blockId: z.string(),
  revision: SafeCounterSchema,
});
export const SessionReferenceLocatorSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("host"),
    environmentId: IdentifierSchema,
    sessionId: IdentifierSchema,
  }),
  z.strictObject({
    kind: z.literal("native"),
    sourceStoreId: IdentifierSchema,
    sourceProfileId: IdentifierSchema,
    sessionId: IdentifierSchema,
  }),
]);
export type SessionReferenceLocator = z.infer<typeof SessionReferenceLocatorSchema>;
export const SessionsGetParamsSchema = z.strictObject({
  sessionId: IdentifierSchema,
  reference: SessionReferenceLocatorSchema.optional(),
  revision: SafeCounterSchema.optional(),
  preview: z.boolean().optional(),
  summary: z.boolean().optional(),
});
export const ConversationHeadSchema = z.strictObject({
  count: SafeCounterSchema,
  chain: z.string(),
});
const history = z.strictObject({
  before: SafeCounterSchema.optional(),
  revision: SafeCounterSchema,
  totalBlocks: SafeCounterSchema,
});
const metadata = {
  sourceEpoch: IdentifierSchema.optional(),
  authorityGeneration: SafeCounterSchema.min(1).optional(),
  history: history.optional(),
  historyLoading: z.boolean().optional(),
  projectId: IdentifierSchema,
  revision: SafeCounterSchema,
  runId: IdentifierSchema.optional(),
  runActivity: z
    .strictObject({ runId: IdentifierSchema, lastActivityAt: SafeCounterSchema })
    .optional(),
  status: z.enum(["idle", "running", "interrupted"]),
  executionOwner: z.enum(["host", "desktop"]).optional(),
  createdAt: SafeCounterSchema.optional(),
  updatedAt: SafeCounterSchema,
  lastActivityAt: SafeCounterSchema.optional(),
  archived: z.boolean().optional(),
  pinned: z.boolean().optional(),
  autoWorktreeBranch: z.string().optional(),
  head: ConversationHeadSchema.optional(),
  /** Set on sessions the assistant started or supervises (`AssistantSessionManagement`). */
  managedBy: z
    .strictObject({
      assistant: z.literal(true),
      managedAt: SafeCounterSchema,
      detachedAt: SafeCounterSchema.optional(),
      jobId: IdentifierSchema.optional(),
      supervisionId: IdentifierSchema.optional(),
    })
    .optional(),
};
/**
 * Read boundary only: legacy Session/Block projections contain many feature-owned
 * extensions. They remain opaque JSON while their full canonical DTOs migrate.
 * This does not authorize generic JSON input for any mutation.
 */
export const SessionViewSchema = z.strictObject({
  ...metadata,
  session: JsonObjectSchema,
  blockRevisions: z.record(z.string(), SafeCounterSchema).optional(),
  desktop: z
    .strictObject({
      updatedAt: SafeCounterSchema,
      revision: SafeCounterSchema.optional(),
      base: ConversationHeadSchema.optional(),
    })
    .optional(),
});
/** Why an idle or yielded session is still expected to continue (see sessionWaitRules). */
export const SessionWaitSchema = z.strictObject({
  kind: z.enum(["commands", "agents", "tasks", "delegated", "pull-request"]),
  count: SafeCounterSchema,
  since: SafeCounterSchema.optional(),
  label: z.string().max(2_000).optional(),
});
/** Something the Host holds that will message the session later; gone when it ends. */
export const SessionWakeSourceSchema = z.strictObject({
  kind: z.literal("pull-request"),
  label: z.string().max(300),
  since: SafeCounterSchema.optional(),
  until: SafeCounterSchema.optional(),
});
export const SessionSummarySchema = z.strictObject({
  ...metadata,
  id: IdentifierSchema,
  delegationParent: DelegationParentSchema.nullable().optional(),
  title: z.string(),
  harness: SessionProviderSchema,
  providerHistory: z
    .strictObject({
      providers: z.array(SessionProviderSchema),
      activeHarness: SessionProviderSchema,
      activeModel: z.string().optional(),
      handedOffFrom: SessionProviderSchema.optional(),
    })
    .optional(),
  issue: z.enum(["retrying", "failed"]).optional(),
  issueTurnId: z.string().optional(),
  issueMessage: z.string().optional(),
  cwd: z.string().optional(),
  model: z.string().optional(),
  runtimeMode: SessionRuntimeModeSchema.optional(),
  providerSessionId: z.string().nullable().optional(),
  linkedWorkItem: z
    .strictObject({
      kind: z.enum(["issue", "pr"]),
      repo: z.string(),
      number: SafeCounterSchema,
      url: z.string(),
    })
    .optional(),
  needsInput: z.boolean().optional(),
  /** Host-run turn held open by background work, or delegated children still running. */
  waiting: SessionWaitSchema.optional(),
  wakeSources: z.array(SessionWakeSourceSchema).max(10).optional(),
  branch: z.string().optional(),
  workspaceId: IdentifierSchema.optional(),
  workspaceRevision: SafeCounterSchema.optional(),
  worktreeCwd: z.string().optional(),
  repo: z.string().optional(),
  draft: z.boolean().optional(),
  origin: z.literal("desktop").optional(),
});
export const SessionsListResultSchema = z.union([
  z.array(SessionSummarySchema),
  z.strictObject({ unchanged: z.literal(true), etag: z.string() }),
  z.strictObject({ etag: z.string(), sessions: z.array(SessionSummarySchema) }),
]);
export const SessionSyncSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("unchanged"),
    revision: SafeCounterSchema,
    sourceEpoch: IdentifierSchema.optional(),
  }),
  z.strictObject({ kind: z.literal("snapshot"), value: SessionViewSchema }),
  z.strictObject({
    kind: z.literal("delta"),
    partial: z.literal(true).optional(),
    base: SafeCounterSchema,
    value: z.strictObject({
      ...metadata,
      session: JsonObjectSchema,
      desktop: SessionViewSchema.shape.desktop,
    }),
    blockIds: z.array(z.string()),
    blocks: z.array(JsonObjectSchema),
  }),
]);
export const SessionSyncTransferSchema = z.strictObject({
  kind: z.literal("chunked"),
  sourceEpoch: IdentifierSchema.optional(),
  transfer: IdentifierSchema,
  length: SafeCounterSchema,
});
export const SessionSyncResponseSchema = z.union([SessionSyncSchema, SessionSyncTransferSchema]);
export const SessionsPageResultSchema = z.strictObject({
  before: SafeCounterSchema.optional(),
  totalBlocks: SafeCounterSchema,
  revision: SafeCounterSchema,
  sync: SessionSyncResponseSchema,
});
export const SessionsSyncChunkResultSchema = z.strictObject({ data: z.string() });
export type SessionsListParams = z.infer<typeof SessionsListParamsSchema>;
export type SessionsPageParams = z.infer<typeof SessionsPageParamsSchema>;
export type SessionsSyncParams = z.infer<typeof SessionsSyncParamsSchema>;
export type SessionView = z.infer<typeof SessionViewSchema>;
export type SessionSummary = z.infer<typeof SessionSummarySchema>;
export type SessionsListResult = z.infer<typeof SessionsListResultSchema>;
export type SessionsPageResult = z.infer<typeof SessionsPageResultSchema>;
export type SessionSync = z.infer<typeof SessionSyncSchema>;
export type SessionSyncResponse = z.infer<typeof SessionSyncResponseSchema>;

export const SessionsWorkedTimeParamsSchema = z.strictObject({ sessionId: IdentifierSchema });
/** Sum of finished turns' working time; a running turn is added by the reader. */
export const SessionWorkedTimeSchema = z.strictObject({ workedMs: SafeCounterSchema });

/** Transcript reads; the caller passes its session-read builder in. */
export function sessionReadMethods(
  sessionRead: (params: z.ZodType, result?: z.ZodType) => HostRpcMethodDefinition,
) {
  return {
    "sessions.list": sessionRead(SessionsListParamsSchema, SessionsListResultSchema),
    "sessions.page": sessionRead(SessionsPageParamsSchema, SessionsPageResultSchema),
    "sessions.sync": sessionRead(SessionsSyncParamsSchema, SessionSyncResponseSchema),
    "sessions.syncChunk": sessionRead(SessionsSyncChunkParamsSchema, SessionsSyncChunkResultSchema),
    "sessions.get": sessionRead(SessionsGetParamsSchema, SessionViewSchema.nullable()),
    "sessions.block": sessionRead(SessionsBlockParamsSchema),
    "sessions.workedTime": sessionRead(SessionsWorkedTimeParamsSchema, SessionWorkedTimeSchema),
  };
}
