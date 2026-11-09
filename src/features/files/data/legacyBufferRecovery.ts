import { invoke as invokeLocal, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";

const MAX_RAW_BYTES = 1024 * 1024;
const safe = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const version = safe.min(1);
const identity = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !value.includes("\0"));
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const sourceSchema = z.strictObject({
  sourceStoreId: identity,
  sourceProfileId: identity,
  ownerId: identity,
  reportVersion: version,
  snapshotDigest: digest,
});
const metadataSchema = z.strictObject({
  source: sourceSchema.nullable(),
  reportVersion: version,
  ownerId: identity.nullable(),
  kind: z.enum(["physical", "unattributed", "legacy", "retained"]),
  windowLabel: identity.nullable(),
  updatedAt: safe.nullable(),
  legacyTimestamp: z.string().max(32).nullable(),
  retainedBytes: safe,
  current: z.boolean(),
  held: z.boolean(),
  confirmed: z.boolean(),
  contentAvailable: z.literal(false),
  inspectable: z.boolean(),
});
const pageSchema = z.strictObject({
  version: z.literal(1),
  qualified: z.literal(false),
  records: z.array(metadataSchema).max(100),
  next: version.nullable(),
});
const bufferSchema = z.strictObject({
  path: z.string().min(1).max(4096),
  dirty: z.boolean(),
});
const readSchema = z.strictObject({
  version: z.literal(1),
  qualified: z.literal(false),
  record: metadataSchema,
  rawSnapshot: z.string().max(MAX_RAW_BYTES),
  buffers: z.array(bufferSchema).max(10_000),
});

export type LegacyBufferSource = Readonly<z.infer<typeof sourceSchema>>;
export type LegacyBufferReport = Readonly<z.infer<typeof metadataSchema>>;
export type LegacyBufferPage = Readonly<{
  records: readonly LegacyBufferReport[];
  next: number | null;
  qualified: false;
}>;
export type LegacyBufferDetails = Readonly<{
  record: LegacyBufferReport;
  buffers: readonly Readonly<z.infer<typeof bufferSchema>>[];
  contentAvailable: false;
  qualified: false;
}>;
export class LegacyBufferRecoveryError extends Error {
  constructor(
    readonly code: "unsupported" | "invalid-request" | "invalid-response" | "deadline" | "capacity",
  ) {
    super(`LEGACY_BUFFER_RECOVERY_${code}`);
    this.name = "LegacyBufferRecoveryError";
  }
}
type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type Runtime = { active: number };
type Options = { invoke?: Invoke; available?: () => boolean; timeoutMs?: number };
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
function invalid(): never {
  throw new LegacyBufferRecoveryError("invalid-response");
}
function parse<T>(schema: z.ZodType<T>, value: unknown, request = false): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new LegacyBufferRecoveryError(request ? "invalid-request" : "invalid-response");
  return parsed.data;
}
function utf8(value: string, limit: number): Uint8Array<ArrayBuffer> {
  const bytes = encoder.encode(value);
  if (bytes.length > limit || decoder.decode(bytes) !== value) invalid();
  return bytes;
}
function checkMetadata(record: LegacyBufferReport): LegacyBufferReport {
  for (const text of [
    record.ownerId,
    record.windowLabel,
    record.source?.sourceStoreId,
    record.source?.sourceProfileId,
  ]) {
    if (text !== null && text !== undefined) utf8(text, 512);
  }
  if (
    record.source &&
    (record.source.ownerId !== record.ownerId ||
      record.source.reportVersion !== record.reportVersion)
  )
    invalid();
  if (record.inspectable !== !!record.source) invalid();
  if (record.updatedAt === null && record.legacyTimestamp === null) invalid();
  return Object.freeze({
    ...record,
    source: record.source ? Object.freeze({ ...record.source }) : null,
  });
}
function sourceKey(source: LegacyBufferSource): string {
  return JSON.stringify([
    source.sourceStoreId,
    source.sourceProfileId,
    source.ownerId,
    source.reportVersion,
    source.snapshotDigest,
  ]);
}
export const legacyBufferReportKey = (record: LegacyBufferReport) =>
  record.source
    ? sourceKey(record.source)
    : JSON.stringify(["uninspectable", record.reportVersion]);

function implement(options: Options, state: Runtime) {
  const invoke = options.invoke ?? invokeLocal;
  const available = options.available ?? isTauri;
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw new LegacyBufferRecoveryError("invalid-request");
  async function request<T>(work: () => Promise<T>): Promise<T> {
    if (!available()) throw new LegacyBufferRecoveryError("unsupported");
    if (state.active >= 4) throw new LegacyBufferRecoveryError("capacity");
    state.active++;
    const actual = Promise.resolve()
      .then(work)
      .finally(() => {
        state.active--;
      });
    void actual.catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        actual,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new LegacyBufferRecoveryError("deadline")), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    available,
    async list(input: { after: number | null; limit: number }): Promise<LegacyBufferPage> {
      const cursor = parse(
        z.strictObject({ after: safe.nullable(), limit: z.number().int().min(1).max(100) }),
        input,
        true,
      );
      return request(async () => {
        const page = parse(
          pageSchema,
          await invoke("managed_workspace_buffer_recovery_list", { request: cursor }),
        );
        if (page.records.length > cursor.limit) invalid();
        let previous = cursor.after ?? 0;
        const records = page.records.map((record) => {
          if (record.reportVersion <= previous) invalid();
          previous = record.reportVersion;
          return checkMetadata(record);
        });
        if (page.next !== null && (!records.length || page.next !== previous)) invalid();
        return Object.freeze({
          records: Object.freeze(records),
          next: page.next,
          qualified: false as const,
        });
      });
    },
    async read(input: LegacyBufferSource): Promise<LegacyBufferDetails> {
      const source = Object.freeze(parse(sourceSchema, input, true));
      return request(async () => {
        const result = parse(
          readSchema,
          await invoke("managed_workspace_buffer_recovery_read", { source }),
        );
        const record = checkMetadata(result.record);
        if (!record.source || sourceKey(source) !== sourceKey(record.source) || !record.inspectable)
          invalid();
        const bytes = utf8(result.rawSnapshot, MAX_RAW_BYTES);
        if (record.retainedBytes !== bytes.length) invalid();
        const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
        if (hash !== source.snapshotDigest) invalid();
        let raw: unknown;
        try {
          raw = JSON.parse(result.rawSnapshot);
        } catch {
          invalid();
        }
        // Legacy producers can have extra fields. Keep their original bytes as
        // proof; compare only the path/dirty data actually returned by Native.
        const parsed = parse(
          z.array(z.object({ path: bufferSchema.shape.path, dirty: z.boolean() })).max(10_000),
          raw,
        );
        if (JSON.stringify(parsed) !== JSON.stringify(result.buffers)) invalid();
        const buffers = result.buffers.map((buffer) => {
          utf8(buffer.path, 4096);
          if (buffer.path.includes("\0") || !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(buffer.path))
            invalid();
          return Object.freeze({ ...buffer });
        });
        return Object.freeze({
          record,
          buffers: Object.freeze(buffers),
          contentAvailable: false as const,
          qualified: false as const,
        });
      });
    },
  };
}
export function createLegacyBufferRecovery(options: Options = {}) {
  return implement(options, { active: 0 });
}
type HotData = { legacyBufferRecovery?: Runtime };
const hot = import.meta.hot?.data as HotData | undefined;
const runtime = hot?.legacyBufferRecovery ?? { active: 0 };
if (hot) hot.legacyBufferRecovery = runtime;
export const legacyBufferRecovery = implement({}, runtime);
