import { z } from "zod";
import { SafeCounterSchema, WIRE_SHA256_PATTERN, IdentifierSchema } from "./schemas";

/** Device-authenticated retained-source reads; these DTOs grant no Native actor authority. */
// Identity/path/raw byte ceilings remain enforced by the Host owner service and
// Native decoder. JS UTF-16 string length is not JSON Schema code-point length.
const identity = z.string();
const digest = z.string().regex(WIRE_SHA256_PATTERN);
const uuid = IdentifierSchema;
export const NativeBufferRecoverySourceSchema = z.strictObject({
  reportId: digest,
  reportVersion: SafeCounterSchema,
  ownerId: identity,
  ownerVersion: SafeCounterSchema,
  snapshotDigest: digest,
});
export const NativeBufferRecoveryCursorSchema = z.strictObject({
  version: z.literal(1),
  cursorId: uuid,
  page: SafeCounterSchema,
});
export const NativeBufferRecoveryListParamsSchema = z.strictObject({
  after: NativeBufferRecoveryCursorSchema.nullable().optional(),
  limit: SafeCounterSchema.min(1).max(100).optional(),
});
export const NativeBufferProvenanceSchema = z.strictObject({
  version: z.literal(2),
  sourceStoreId: identity,
  sourceProfileId: identity,
  storeInstance: uuid.nullable(),
  windowIncarnation: uuid.nullable(),
  kind: z.enum(["physical", "unattributed", "legacy", "retained"]),
  reportVersion: SafeCounterSchema.min(1),
  reportNonce: uuid.nullable(),
  snapshotDigest: digest,
});
const buffer = z.strictObject({ path: z.string(), dirty: z.boolean() });
export const NativeBufferOwnerSnapshotSchema = z.strictObject({
  ownerId: identity,
  updatedAt: SafeCounterSchema,
  unknown: z.boolean(),
  buffers: z.array(buffer).max(10_000),
  source: NativeBufferProvenanceSchema.optional(),
});
export const NativeBufferRecoveryMetadataSchema = z.strictObject({
  source: NativeBufferRecoverySourceSchema,
  clientId: identity,
  instanceId: identity,
  processId: SafeCounterSchema.min(1),
  updatedAt: SafeCounterSchema,
  byteLength: SafeCounterSchema.max(64 * 1024 * 1024),
  bufferCount: SafeCounterSchema.max(10_000),
  dirtyCount: SafeCounterSchema.max(10_000),
  unknown: z.boolean(),
  provenance: NativeBufferProvenanceSchema.nullable(),
  lineage: z.enum(["physical", "legacy"]),
  ownerMissing: z.boolean(),
  compatibilityHoldId: digest,
  verification: z.enum(["raw-checked", "metadata-only"]),
  retention: z.enum(["current", "held", "historical"]),
  inspectable: z.boolean(),
  qualified: z.literal(false),
  resolution: z.literal("unsupported"),
});
export const NativeBufferRecoveryPageSchema = z.strictObject({
  version: z.literal(1),
  qualified: z.literal(false),
  records: z.array(NativeBufferRecoveryMetadataSchema).max(100),
  next: NativeBufferRecoveryCursorSchema.nullable(),
  incomplete: z.boolean(),
  duplicatesPossible: z.boolean(),
});
export const NativeBufferRecoveryReadSchema = z.strictObject({
  version: z.literal(1),
  qualified: z.literal(false),
  source: NativeBufferRecoverySourceSchema,
  rawReport: z.string(),
  owner: NativeBufferOwnerSnapshotSchema,
  resolution: z.literal("unsupported"),
});
export const NativeBufferRecoveryStatusSchema = z.strictObject({
  version: z.literal(1),
  qualified: z.literal(false),
  source: NativeBufferRecoverySourceSchema,
  found: z.boolean(),
  inspectable: z.boolean(),
  resolution: z.literal("unsupported"),
});
export type NativeBufferRecoveryOperation = "list" | "read" | "status";
export const nativeProfileRecoveryMethod = (method: string) =>
  [
    "native.buffers.recovery.list",
    "native.buffers.recovery.read",
    "native.buffers.recovery.status",
  ].includes(method);
