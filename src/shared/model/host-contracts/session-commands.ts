import { z } from "zod";
import { IdentifierSchema, SafeCounterSchema } from "./schemas";

/** Provider identifiers on the existing Host wire, independent of UI harness state. */
export const SessionProviderSchema = z.enum([
  "codex",
  "claude",
  "cursor",
  "grok",
  "opencode",
  "pi",
  "omp",
  "fx",
  "hermes",
  "antigravity",
  "acp",
]);
export const SessionRuntimeModeSchema = z.enum([
  "supervised",
  "auto-accept-edits",
  "auto",
  "full-access",
]);
// Text bounds, account/model validation and cross-field rules remain domain admission
// checks. The transport's byte budget bounds frames; no UTF-16 length refinement is
// silently exported as JSON Schema's different Unicode maxLength semantics.
const text = z.string();
export const ModelSettingsSchema = z.record(z.string(), text);
export const BrowserAnnotationAttachmentSchema = z.strictObject({
  id: text,
  projectId: text,
  sessionId: text,
  navigationId: text,
  capturedAt: text,
  pageUrl: text,
  viewport: z.strictObject({
    width: z.number(),
    height: z.number(),
    scrollX: z.number(),
    scrollY: z.number(),
  }),
  devicePixelRatio: z.number(),
  element: z.strictObject({
    tag: text,
    text,
    selector: text,
    path: text,
    bounds: z.strictObject({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
    center: z.strictObject({ x: z.number(), y: z.number() }),
    ancestry: z.array(z.strictObject({ tag: text, selectorPart: text })),
    computedStyle: z.record(text, text),
  }),
  trust: z.literal("untrusted-page-data"),
  limitations: z.array(text),
  comment: text,
});
export const RemoteAttachmentSchema = z.strictObject({
  browserAnnotation: BrowserAnnotationAttachmentSchema.optional(),
  id: IdentifierSchema,
  name: text,
  mimeType: text,
  kind: z.enum(["image", "audio", "file"]),
  size: SafeCounterSchema,
});
export const NoteComposerCardSchema = z.strictObject({
  id: text,
  slug: text,
  title: text,
  sourceCwd: text.optional(),
  body: text,
});
export const SecondOpinionSchema = z.strictObject({
  from: SessionProviderSchema,
  to: SessionProviderSchema,
  request: text.optional(),
  files: SafeCounterSchema.max(40).optional(),
  kind: z.literal("handoff").optional(),
});
export const UserQuestionReplySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("skipped") }),
  z.strictObject({
    kind: z.literal("answered"),
    answers: z.record(text, z.array(text).max(50)),
    custom: z.record(text, text).optional(),
  }),
]);
const authority = { authorityGeneration: SafeCounterSchema.min(1).optional() };
const commandBase = { commandId: IdentifierSchema, sessionId: IdentifierSchema, ...authority };
export const QueuedCommandReferenceSchema = z.strictObject({
  id: IdentifierSchema,
  clientId: IdentifierSchema,
  revision: SafeCounterSchema,
  selected: z.boolean().optional(),
  leaseAware: z.boolean().optional(),
  epoch: SafeCounterSchema.optional(),
});
const queued = { queued: QueuedCommandReferenceSchema.optional() };
const prompt = { text, attachments: z.array(RemoteAttachmentSchema).max(20).optional() };
export const SendCommandSchema = z.strictObject({
  ...commandBase,
  ...queued,
  type: z.literal("send"),
  ...prompt,
  resumeAtReset: z.boolean().optional(),
  intent: z.enum(["default", "plan", "build"]).optional(),
  draftBlockId: IdentifierSchema.optional(),
  planBlockId: IdentifierSchema.optional(),
  secondOpinion: SecondOpinionSchema.optional(),
  noteCard: NoteComposerCardSchema.optional(),
  expectedPlanText: text.optional(),
});
export const DraftCommandSchema = z.strictObject({
  ...commandBase,
  ...queued,
  type: z.literal("draft"),
  ...prompt,
});
/** A nested first turn inherits the outer reserved session ID or Host allocation.
 * Its deprecated sessionId field is a legacy placeholder and never selects the
 * target. Standalone send/draft commands require their own explicit identity. */
