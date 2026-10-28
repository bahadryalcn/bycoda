import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { z } from "zod";
import {
  NativeFenceEvidenceSchema,
  type NativeFenceEvidence,
} from "../../src/shared/model/host-contracts/authority";
import { IdentifierSchema, SafeCounterSchema } from "../../src/shared/model/host-contracts/schemas";

export const RETAINED_SOURCE_MAX_BYTES = 32 * 1024 * 1024;
export const RETAINED_SOURCE_CHUNK_BYTES = 16 * 1024;
const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/);
const common = {
  version: z.literal(1),
  requestId: SafeCounterSchema.min(1),
  sourceEpoch: uuid,
  qualified: z.literal(false),
};
export const RetainedSourceScopeSchema = z.strictObject({
  sessionId: IdentifierSchema,
  migrationId: IdentifierSchema,
});
export type RetainedSourceScope = z.infer<typeof RetainedSourceScopeSchema>;
type Association = Readonly<{
  environmentId: string;
  sourceEpoch: string;
  sourceStoreId: string;
  sourceProfileId: string;
}>;
const openCommon = {
  ...common,
  kind: z.literal("source-retained-open-result"),
  ...RetainedSourceScopeSchema.shape,
};
const OpenSchema = z.discriminatedUnion("state", [
  z.strictObject({ ...openCommon, state: z.literal("absent") }),
  z.strictObject({
    ...openCommon,
    state: z.literal("retained"),
    exportId: uuid,
    fence: NativeFenceEvidenceSchema,
    totalBytes: SafeCounterSchema.min(1).max(RETAINED_SOURCE_MAX_BYTES),
    chunkBytes: z.literal(RETAINED_SOURCE_CHUNK_BYTES),
  }),
]);
const ChunkSchema = z.strictObject({
  ...common,
  kind: z.literal("source-retained-chunk-result"),
  exportId: uuid,
  offset: SafeCounterSchema.max(RETAINED_SOURCE_MAX_BYTES),
  data: z
    .string()
    .min(4)
    .max(Math.ceil(RETAINED_SOURCE_CHUNK_BYTES / 3) * 4),
  eof: z.boolean(),
});
const CloseSchema = z.strictObject({
  ...common,
  kind: z.literal("source-retained-close-result"),
  exportId: uuid,
  retired: z.literal(true),
});

export type NativeRetainedSource =
  | Readonly<{ state: "absent"; qualified: false }>
  | Readonly<{
      state: "retained";
      sourceJson: string;
      fence: Readonly<NativeFenceEvidence>;
      qualified: false;
    }>;
export type RetainedSourceCommand =
  | { kind: "source-retained-open"; sessionId: string; migrationId: string }
  | { kind: "source-retained-chunk"; exportId: string; offset: number }
  | { kind: "source-retained-close"; exportId: string };
export type RetainedSourceExchange = (
  command: RetainedSourceCommand,
) => Promise<{ requestId: number; value: unknown }>;
export class RetainedSourceError extends Error {
  constructor(
    readonly code: "CAPACITY" | "INVALID_RESPONSE" | "SCOPE_CHANGED" | "DIGEST_MISMATCH",
  ) {
    super(`Native retained source: ${code}`);
    this.name = "RetainedSourceError";
  }
}

