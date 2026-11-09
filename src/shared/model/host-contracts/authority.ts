import { z } from "zod";
import { BulkDescriptorSchema, IdentifierSchema, SafeCounterSchema } from "./schemas";

const digest = BulkDescriptorSchema.shape.sha256;
const identity = {
  environmentId: IdentifierSchema,
  sessionId: IdentifierSchema,
  migrationId: IdentifierSchema,
  sourceProfileId: IdentifierSchema,
  sourceStoreId: IdentifierSchema,
};
/** Serialized evidence is not trusted until a native bridge verifies its actor/challenge. */
export const NativeFenceEvidenceSchema = z.strictObject({
  ...identity,
  protocol: z.literal(2),
  generation: SafeCounterSchema.min(1),
  sourceRevision: SafeCounterSchema,
  sourceDigest: digest,
  snapshotEncoding: z.literal("source-json-utf8/v1"),
  minWriterProtocol: SafeCounterSchema.min(2),
  quiescent: z.literal(true),
  unknownReservations: z.literal(false),
  writerInventoryVerified: z.literal(true),
  unsupportedWriters: z.literal(false),
  evidenceDigest: digest,
});
export type NativeFenceEvidence = z.infer<typeof NativeFenceEvidenceSchema>;

const decision = {
  ...identity,
  protocol: z.literal(2),
  receiptId: IdentifierSchema,
  sourceGeneration: SafeCounterSchema.min(1),
  authorityGeneration: SafeCounterSchema.min(1),
  sourceRevision: SafeCounterSchema,
  sourceDigest: digest,
  evidenceDigest: digest,
  minWriterProtocol: SafeCounterSchema.min(2),
  committedAt: SafeCounterSchema,
  decisionDigest: digest,
};
export const HostAuthorityDecisionSchema = z.discriminatedUnion("phase", [
  z.strictObject({ ...decision, phase: z.literal("host-active"), targetDigest: digest }),
  z.strictObject({ ...decision, phase: z.literal("aborted"), targetDigest: digest.optional() }),
]);
export type HostAuthorityDecision = z.infer<typeof HostAuthorityDecisionSchema>;

/** Native-only pre-fence cancellation, not a Host decision/ACK. */
export const NativeQuiesceCancellationSchema = z.strictObject({
  receiptId: IdentifierSchema,
  environmentId: IdentifierSchema,
  sessionId: IdentifierSchema,
  migrationId: IdentifierSchema,
  identity: z.strictObject({ sourceStoreId: IdentifierSchema, sourceProfileId: IdentifierSchema }),
  sourceGeneration: SafeCounterSchema,
  authorityGeneration: SafeCounterSchema.min(1),
});
export type NativeQuiesceCancellation = z.infer<typeof NativeQuiesceCancellationSchema>;

/** ASCII identifiers plus safe integers: JSON tuple bytes are identical in JS/Rust. */
export function hostAuthorityDecisionDigestInput(
  value: Omit<HostAuthorityDecision, "decisionDigest">,
) {
  return JSON.stringify([
    value.protocol,
    value.environmentId,
    value.sessionId,
    value.migrationId,
    value.sourceProfileId,
    value.sourceStoreId,
    value.receiptId,
    value.sourceGeneration,
    value.authorityGeneration,
    value.sourceRevision,
    value.sourceDigest,
    value.evidenceDigest,
    value.minWriterProtocol,
    value.committedAt,
    value.phase,
    value.targetDigest ?? null,
  ]);
}