export const CreateFirstTurnSchema = z.discriminatedUnion("type", [
  SendCommandSchema.extend({ sessionId: z.union([IdentifierSchema, z.literal("")]).optional() }),
  DraftCommandSchema.extend({ sessionId: z.union([IdentifierSchema, z.literal("")]).optional() }),
]);
export const ContextualSessionInputSchema = z.strictObject({
  sessionId: IdentifierSchema,
  sourceBlockId: IdentifierSchema,
  expectedRevision: SafeCounterSchema,
  mode: z.enum(["handoff", "secondOpinion"]),
  harness: SessionProviderSchema,
  model: text,
  modelSettings: ModelSettingsSchema,
});
export const CommandDispatchParamsSchema = z.discriminatedUnion("type", [
  SendCommandSchema,
  DraftCommandSchema,
  z.strictObject({
    ...commandBase,
    ...queued,
    type: z.literal("steer"),
    runId: IdentifierSchema,
    ...prompt,
  }),
  z.strictObject({
    commandId: IdentifierSchema,
    ...authority,
    ...queued,
    type: z.literal("create"),
    projectId: IdentifierSchema,
    sessionId: IdentifierSchema.optional(),
    workspaceId: IdentifierSchema.optional(),
    workspaceMode: z.enum(["current", "worktree"]).optional(),
    worktreeCwd: text.optional(),
    autoWorktreeBranch: text.optional(),
    harness: SessionProviderSchema,
    providerAccountId: text.optional(),
    model: text,
    modelSettings: ModelSettingsSchema.optional(),
    runtimeMode: SessionRuntimeModeSchema,
    firstTurn: CreateFirstTurnSchema.optional(),
  }),
  z.strictObject({
    ...commandBase,
    ...queued,
    type: z.literal("configure"),
    harness: SessionProviderSchema.optional(),
    providerAccountId: text.nullable().optional(),
    model: text,
    modelSettings: ModelSettingsSchema,
    runtimeMode: SessionRuntimeModeSchema,
  }),
  z.strictObject({
    ...commandBase,
    ...queued,
    ...ContextualSessionInputSchema.shape,
    type: z.literal("contextual"),
    previewDigest: text,
  }),
  z.strictObject({
    ...commandBase,
    ...queued,
    type: z.literal("compact"),
    resumeAtReset: z.boolean().optional(),
  }),
  z.strictObject({
    ...commandBase,
    ...queued,
    type: z.literal("removeDraft"),
    draftBlockId: IdentifierSchema,
  }),
  z.strictObject({
    ...commandBase,
    ...queued,
    type: z.literal("rewind"),
    blockId: IdentifierSchema,
    expectedRevision: SafeCounterSchema.optional(),
  }),
  z.strictObject({ ...commandBase, ...queued, type: z.literal("shell"), line: text }),
  z.strictObject({
    ...commandBase,
    ...queued,
    type: z.literal("usageLimit"),
    action: z.enum(["arm", "disarm", "dismiss"]),
  }),
  z.strictObject({ ...commandBase, ...queued, type: z.literal("cancel"), runId: IdentifierSchema }),
  z.strictObject({
    ...commandBase,
    ...queued,
    type: z.literal("stopItem"),
    runId: IdentifierSchema,
    blockId: IdentifierSchema,
    callId: IdentifierSchema,
  }),
  z.strictObject({
    ...commandBase,
    ...queued,
    type: z.literal("approve"),
    runId: IdentifierSchema,
    requestId: SafeCounterSchema,
    decision: z.enum(["allow", "deny"]),
  }),
  z.strictObject({
    ...commandBase,
    ...queued,
    type: z.literal("answer"),
    runId: IdentifierSchema,
    requestId: SafeCounterSchema,
    reply: UserQuestionReplySchema,
  }),
]);
/** Structural wire validation; engine admission still enforces semantic policy. */
export const CommandSchema = CommandDispatchParamsSchema;
export type SessionCommand = z.infer<typeof CommandDispatchParamsSchema>;
export type CommandDispatchParams = SessionCommand;
export const CommandReceiptSchema = z.strictObject({
  commandId: IdentifierSchema,
  sessionId: IdentifierSchema,
  revision: SafeCounterSchema,
  ...authority,
  runId: IdentifierSchema.optional(),
});
export type CommandReceipt = z.infer<typeof CommandReceiptSchema>;
export const CommandsStatusParamsSchema = z.strictObject({ commandId: IdentifierSchema });
export const CommandsStatusResultSchema = CommandReceiptSchema.nullable();
