import { z } from "zod";
const id = z.string().min(1).max(200),
  counter = z.number().int().nonnegative();
export const AssistantVoiceRuntimeRegisterSchema = z.strictObject({
  op: z.literal("voice.runtime.register"),
  threadId: id,
  generationKey: id,
  seedMessageIds: z.array(id).max(6).refine(value => new Set(value).size === value.length),
  summaryProofId: id.optional(),
});
export const AssistantVoiceContextReasonSchema = z.enum([
  "unverified-seed",
  "unverified-summary",
  "unverified-tool",
  "context-changed",
  "source-cleared",
  "disconnected",
  "capacity",
  "pending-tool",
  "binding-changed",
]);
export const AssistantVoiceContextOpenSchema = z
  .strictObject({
    op: z.literal("voice.context.open"),
    threadId: id,
    requestId: id,
    generationKey: id,
    seedMessageIds: z
      .array(id)
      .max(6)
      .refine((value) => new Set(value).size === value.length),
    ownerMessageId: id,
    contextProjectIds: z.array(id).max(1000),
    summaryUsed: z.boolean(),
    summaryProofId: id.optional(),
    previousContextId: id.optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.summaryUsed && value.summaryProofId)
      ctx.addIssue({
        code: "custom",
        message: "A summary proof must match an actual summary seed.",
      });
  });
export const AssistantVoiceContextInvalidateSchema = z.strictObject({
  op: z.literal("voice.context.invalidate"),
  id,
  requestId: id,
  reason: AssistantVoiceContextReasonSchema,
});
export const AssistantVoiceContextGetSchema = z.strictObject({
  op: z.literal("voice.context.get"),
  id,
});
export const AssistantVoiceContextSchema = z
  .strictObject({
    id,
    version: counter,
    environmentId: id,
    threadId: id,
    generationKey: id,
    ownerMessageId: id,
    status: z.enum(["known", "pending", "unknown"]),
    projectIds: z.array(id).max(1000).optional(),
    reason: AssistantVoiceContextReasonSchema.optional(),
    createdAt: counter,
    updatedAt: counter,
  })
  .superRefine((value, ctx) => {
    if ((value.status === "known") !== (value.projectIds !== undefined))
      ctx.addIssue({
        code: "custom",
        message: "Only a verified voice context may carry contributor scope.",
      });
  });
/** Authenticated operation subject; this never certifies the returned content's project provenance. */
export const AssistantVoiceDisclosureSourceSchema = z.strictObject({
  environmentId: id,
  projectId: id.optional(),
  accountId: id.optional(),
  nativeLibrary: z.literal(true).optional(),
  threadId: id,
  sessionId: id.optional(),
  family: z.enum(["conversation", "social", "runtime-logs"]),
  action: id,
});
export const AssistantVoiceDisclosureSchema = z
  .strictObject({
    id,
    contextId: id,
    requestId: id,
    verified: z.boolean(),
    projectIds: z.array(id).max(1000).optional(),
    source: AssistantVoiceDisclosureSourceSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.verified !== (value.projectIds !== undefined))
      ctx.addIssue({
        code: "custom",
        message: "Only a verified actual disclosure may carry contributor scope.",
      });
  });
export type AssistantVoiceContext = z.infer<typeof AssistantVoiceContextSchema>;
export type AssistantVoiceContextOpen = z.infer<typeof AssistantVoiceContextOpenSchema>;
export type AssistantVoiceContextInvalidate = z.infer<typeof AssistantVoiceContextInvalidateSchema>;
export type AssistantVoiceContextReason = z.infer<typeof AssistantVoiceContextReasonSchema>;
export type AssistantVoiceDisclosure = z.infer<typeof AssistantVoiceDisclosureSchema>;
export type AssistantVoiceDisclosureSource = z.infer<typeof AssistantVoiceDisclosureSourceSchema>;
