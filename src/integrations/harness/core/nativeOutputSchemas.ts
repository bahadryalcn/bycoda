import { z } from "zod";

// This is renderer delivery/application lineage. Native observations never become
// an actor grant, a durable SQL receipt, or proof that a void parser has finished.
export const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const identity = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => {
    for (const part of value) {
      const code = part.codePointAt(0)!;
      if (code < 32 || (code >= 127 && code <= 159)) return false;
    }
    return true;
  });
export const source = {
  version: z.literal(1),
  qualified: z.literal(false),
  processEpoch: z.uuid(),
  streamEpoch: z.uuid(),
  streamKind: z.enum(["process", "sse"]),
  sessionId: identity,
  logicalSessionId: identity.optional(),
  sourceStoreId: identity.nullable(),
  sourceProfileId: identity.nullable(),
  storeInstance: z.uuid().nullable(),
  processId: integer.min(1).max(0xffff_ffff).nullable(),
  ownerEpoch: identity.nullable(),
};
export const metadataSchema = z.strictObject({
  ...source,
  sequence: integer.min(1),
  channel: z.enum(["stdout", "stderr", "sse"]),
  itemCount: integer.min(1),
  utf8Bytes: integer,
  payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
  digestEncoding: z.literal("bycoda-output-items-le/v1"),
  available: z.boolean(),
  unavailableReason: identity.nullable(),
});
export const stateSchema = z.strictObject({
  ...source,
  lastSequence: integer,
  state: z.enum(["sealed", "unsealed", "unavailable"]),
  reason: identity.nullable(),
});
