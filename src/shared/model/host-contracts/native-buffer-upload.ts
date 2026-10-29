import { z } from "zod";
import { IdentifierSchema, SafeCounterSchema, WIRE_SHA256_PATTERN } from "./schemas";
import {
  NativeDeliveryIdentitySchema,
  NativeBufferDeliveryRecordedSchema,
} from "./native-delivery-identity";

export const NATIVE_BUFFER_UPLOAD_LIMITS = Object.freeze({
  maxBytes: 16 * 1024 * 1024,
  chunkBytes: 65_536,
  maxActive: 8,
  maxActivePerPrincipal: 2,
  maxResidentBytes: 64 * 1024 * 1024,
  maxResidentBytesPerPrincipal: 32 * 1024 * 1024,
  maxRetained: 256,
  maxRetainedPerPrincipal: 64,
  maxChunks: 1024,
  ttlMs: 120_000,
});
export const NativeBufferUploadKeyParamsSchema = z.strictObject({ uploadId: IdentifierSchema });
export const NativeBufferUploadStartParamsSchema = z.strictObject({
  uploadId: IdentifierSchema,
  byteLength: SafeCounterSchema.min(1).max(NATIVE_BUFFER_UPLOAD_LIMITS.maxBytes),
  sha256: z.string().regex(WIRE_SHA256_PATTERN),
  delivery: NativeDeliveryIdentitySchema.optional(),
});
export const NativeBufferUploadWriteParamsSchema = z.strictObject({
  uploadId: IdentifierSchema,
  offset: SafeCounterSchema,
  // Canonical base64 and the decoded chunk byte limit are checked by the owner.
  data: z.string(),
});
export const NativeBufferUploadStatusSchema = z.strictObject({
  uploadId: IdentifierSchema,
  byteLength: SafeCounterSchema,
  sha256: z.string().regex(WIRE_SHA256_PATTERN),
  receivedBytes: SafeCounterSchema,
  state: z.enum(["receiving", "committing", "completed", "failed", "aborted"]),
  expiresAt: SafeCounterSchema,
  delivery: NativeDeliveryIdentitySchema.optional(),
  result: z
    .union([z.strictObject({ acknowledged: z.literal(true) }), NativeBufferDeliveryRecordedSchema])
    .optional(),
  outcome: z
    .strictObject({
      delivery: z.enum(["not-sent", "unknown"]),
      code: z.enum(["invalid-input", "update-unconfirmed"]),
    })
    .optional(),
});
export const NATIVE_BUFFER_UPLOAD_RPC_SCHEMAS = {
  "native.buffers.upload.start": {
    params: NativeBufferUploadStartParamsSchema,
    result: NativeBufferUploadStatusSchema,
  },
  "native.buffers.upload.write": {
    params: NativeBufferUploadWriteParamsSchema,
    result: NativeBufferUploadStatusSchema,
  },
  "native.buffers.upload.commit": {
    params: NativeBufferUploadKeyParamsSchema,
    result: NativeBufferUploadStatusSchema,
  },
  "native.buffers.upload.status": {
    params: NativeBufferUploadKeyParamsSchema,
    result: NativeBufferUploadStatusSchema.nullable(),
  },
  "native.buffers.upload.abort": {
    params: NativeBufferUploadKeyParamsSchema,
    result: NativeBufferUploadStatusSchema,
  },
} as const;
export type NativeBufferUploadMethod = keyof typeof NATIVE_BUFFER_UPLOAD_RPC_SCHEMAS;
export type NativeBufferUploadStatus = z.infer<typeof NativeBufferUploadStatusSchema>;
export const NATIVE_BUFFER_UPLOAD_METHODS = Object.freeze(
  Object.keys(NATIVE_BUFFER_UPLOAD_RPC_SCHEMAS) as NativeBufferUploadMethod[],
);
