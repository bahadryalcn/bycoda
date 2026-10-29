import { z } from "zod";
import {
  IdentifierSchema,
  JsonValueSchema,
  SafeCounterSchema,
  WIRE_SHA256_PATTERN,
} from "./schemas";
import { NATIVE_BUFFER_UPLOAD_LIMITS } from "./native-buffer-upload";
import { NativeDeliveryIdentitySchema } from "./native-delivery-identity";

export const NATIVE_SERVICE_UPLOAD_LIMITS = NATIVE_BUFFER_UPLOAD_LIMITS;
export const NativeServiceUploadTargetSchema = z.enum([
  "native.services.conversation.desktop.finish",
  "native.services.workspace.format",
]);
export type NativeServiceUploadTarget = z.infer<typeof NativeServiceUploadTargetSchema>;
const key = z.strictObject({ uploadId: IdentifierSchema });
export const NativeServiceUploadBeginParamsSchema = key.extend({
  target: NativeServiceUploadTargetSchema,
  byteLength: SafeCounterSchema.min(1).max(NATIVE_SERVICE_UPLOAD_LIMITS.maxBytes),
  sha256: z.string().regex(WIRE_SHA256_PATTERN),
  delivery: NativeDeliveryIdentitySchema.optional(),
});
export const NativeServiceUploadAppendParamsSchema = key.extend({
  offset: SafeCounterSchema,
  data: z.string(),
});
export const NativeServiceUploadStatusSchema = z.strictObject({
  uploadId: IdentifierSchema,
  target: NativeServiceUploadTargetSchema,
  byteLength: SafeCounterSchema,
  sha256: z.string().regex(WIRE_SHA256_PATTERN),
  receivedBytes: SafeCounterSchema,
  state: z.enum(["receiving", "committing", "completed", "failed", "cancelled"]),
  expiresAt: SafeCounterSchema,
  delivery: NativeDeliveryIdentitySchema.optional(),
  result: JsonValueSchema.optional(),
  outcome: z
    .strictObject({
      delivery: z.enum(["not-sent", "unknown"]),
      code: z.enum(["invalid-input", "operation-unconfirmed"]),
    })
    .optional(),
});
export type NativeServiceUploadStatus = z.infer<typeof NativeServiceUploadStatusSchema>;
export const NATIVE_SERVICE_UPLOAD_RPC_SCHEMAS = {
  "native.services.upload.begin": {
    params: NativeServiceUploadBeginParamsSchema,
    result: NativeServiceUploadStatusSchema,
  },
  "native.services.upload.append": {
    params: NativeServiceUploadAppendParamsSchema,
    result: NativeServiceUploadStatusSchema,
  },
  "native.services.upload.commit": { params: key, result: NativeServiceUploadStatusSchema },
  "native.services.upload.status": {
    params: key,
    result: NativeServiceUploadStatusSchema.nullable(),
  },
  "native.services.upload.cancel": { params: key, result: NativeServiceUploadStatusSchema },
} as const;
export type NativeServiceUploadMethod = keyof typeof NATIVE_SERVICE_UPLOAD_RPC_SCHEMAS;
export const NATIVE_SERVICE_UPLOAD_METHODS = Object.freeze(
  Object.keys(NATIVE_SERVICE_UPLOAD_RPC_SCHEMAS) as NativeServiceUploadMethod[],
);
