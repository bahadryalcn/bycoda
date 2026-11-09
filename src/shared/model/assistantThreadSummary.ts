import { z } from "zod";
const id = z.string().min(1).max(200),
  counter = z.number().int().nonnegative();
export const AssistantThreadSummaryProofSchema = z.strictObject({
  id,
  version: counter,
  projectIds: z.array(id).max(1000),
  throughMessageId: id,
  messageCount: counter,
  createdAt: counter,
  inputTruncated: z.boolean(),
  omittedMessages: counter,
});
export const AssistantThreadSummaryStateSchema = z.strictObject({
  status: z.enum(["pending", "working", "blocked", "ready"]),
  message: z.string().max(300).optional(),
  updatedAt: counter,
});
export type AssistantThreadSummaryProof = z.infer<typeof AssistantThreadSummaryProofSchema>;
export type AssistantThreadSummaryState = z.infer<typeof AssistantThreadSummaryStateSchema>;
