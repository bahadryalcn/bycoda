import { z } from "zod";
import { IdentifierSchema, SafeCounterSchema, WIRE_SHA256_PATTERN } from "./schemas";

/** Exact ORIGINAL payload limit; wrappers never reduce the existing upload bound. */
export const NATIVE_DELIVERY_MAX_BYTES = 16 * 1024 * 1024;
export const NATIVE_DELIVERY_MAX_RESULT_BYTES = 32 * 1024 * 1024;
export const NativeDeliveryResultSourceSchema = z.strictObject({
  sha256: z.string().regex(WIRE_SHA256_PATTERN),
  byteLength: SafeCounterSchema.min(1).max(NATIVE_DELIVERY_MAX_RESULT_BYTES),
});
export type NativeDeliveryResultSource = z.infer<typeof NativeDeliveryResultSourceSchema>;
/** Digest of the consumed finite result in serde_json sorted-key order, not source bytes. */
export const NativeDeliveryConsumedResultSchema = NativeDeliveryResultSourceSchema;
export type NativeDeliveryConsumedResult = z.infer<typeof NativeDeliveryConsumedResultSchema>;
export const NativeDeliveryIdentitySchema = z.strictObject({
  originalId: IdentifierSchema,
  byteLength: SafeCounterSchema.min(1).max(NATIVE_DELIVERY_MAX_BYTES),
  sha256: z.string().regex(WIRE_SHA256_PATTERN),
});
export type NativeDeliveryIdentity = z.infer<typeof NativeDeliveryIdentitySchema>;
export const NativeBufferDeliveryRecordedSchema = NativeDeliveryIdentitySchema.extend({
  state: z.literal("recorded"),
  result: z.strictObject({ acknowledged: z.literal(true) }),
});
