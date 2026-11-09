import { invoke as invokeLocal, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";
import {
  NativeBufferRecoveryMetadataSchema,
  NativeBufferRecoverySourceSchema,
  NativeBufferProvenanceSchema,
} from "../../../shared/model/host-contracts/native-buffer-recovery";

const MAX_RAW = 1024 * 1024;
const safe = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const digest = z
  .string()
  .length(64)
  .regex(/^[0-9a-f]+$/);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const identity = z
  .string()
  .min(1)
  .max(512)
  .refine((text) => {
    const bytes = encoder.encode(text);
    return (
      bytes.length <= 512 &&
      decoder.decode(bytes) === text &&
      ![...text].some((character) => {
        const code = character.codePointAt(0)!;
        return code <= 31 || (code >= 127 && code <= 159);
      })
    );
  });
const contextSchema = z.strictObject({
  hostEnvironmentId: identity,
  sourceStoreId: identity,
  sourceProfileId: identity,
  nativeStoreInstance: uuid,
  clientId: digest,
});
const sourceSchema = NativeBufferRecoverySourceSchema.extend({
  ownerId: identity,
  reportId: digest,
  snapshotDigest: digest,
});
const cursorSchema = z.strictObject({ version: z.literal(1), cursorId: uuid, page: safe });
const provenanceSchema = NativeBufferProvenanceSchema.extend({
  sourceStoreId: identity,
  sourceProfileId: identity,
  storeInstance: uuid.nullable(),
  windowIncarnation: uuid.nullable(),
  reportNonce: uuid.nullable(),
  snapshotDigest: digest,
});
const metadataSchema = NativeBufferRecoveryMetadataSchema.extend({
  source: sourceSchema,
  clientId: digest,
  instanceId: identity,
  provenance: provenanceSchema,
  compatibilityHoldId: digest,
});
const pageSchema = z.strictObject({
  version: z.literal(1),
  qualified: z.literal(false),
  resolution: z.literal("unsupported"),
  context: contextSchema,
  records: z.array(metadataSchema).max(100),
  next: cursorSchema.nullable(),
  incomplete: z.boolean(),
  duplicatesPossible: z.boolean(),
  unavailable: z.boolean(),
});
const bufferSchema = z.strictObject({ path: z.string().max(32768), dirty: z.boolean() });
const ownerSchema = z.strictObject({
  ownerId: identity,
  updatedAt: safe,
  unknown: z.boolean(),
  buffers: z.array(bufferSchema).max(10_000),
  source: provenanceSchema,
});
const recoverySchema = z.strictObject({
  reportVersion: safe,
  ownerVersions: z.record(identity, safe).refine((value) => Object.keys(value).length <= 20_000),
  version: z.literal(1).optional(),
  kind: z.enum(["projection", "hold"]).optional(),
  ownerLineages: z
    .record(identity, z.enum(["physical", "legacy"]))
    .refine((value) => Object.keys(value).length <= 20_000)
    .optional(),
  heldOwnerIds: z.array(identity).max(20_000).optional(),
  parentReportId: digest.optional(),
  sourceOwnerId: identity.optional(),
  holdDigest: digest.optional(),
  clockId: identity.optional(),
});
const rawSchema = z.strictObject({
  clientId: digest,
  instanceId: identity,
  device: digest,
  processId: safe.min(1),
  receivedAt: safe,
  owners: z.array(ownerSchema).max(20_000),
  retiredAt: safe.optional(),
  recovery: recoverySchema.optional(),
});
const readSchema = z.strictObject({
  version: z.literal(1),
  qualified: z.literal(false),
  resolution: z.literal("unsupported"),
  source: sourceSchema,
  context: contextSchema,
  rawReport: z.string().max(MAX_RAW),
  owner: ownerSchema,
  buffers: z.array(bufferSchema).max(10_000),
  contentAvailable: z.literal(false),
});
const statusSchema = z.strictObject({
  version: z.literal(1),
  qualified: z.literal(false),
  resolution: z.literal("unsupported"),
  source: sourceSchema,
  context: contextSchema,
  found: z.boolean(),
  inspectable: z.boolean(),
  unavailable: z.boolean(),
});

export type HostRecoveryContext = Readonly<z.infer<typeof contextSchema>>;
export type HostBufferSource = Readonly<z.infer<typeof sourceSchema>>;
export type HostBufferCursor = Readonly<z.infer<typeof cursorSchema>>;
export type HostBufferReport = Readonly<
  z.infer<typeof metadataSchema> & {
    key: string;
    context: HostRecoveryContext;
    ownerId: string;
    reportVersion: number;
    windowLabel: null;
    kind: z.infer<typeof provenanceSchema>["kind"];
    retainedBytes: number;
    current: boolean;
    held: boolean;
    contentAvailable: false;
  }
>;
export type HostBufferPage = Readonly<{
  version: 1;
  qualified: false;
  resolution: "unsupported";
  context: HostRecoveryContext;
  records: readonly HostBufferReport[];
  next: HostBufferCursor | null;
  incomplete: boolean;
  duplicatesPossible: boolean;
  unavailable: boolean;
}>;
export type HostBufferDetails = Readonly<{
  record: HostBufferReport;
  buffers: readonly Readonly<z.infer<typeof bufferSchema>>[];
  qualified: false;
  resolution: "unsupported";
  contentAvailable: false;
}>;
export type HostBufferStatus = Readonly<z.infer<typeof statusSchema>>;
export class HostBufferRecoveryError extends Error {
  constructor(
    readonly code:
      | "unsupported"
      | "invalid-request"
      | "invalid-response"
      | "unavailable"
      | "deadline"
      | "capacity"
      | "cancelled",
  ) {
    super(`HOST_BUFFER_RECOVERY_${code}`);
    this.name = "HostBufferRecoveryError";
  }
}
type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
type Runtime = { active: number };
type Options = { invoke?: Invoke; available?: () => boolean; timeoutMs?: number };
function fail(code: HostBufferRecoveryError["code"] = "invalid-response"): never {
  throw new HostBufferRecoveryError(code);
}
function parse<T>(schema: z.ZodType<T>, value: unknown, request = false): T {
  const result = schema.safeParse(value);
  if (!result.success) fail(request ? "invalid-request" : "invalid-response");
  return result.data;
}
function utf8(value: string, maximum: number) {
  const bytes = encoder.encode(value);
  if (bytes.length > maximum || decoder.decode(bytes) !== value) fail();
  return bytes;
}
async function hash(bytes: Uint8Array<ArrayBuffer>) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
export const hostBufferContextKey = (context: HostRecoveryContext) =>
  JSON.stringify([
    context.hostEnvironmentId,
    context.sourceStoreId,
    context.sourceProfileId,
    context.nativeStoreInstance,
    context.clientId,
  ]);
const sourceKey = (source: HostBufferSource) =>
  JSON.stringify([
    source.reportId,
    source.reportVersion,
    source.ownerId,
    source.ownerVersion,
    source.snapshotDigest,
  ]);
export const hostBufferReportKey = (record: HostBufferReport) => record.key;
function provenanceMatches(value: z.infer<typeof provenanceSchema>, context: HostRecoveryContext) {
  return (
    value.sourceStoreId === context.sourceStoreId &&
    value.sourceProfileId === context.sourceProfileId
  );
}
function buffersValid(buffers: readonly z.infer<typeof bufferSchema>[]) {
  for (const buffer of buffers) {
    utf8(buffer.path, 32768);
    if (buffer.path.includes("\0") || !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(buffer.path)) fail();
  }
}
function selected(record: HostBufferReport) {
  const context = Object.freeze(parse(contextSchema, record.context, true));
  // Project only the declared Native fields, excluding our presentation aliases.
  const wire = Object.fromEntries(
    Object.keys(metadataSchema.shape).map((key) => [key, record[key as keyof HostBufferReport]]),
  );
  const row = parse(metadataSchema, wire, true);
  if (
    row.clientId !== context.clientId ||
    !provenanceMatches(row.provenance, context) ||
    row.dirtyCount > row.bufferCount ||
    row.inspectable !== row.byteLength <= MAX_RAW
  )
    fail("invalid-request");
  return { context, source: Object.freeze(row.source), row };
}
function implement(options: Options, runtime: Runtime) {
  const nativeInvoke = options.invoke ?? invokeLocal;
  const available = options.available ?? isTauri;
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) fail("invalid-request");
  async function request<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!available()) fail("unsupported");
    if (signal?.aborted) fail("cancelled");
    if (runtime.active >= 4) fail("capacity");
    runtime.active++;
    const actual = Promise.resolve()
      .then(work)
      .catch((error) => {
        if (error instanceof HostBufferRecoveryError) throw error;
        throw new HostBufferRecoveryError("unavailable");
      })
      .finally(() => {
        runtime.active--;
      });
    void actual.catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    try {
      return await Promise.race([
        actual,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new HostBufferRecoveryError("deadline")), timeoutMs);
          cancel = () => reject(new HostBufferRecoveryError("cancelled"));
          signal?.addEventListener("abort", cancel, { once: true });
          if (signal?.aborted) cancel();
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (cancel) signal?.removeEventListener("abort", cancel);
    }
  }
  return {
    available,
    observation: () => Object.freeze({ active: runtime.active, maximum: 4 }),
    async list(
      input: {
        after: HostBufferCursor | null;
        limit: number;
        expectedContext?: HostRecoveryContext;
      },
      wait?: { signal?: AbortSignal },
    ): Promise<HostBufferPage> {
      const requestInput = parse(
        z.strictObject({
          after: cursorSchema.nullable(),
          limit: safe.min(1).max(100),
          expectedContext: contextSchema.optional(),
        }),
        input,
        true,
      );
      if (requestInput.after && !requestInput.expectedContext) fail("invalid-request");
      return request(async () => {
        const { after, limit, expectedContext } = requestInput;
        const page = parse(
          pageSchema,
          await nativeInvoke("managed_workspace_host_buffer_recovery_list", {
            request: { after, limit },
            ...(expectedContext ? { expectedContext } : {}),
          }),
        );
        if (
          expectedContext &&
          hostBufferContextKey(page.context) !== hostBufferContextKey(expectedContext)
        )
          fail();
        if (page.records.length > limit) fail();
        if (
          page.next &&
          (page.next.page !== (after ? after.page + 1 : 1) ||
            (after && page.next.cursorId !== after.cursorId))
        )
          fail();
        const context = Object.freeze(page.context);
        const records = page.records.map((row, index): HostBufferReport => {
          if (
            row.clientId !== context.clientId ||
            !provenanceMatches(row.provenance, context) ||
            row.dirtyCount > row.bufferCount ||
            row.inspectable !== row.byteLength <= MAX_RAW
          )
            fail();
          const source = Object.freeze(row.source);
          const provenance = Object.freeze(row.provenance);
          return Object.freeze({
            ...row,
            source,
            provenance,
            context,
            key: JSON.stringify([hostBufferContextKey(context), sourceKey(source), after, index]),
            ownerId: source.ownerId,
            reportVersion: source.reportVersion,
            windowLabel: null,
            kind: provenance.kind,
            retainedBytes: row.byteLength,
            current: row.retention === "current",
            held: row.retention === "held",
            contentAvailable: false,
          });
        });
        return Object.freeze({
          ...page,
          context,
          records: Object.freeze(records),
          next: page.next ? Object.freeze(page.next) : null,
        });
      }, wait?.signal);
    },
    async read(
      record: HostBufferReport,
      wait?: { signal?: AbortSignal },
    ): Promise<HostBufferDetails> {
      const { context, source, row } = selected(record);
      if (!row.inspectable) fail("unavailable");
      return request(async () => {
        const result = parse(
          readSchema,
          await nativeInvoke("managed_workspace_host_buffer_recovery_read", {
            source,
            expectedContext: context,
          }),
        );
        if (
          sourceKey(result.source) !== sourceKey(source) ||
          hostBufferContextKey(result.context) !== hostBufferContextKey(context)
        )
          fail();
        const bytes = utf8(result.rawReport, MAX_RAW);
        if (bytes.length !== row.byteLength || (await hash(bytes)) !== source.snapshotDigest)
          fail();
        let raw: z.infer<typeof rawSchema>;
        try {
          raw = parse(rawSchema, JSON.parse(result.rawReport.replace(/^\uFEFF/, "")));
        } catch {
          fail();
        }
        if (
          raw.clientId !== context.clientId ||
          raw.instanceId !== row.instanceId ||
          raw.processId !== row.processId ||
          (await hash(
            utf8(JSON.stringify([raw.device, raw.clientId, raw.instanceId]), MAX_RAW),
          )) !== source.reportId ||
          (raw.recovery?.reportVersion ?? 0) !== source.reportVersion ||
          (raw.recovery
            ? Object.prototype.hasOwnProperty.call(raw.recovery.ownerVersions, source.ownerId)
              ? raw.recovery.ownerVersions[source.ownerId]
              : undefined
            : 0) !== source.ownerVersion
        )
          fail();
        for (const owner of raw.owners) {
          if (!provenanceMatches(owner.source, context)) fail();
          buffersValid(owner.buffers);
        }
        const owner = raw.owners.find((owner) => owner.ownerId === source.ownerId);
        if (
          !owner ||
          JSON.stringify(owner) !== JSON.stringify(result.owner) ||
          JSON.stringify(owner.buffers) !== JSON.stringify(result.buffers) ||
          owner.updatedAt !== row.updatedAt ||
          owner.unknown !== row.unknown ||
          JSON.stringify(owner.source) !== JSON.stringify(row.provenance) ||
          owner.buffers.length !== row.bufferCount ||
          owner.buffers.filter((buffer) => buffer.dirty).length !== row.dirtyCount
        )
          fail();
        return Object.freeze({
          record,
          buffers: Object.freeze(owner.buffers.map((buffer) => Object.freeze(buffer))),
          qualified: false as const,
          contentAvailable: false as const,
          resolution: "unsupported" as const,
        });
      }, wait?.signal);
    },
    async status(
      record: HostBufferReport,
      wait?: { signal?: AbortSignal },
    ): Promise<HostBufferStatus> {
      const { context, source } = selected(record);
      return request(async () => {
        const result = parse(
          statusSchema,
          await nativeInvoke("managed_workspace_host_buffer_recovery_status", {
            source,
            expectedContext: context,
          }),
        );
        if (
          sourceKey(result.source) !== sourceKey(source) ||
          hostBufferContextKey(result.context) !== hostBufferContextKey(context) ||
          result.found !== result.inspectable ||
          (result.found && result.unavailable)
        )
          fail();
        return Object.freeze({
          ...result,
          context: Object.freeze(result.context),
          source: Object.freeze(result.source),
        });
      }, wait?.signal);
    },
  };
}
const runtimeKey = Symbol.for("bycoda.host-buffer-recovery.runtime.v1");
const root = globalThis as typeof globalThis & { [runtimeKey]?: Runtime };
root[runtimeKey] ??= { active: 0 };
export function createHostBufferRecovery(options: Options = {}) {
  return implement(options, root[runtimeKey]!);
}
export const hostBufferRecovery = createHostBufferRecovery();
