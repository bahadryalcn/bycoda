import { normalizeLineBreaks } from "../editor/editorDoc";
import { invoke as invokeLocal, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";
import {
  bindEditorDraftDocument,
  type NativeEditorDraftMetadata,
  type NativeEditorDraftRecord,
} from "./editorDraftPersistence";

const MAX_TEXT = 2 * 1024 * 1024;
const MAX_DOCUMENT = 4 * 1024 * 1024;
const MAX_PREPARED_BYTES = 64 * 1024 * 1024;
const safe = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const revision = safe.min(1);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const id = z.string().regex(/^[A-Za-z0-9._:-]{1,512}$/);
const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const localPath = z.string().min(1).max(4096);
const cursorSchema = z.strictObject({ ownerId: digest, documentId: id });
const sourceSchema = z.strictObject({
  ownerId: digest,
  documentId: id,
  revision,
  payloadDigest: digest,
});
const metadataSchema = z.strictObject({
  ownerId: digest,
  storeInstance: uuid,
  windowIncarnation: uuid,
  windowLabel: z.string().min(1).max(512),
  documentId: id,
  path: localPath,
  revision,
  payloadDigest: digest,
  textDigest: digest,
  serializedTextDigest: digest,
  baselineDigest: digest,
  retainedBytes: safe.min(1).max(MAX_DOCUMENT),
  state: z.enum(["retained", "save-reported"]),
  saveAckId: uuid.nullable(),
  updatedAt: safe,
});
// The field order is the actual Native DraftPayload serde struct order.
const payloadSchema = z.strictObject({
  documentId: id,
  path: localPath,
  text: z.string().max(MAX_TEXT),
  eol: z.enum(["lf", "crlf", "cr"]),
  serializedText: z.string().max(MAX_TEXT).optional(),
  diskBaseline: z.string().max(MAX_TEXT),
  revision,
});
const recordSchema = z.strictObject({ metadata: metadataSchema, payload: payloadSchema });
const inventorySchema = z.strictObject({
  version: z.literal(1),
  qualified: z.literal(false),
  records: z.array(metadataSchema).max(100),
  next: cursorSchema.nullable(),
});
const readSchema = z.strictObject({
  version: z.literal(1),
  qualified: z.literal(false),
  record: recordSchema,
});
const openSchema = z.strictObject({
  version: z.literal(1),
  qualified: z.literal(false),
  ownerEpoch: digest,
});

export type EditorDraftRecoverySource = Readonly<z.infer<typeof sourceSchema>>;
export type EditorDraftRecoveryCursor = Readonly<z.infer<typeof cursorSchema>>;
export type EditorDraftRecoveryMetadata = NativeEditorDraftMetadata;
export type EditorDraftRecoveryRecord = NativeEditorDraftRecord;
export type EditorDraftRecoveryPage = Readonly<{
  version: 1;
  qualified: false;
  records: readonly EditorDraftRecoveryMetadata[];
  next: EditorDraftRecoveryCursor | null;
}>;
export type PreparedEditorDraftRestore = Readonly<{
  version: 1;
  qualified: false;
  source: EditorDraftRecoverySource;
  target: Readonly<{
    ownerEpoch: string;
    documentId: string;
    path: string;
    revision: number;
    payloadDigest: string;
  }>;
  payload: Readonly<
    Pick<NativeEditorDraftRecord["payload"], "text" | "eol" | "serializedText" | "diskBaseline">
  >;
}>;
export class EditorDraftRecoveryError extends Error {
  constructor(
    readonly code:
      | "unsupported"
      | "invalid-request"
      | "invalid-response"
      | "deadline"
      | "capacity"
      | "target-conflict"
      | "stale-owner",
  ) {
    super(code);
    this.name = "EditorDraftRecoveryError";
  }
}
type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type Persistence = { bindDocument: typeof bindEditorDraftDocument };
type Options = {
  invoke?: Invoke;
  available?: () => boolean;
  persistence?: Persistence;
  timeoutMs?: number;
};
type Entry = {
  source: EditorDraftRecoverySource;
  documentId: string;
  record?: EditorDraftRecoveryRecord;
  ownerEpoch?: string;
  readEpoch?: string;
  accepted: boolean;
  rejectedCapture?: boolean;
  pending?: Promise<PreparedEditorDraftRestore>;
  result?: PreparedEditorDraftRestore;
};
type Runtime = {
  version: 1;
  active: number;
  waiters: number;
  retainedBytes: number;
  entries: Map<string, Entry>;
};
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
function bytes(text: string, limit: number): Uint8Array {
  if (text.length > limit) throw new EditorDraftRecoveryError("invalid-response");
  const value = encoder.encode(text);
  if (value.length > limit || decoder.decode(value) !== text)
    throw new EditorDraftRecoveryError("invalid-response");
  return value;
}
async function sha(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
function path(value: string) {
  bytes(value, 4096);
  if (value.includes("\0") || !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value))
    throw new EditorDraftRecoveryError("invalid-response");
}
function compare(a: EditorDraftRecoveryCursor, b: EditorDraftRecoveryCursor): number {
  return a.ownerId === b.ownerId
    ? a.documentId < b.documentId
      ? -1
      : a.documentId > b.documentId
        ? 1
        : 0
    : a.ownerId < b.ownerId
      ? -1
      : 1;
}
function parse<T>(schema: z.ZodType<T>, value: unknown, request = false): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new EditorDraftRecoveryError(request ? "invalid-request" : "invalid-response");
  return result.data;
}
async function metadata(value: NativeEditorDraftMetadata) {
  path(value.path);
  bytes(value.windowLabel, 512);
  if (
    value.windowLabel.includes("\0") ||
    value.ownerId !== (await sha(`${value.storeInstance}:${value.windowIncarnation}`)) ||
    (value.state === "retained" ? value.saveAckId !== null : value.saveAckId === null)
  )
    throw new EditorDraftRecoveryError("invalid-response");
  return Object.freeze(value);
}
async function validateRecord(
  value: z.infer<typeof recordSchema>,
  source?: EditorDraftRecoverySource,
): Promise<EditorDraftRecoveryRecord> {
  const m = await metadata(value.metadata);
  const p = value.payload;
  path(p.path);
  bytes(p.text, MAX_TEXT);
  bytes(p.diskBaseline, MAX_TEXT);
  if (p.serializedText !== undefined) bytes(p.serializedText, MAX_TEXT);
  const raw = JSON.stringify(p);
  const rawBytes = bytes(raw, MAX_DOCUMENT).length;
  const serialized =
    p.serializedText ??
    (p.eol === "lf" ? p.text : p.text.replace(/\n/g, p.eol === "crlf" ? "\r\n" : "\r"));
  if (
    p.text.includes("\r") ||
    normalizeLineBreaks(serialized) !== p.text ||
    p.documentId !== m.documentId ||
    p.path !== m.path ||
    p.revision !== m.revision ||
    m.payloadDigest !== (await sha(raw)) ||
    m.textDigest !== (await sha(p.text)) ||
    m.serializedTextDigest !== (await sha(serialized)) ||
    m.baselineDigest !== (await sha(p.diskBaseline)) ||
    m.retainedBytes !==
      rawBytes + encoder.encode(p.documentId + p.path + m.windowLabel).length + 512 ||
    (source &&
      (m.ownerId !== source.ownerId ||
        m.documentId !== source.documentId ||
        m.revision !== source.revision ||
        m.payloadDigest !== source.payloadDigest))
  )
    throw new EditorDraftRecoveryError("invalid-response");
  return Object.freeze({ metadata: m, payload: Object.freeze(p) });
}
function runtime(): Runtime {
  return { version: 1, active: 0, waiters: 0, retainedBytes: 0, entries: new Map() };
}

