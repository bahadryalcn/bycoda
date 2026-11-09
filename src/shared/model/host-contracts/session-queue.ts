import { z } from "zod";
import { IdentifierSchema, SafeCounterSchema } from "./schemas";
import {
  BrowserAnnotationAttachmentSchema,
  ModelSettingsSchema,
  NoteComposerCardSchema,
  SessionProviderSchema,
} from "./session-commands";

const text = z.string();
const modelTarget = z.strictObject({
  harness: SessionProviderSchema,
  model: text,
  modelSettings: ModelSettingsSchema,
  providerAccountId: text.optional(),
});
/** Queue uploads are normalized and attachment ownership is checked by the Host. */
export const QueueAttachmentSchema = z.strictObject({
  id: IdentifierSchema,
  name: text,
  mimeType: text,
  kind: z.enum(["image", "audio", "file"]),
  size: SafeCounterSchema,
  browserAnnotation: BrowserAnnotationAttachmentSchema.optional(),
  hostEnvironmentId: IdentifierSchema.optional(),
  path: text.optional(),
  data: text.optional(),
  previewUrl: text.optional(),
  missing: z.boolean().optional(),
  copyFromPath: z.boolean().optional(),
});
export const QueuedMessageSchema = z.strictObject({
  authorityGeneration: SafeCounterSchema.min(1).optional(),
  id: IdentifierSchema,
  text,
  attachments: z.array(QueueAttachmentSchema).max(20),
  deliveryUnknown: z.literal(true).optional(),
  modelTarget: modelTarget.optional(),
  noteCard: NoteComposerCardSchema.optional(),
  handoffCard: z
    .strictObject({
      from: SessionProviderSchema,
      to: SessionProviderSchema,
      brief: text,
      request: text.optional(),
      files: SafeCounterSchema.optional(),
    })
    .optional(),
  intent: z.enum(["default", "plan", "build", "orchestrate"]).optional(),
});
const queue = {
  // Existing saved queues may exceed the new-enqueue budget; keep them editable.
  // Admission enforces the enqueue policy and serialized transport byte budget.
  messages: z.array(QueuedMessageSchema),
  status: z.enum(["active", "paused", "resuming", "restored"]).optional(),
  editingId: IdentifierSchema.optional(),
};
const shared = {
  drain: z
    .strictObject({
      holder: IdentifierSchema,
      epoch: SafeCounterSchema,
      expiresAt: SafeCounterSchema,
      legacy: z.literal(true).optional(),
    })
    .optional(),
  claim: z
    .strictObject({
      id: IdentifierSchema,
      clientId: IdentifierSchema,
      token: IdentifierSchema,
      epoch: SafeCounterSchema.optional(),
      at: SafeCounterSchema.optional(),
      legacy: z.literal(true).optional(),
    })
    .optional(),
  settled: z
    .strictObject({
      token: IdentifierSchema,
      clientId: IdentifierSchema,
      accepted: z.boolean(),
      reaped: z.literal(true).optional(),
      id: IdentifierSchema.optional(),
      prior: z.literal("active").optional(),
    })
    .optional(),
  holdReason: text.optional(),
  leased: z.literal(true).optional(),
  hostTime: SafeCounterSchema.optional(),
  consumer: IdentifierSchema.optional(),
};
/** Existing clients pass a complete read snapshot as the merge's before/after. */
export const QueueChangeValueSchema = z.strictObject({
  ...queue,
  ...shared,
  revision: SafeCounterSchema.optional(),
});
export const SharedSessionQueueSchema = z.strictObject({
  ...queue,
  ...shared,
  revision: SafeCounterSchema,
});
const base = {
  sessionId: IdentifierSchema,
  clientId: IdentifierSchema,
  leaseAware: z.boolean().optional(),
  epoch: SafeCounterSchema.optional(),
  ownerId: text.optional(),
  claimId: text.optional(),
};
export const SessionsQueueGetParamsSchema = z.strictObject(base);
export const SessionsQueueChangeParamsSchema = z.strictObject({
  ...base,
  before: QueueChangeValueSchema,
  after: QueueChangeValueSchema,
  takeOwnership: z.boolean().optional(),
});
export const SessionsQueueClaimParamsSchema = z.strictObject({
  ...base,
  id: IdentifierSchema,
  revision: SafeCounterSchema,
  steer: z.boolean().optional(),
});
export const SessionsQueueFinishParamsSchema = z.strictObject({
  ...base,
  token: IdentifierSchema,
  accepted: z.boolean(),
  /** Sender proves no provider write occurred; release without recovering an unknown delivery. */
  deferred: z.boolean().optional(),
});
export const SessionsQueueLeaseParamsSchema = z.strictObject({
  ...base,
  takeover: z.boolean().optional(),
});
export const SessionsQueueReleaseParamsSchema = z.strictObject(base);
export type SharedSessionQueue = z.infer<typeof SharedSessionQueueSchema>;