// A reservation covers accepted source bytes, not total heap/RSS. UTF8 decoding
// and bounded transient copies also exist. Completed immutable results transfer
// to the trusted caller; no coordinator or HTTP surface retains them here.
const budgetKey = Symbol.for("bycoda.native-authority-retained-source.process-budget.v1");
const processGlobals = globalThis as typeof globalThis & { [budgetKey]?: { active: number } };
const budget = (processGlobals[budgetKey] ??= { active: 0 });
export function reserveRetainedSourceTransfer(): () => void {
  if (budget.active >= 2) throw new RetainedSourceError("CAPACITY");
  budget.active += 1;
  let held = true;
  return () => {
    if (held) {
      held = false;
      budget.active -= 1;
    }
  };
}
export function retainedSourceTransferObservation() {
  return {
    activeRetainedTransfers: budget.active,
    reservedSourceBytes: budget.active * RETAINED_SOURCE_MAX_BYTES,
  };
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new RetainedSourceError("INVALID_RESPONSE");
  return result.data;
}
function checkReply(
  reply: { requestId: number; sourceEpoch: string },
  requestId: number,
  association: Association,
) {
  if (reply.requestId !== requestId || reply.sourceEpoch !== association.sourceEpoch)
    throw new RetainedSourceError("SCOPE_CHANGED");
}
function decodeChunk(data: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?(?![\s\S])/.test(data))
    throw new RetainedSourceError("INVALID_RESPONSE");
  const bytes = Buffer.from(data, "base64");
  if (
    !bytes.length ||
    bytes.length > RETAINED_SOURCE_CHUNK_BYTES ||
    bytes.toString("base64") !== data
  )
    throw new RetainedSourceError("INVALID_RESPONSE");
  return bytes;
}

/** Caller owns an admitted transfer reservation and serialized actual transport.
 * Any thrown error requires closing that transport through actual settlement;
 * a partial/unknown native export is never replayed or silently abandoned.
 * Serialized fence claims remain unqualified until an independent verifier.
 */
export async function readRetainedSource(
  association: Association,
  scope: RetainedSourceScope,
  exchange: RetainedSourceExchange,
): Promise<NativeRetainedSource> {
  const opening = await exchange({ kind: "source-retained-open", ...scope });
  const open = parse(OpenSchema, opening.value);
  checkReply(open, opening.requestId, association);
  if (open.sessionId !== scope.sessionId || open.migrationId !== scope.migrationId)
    throw new RetainedSourceError("SCOPE_CHANGED");
  if (open.state === "absent") return Object.freeze({ state: "absent", qualified: false });
  if (
    open.fence.environmentId !== association.environmentId ||
    open.fence.sessionId !== scope.sessionId ||
    open.fence.migrationId !== scope.migrationId ||
    open.fence.sourceStoreId !== association.sourceStoreId ||
    open.fence.sourceProfileId !== association.sourceProfileId
  )
    throw new RetainedSourceError("SCOPE_CHANGED");
  const bytes = Buffer.allocUnsafe(open.totalBytes);
  const digest = createHash("sha256");
  let offset = 0;
  while (offset < bytes.length) {
    const received = await exchange({
      kind: "source-retained-chunk",
      exportId: open.exportId,
      offset,
    });
    const chunk = parse(ChunkSchema, received.value);
    checkReply(chunk, received.requestId, association);
    if (chunk.exportId !== open.exportId || chunk.offset !== offset)
      throw new RetainedSourceError("SCOPE_CHANGED");
    const part = decodeChunk(chunk.data);
    const expected = Math.min(RETAINED_SOURCE_CHUNK_BYTES, bytes.length - offset);
    if (part.length !== expected || chunk.eof !== (offset + part.length === bytes.length))
      throw new RetainedSourceError("INVALID_RESPONSE");
    part.copy(bytes, offset);
    digest.update(part);
    offset += part.length;
  }
  if (digest.digest("hex") !== open.fence.sourceDigest)
    throw new RetainedSourceError("DIGEST_MISMATCH");
  let sourceJson: string;
  try {
    sourceJson = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new RetainedSourceError("INVALID_RESPONSE");
  }
  const closing = await exchange({ kind: "source-retained-close", exportId: open.exportId });
  const closed = parse(CloseSchema, closing.value);
  checkReply(closed, closing.requestId, association);
  if (closed.exportId !== open.exportId) throw new RetainedSourceError("SCOPE_CHANGED");
  return Object.freeze({
    state: "retained",
    sourceJson,
    fence: Object.freeze(open.fence),
    qualified: false,
  });
}