/** Local Native disclosure/copy only. No filesystem operation or source mutation. */
export function createEditorDraftRecovery(options: Options = {}) {
  return implement(options, runtime());
}
function implement(options: Options, state: Runtime) {
  const invoke = options.invoke ?? invokeLocal;
  const available = options.available ?? isTauri;
  const persistence = options.persistence ?? { bindDocument: bindEditorDraftDocument };
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (state.version !== 1 || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw new EditorDraftRecoveryError("invalid-request");
  function supported() {
    if (!available()) throw new EditorDraftRecoveryError("unsupported");
  }
  function job<T>(operation: () => Promise<T>): Promise<T> {
    supported();
    if (state.active >= 8 || state.waiters >= 32) throw new EditorDraftRecoveryError("capacity");
    state.active++;
    const pending = Promise.resolve()
      .then(operation)
      .finally(() => {
        state.active--;
      });
    void pending.catch(() => {});
    return pending;
  }
  async function wait<T>(pending: Promise<T>): Promise<T> {
    if (state.waiters >= 32) throw new EditorDraftRecoveryError("capacity");
    state.waiters++;
    // Promise reactions cannot be detached. A timeout ends only the caller's
    // wait; retain its subscription charge through actual job settlement.
    const subscribed = pending.finally(() => {
      state.waiters--;
    });
    void subscribed.catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        subscribed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new EditorDraftRecoveryError("deadline")), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function readActual(
    source: EditorDraftRecoverySource,
  ): Promise<{ record: EditorDraftRecoveryRecord; ownerEpoch: string }> {
    const opened = parse(openSchema, await invoke("native_editor_draft_open"));
    const result = parse(
      readSchema,
      await invoke("native_editor_draft_read_recovery", {
        request: { ownerEpoch: opened.ownerEpoch, source },
      }),
    );
    return { record: await validateRecord(result.record, source), ownerEpoch: opened.ownerEpoch };
  }
  async function listEditorDraftRecovery(input: {
    after: EditorDraftRecoveryCursor | null;
    limit: number;
  }): Promise<EditorDraftRecoveryPage> {
    const request = parse(
      z.strictObject({ after: cursorSchema.nullable(), limit: safe.min(1).max(100) }),
      input,
      true,
    );
    return wait(
      job(async () => {
        const result = parse(
          inventorySchema,
          await invoke("native_editor_draft_inventory", { request }),
        );
        if (result.records.length > request.limit)
          throw new EditorDraftRecoveryError("invalid-response");
        let previous = request.after;
        for (const record of result.records) {
          if (previous && compare(previous, record) >= 0)
            throw new EditorDraftRecoveryError("invalid-response");
          await metadata(record);
          previous = record;
        }
        if (
          result.next &&
          (result.records.length !== request.limit ||
            !previous ||
            compare(previous, result.next) !== 0)
        )
          throw new EditorDraftRecoveryError("invalid-response");
        return Object.freeze({
          version: 1 as const,
          qualified: false as const,
          records: Object.freeze(result.records),
          next: result.next && Object.freeze(result.next),
        });
      }),
    );
  }
  async function readEditorDraftRecovery(
    input: EditorDraftRecoverySource,
  ): Promise<EditorDraftRecoveryRecord> {
    const source = Object.freeze(parse(sourceSchema, input, true));
    return wait(job(async () => (await readActual(source)).record));
  }
  async function prepareActual(entry: Entry): Promise<PreparedEditorDraftRestore> {
    if (!entry.record) {
      const { record, ownerEpoch } = await readActual(entry.source);
      const charge =
        (record.payload.text.length +
          record.payload.diskBaseline.length +
          (record.payload.serializedText?.length ?? 0)) *
          2 +
        1024;
      if (state.retainedBytes + charge > MAX_PREPARED_BYTES)
        throw new EditorDraftRecoveryError("capacity");
      state.retainedBytes += charge;
      entry.record = record;
      entry.readEpoch = ownerEpoch;
    }
    const record = entry.record;
    // Each attempt owns a fresh binding lease, never revives a disposed alias.
    // The persistence manager retains the exact same owner/document CAS lane.
    const document = persistence.bindDocument({
      documentId: entry.documentId,
      path: record.payload.path,
      origin: "local-native",
    });
    try {
      if (entry.accepted && (await document.ready).ownerEpoch !== entry.ownerEpoch)
        throw new EditorDraftRecoveryError("stale-owner");
      if (!entry.accepted) {
        await document.ready;
        const ready = document.observe();
        const retryingAdmission =
          entry.rejectedCapture &&
          !ready.currentDraft &&
          !ready.pending &&
          ready.captureId === undefined &&
          (ready.error as (Error & { code?: unknown }) | undefined)?.code === "capacity";
        if (ready.error && !retryingAdmission) throw ready.error;
        if (
          ready.currentDraft ||
          ready.initializationDecisionRequired ||
          ready.pending ||
          ready.captureId !== undefined
        )
          throw new EditorDraftRecoveryError("target-conflict");
        if (
          !ready.ownerEpoch ||
          ready.ownerEpoch !== entry.readEpoch ||
          ready.phase === "unsupported"
        )
          throw new EditorDraftRecoveryError("stale-owner");
        entry.ownerEpoch = ready.ownerEpoch;
        const capture = document.capture({
          captureId: `recovery:${entry.documentId}`,
          text: record.payload.text,
          eol: record.payload.eol,
          diskBaseline: record.payload.diskBaseline,
          lineEndingSource:
            record.payload.serializedText ??
            (record.payload.eol === "lf"
              ? record.payload.text
              : record.payload.text.replace(/\n/g, record.payload.eol === "crlf" ? "\r\n" : "\r")),
        });
        // A manager can return a rejected ticket without admitting a job (e.g.
        // its snapshot budget is full). This fresh lane had no prior capture;
        // accepted work must be visible synchronously before its first await.
        const admitted = document.observe();
        if (!admitted.pending && admitted.captureId === undefined) {
          entry.rejectedCapture = true;
          await capture.persisted;
          throw new EditorDraftRecoveryError("invalid-response");
        }
        entry.accepted = true;
        entry.rejectedCapture = false;
        const flushing = document.flush();
        void flushing.catch(() => {});
        try {
          await capture.persisted;
          await flushing;
        } catch {
          await document.retry();
        }
      } else await document.retry();
      const current = document.observe();
      if (current.error) throw current.error;
      if (current.ownerEpoch !== entry.ownerEpoch || !current.currentDraft)
        throw new EditorDraftRecoveryError("stale-owner");
      const target = await validateRecord(parse(recordSchema, current.currentDraft));
      if (
        target.metadata.ownerId !== entry.ownerEpoch ||
        target.payload.documentId !== entry.documentId ||
        target.payload.path !== record.payload.path ||
        target.payload.text !== record.payload.text ||
        target.payload.eol !== record.payload.eol ||
        target.payload.serializedText !== record.payload.serializedText ||
        target.payload.diskBaseline !== record.payload.diskBaseline ||
        target.metadata.state !== "retained"
      )
        throw new EditorDraftRecoveryError("target-conflict");
      return (entry.result = Object.freeze({
        version: 1 as const,
        qualified: false as const,
        source: entry.source,
        target: Object.freeze({
          ownerEpoch: entry.ownerEpoch,
          documentId: entry.documentId,
          path: target.payload.path,
          revision: target.metadata.revision,
          payloadDigest: target.metadata.payloadDigest,
        }),
        payload: Object.freeze({
          text: record.payload.text,
          eol: record.payload.eol,
          ...(record.payload.serializedText !== undefined
            ? { serializedText: record.payload.serializedText }
            : {}),
          diskBaseline: record.payload.diskBaseline,
        }),
      }));
    } finally {
      document.dispose();
    }
  }
  async function prepareEditorDraftRestore(
    input: EditorDraftRecoverySource,
    target: { documentId: string },
  ): Promise<PreparedEditorDraftRestore> {
    supported();
    const source = Object.freeze(parse(sourceSchema, input, true));
    const { documentId } = parse(z.strictObject({ documentId: uuid }), target, true);
    if (state.waiters >= 32) throw new EditorDraftRecoveryError("capacity");
    let entry = state.entries.get(documentId);
    if (entry && JSON.stringify(entry.source) !== JSON.stringify(source))
      throw new EditorDraftRecoveryError("target-conflict");
    if (!entry) {
      if (state.entries.size >= 64) throw new EditorDraftRecoveryError("capacity");
      entry = { source, documentId, accepted: false };
      state.entries.set(documentId, entry);
    }
    if (entry.result) return entry.result;
    let pending = entry.pending;
    if (!pending) {
      const owned = entry;
      pending = job(() => prepareActual(owned));
      owned.pending = pending;
      void pending.then(
        () => {
          owned.pending = undefined;
        },
        () => {
          owned.pending = undefined;
        },
      );
    }
    return wait(pending);
  }
  return {
    listEditorDraftRecovery,
    readEditorDraftRecovery,
    prepareEditorDraftRestore,
    observation: () =>
      Object.freeze({
        qualified: false as const,
        active: state.active,
        waiters: state.waiters,
        preparations: state.entries.size,
        retainedBytes: state.retainedBytes,
      }),
  };
}

const stateKey = Symbol.for("bycoda.native-editor-recovery-state.v1");
const globals = globalThis as typeof globalThis & { [stateKey]?: Runtime };
const recovery = implement({}, (globals[stateKey] ??= runtime()));
export const listEditorDraftRecovery = recovery.listEditorDraftRecovery;
export const readEditorDraftRecovery = recovery.readEditorDraftRecovery;
export const prepareEditorDraftRestore = recovery.prepareEditorDraftRestore;
