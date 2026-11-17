import { z } from "zod";

const identity = z.string().min(1).max(200);
export const PendingSecretInputSchema = z.strictObject({
  id: identity,
  signature: z.string().min(64).max(64),
  sessionId: identity,
  kind: z.literal("secret"),
  remote: z.literal(true),
  title: z.string().max(200),
  message: z.string().max(20000),
  fieldLabel: z.string().max(200),
  confirmLabel: z.string().max(200),
  cancelLabel: z.string().max(200),
  deadline: z.number().int().nonnegative(),
});
export const SecretInputListParamsSchema = z.strictObject({ sessionId: identity });
export const SecretInputListResultSchema = z.strictObject({
  requests: z.array(PendingSecretInputSchema).max(24),
});
const answerIdentity = { id: identity, signature: z.string().min(64).max(64) };
export const SecretInputAnswerParamsSchema = z.union([
  z.strictObject({ ...answerIdentity, value: z.string().min(1).max(8192) }),
  z.strictObject({ ...answerIdentity, cancelled: z.literal(true) }),
]);
export const SecretInputAnswerResultSchema = z.strictObject({ accepted: z.literal(true) });
