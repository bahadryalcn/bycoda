import { invoke as invokeLocal, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";
import { rendererPersistenceDrain, type PersistenceDrainRegistry, type PersistenceProducer, type PersistenceWork } from "../../sessions/data/persistenceDrain";

export type EditorDraftEol = "lf" | "crlf" | "cr";
/** CodeMirror Text is immutable; callers must retain the actual document value. */
export type EditorDraftText = string | { readonly length: number; toString(): string };
export type EditorDraftOrigin = "local-native" | "web" | "remote";
const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const metadataSchema = z.strictObject({
  ownerId: digest, storeInstance: z.string(), windowIncarnation: z.string(), windowLabel: z.string(),
  documentId: z.string(), path: z.string(), revision: counter.min(1), payloadDigest: digest, textDigest: digest,
  serializedTextDigest: digest, baselineDigest: digest, retainedBytes: counter.max(4 * 1024 * 1024),
  state: z.enum(["retained", "save-reported"]), saveAckId: z.string().nullable(), updatedAt: counter,
});
const payloadSchema = z.strictObject({
  documentId: z.string(), path: z.string(), text: z.string(), eol: z.enum(["lf", "crlf", "cr"]),
  diskBaseline: z.string(), revision: counter.min(1),
});
const recordSchema = z.strictObject({ metadata: metadataSchema, payload: payloadSchema });
const readSchema = z.strictObject({ version: z.literal(1), qualified: z.literal(false), record: recordSchema.nullable() });
const receiptSchema = z.strictObject({ version: z.literal(1), qualified: z.literal(false), record: metadataSchema });
const openSchema = z.strictObject({ version: z.literal(1), qualified: z.literal(false), ownerEpoch: digest });
export type NativeEditorDraftMetadata = Readonly<z.infer<typeof metadataSchema>>;
export type NativeEditorDraftRecord = Readonly<{ metadata: NativeEditorDraftMetadata; payload: Readonly<z.infer<typeof payloadSchema>> }>;
export type NativeCaptureState = Readonly<{
  qualified: false;
  documentId: string;
  path: string;
  ownerEpoch: string | null;
  phase: "initializing" | "ready" | "restorable" | "queued" | "writing" | "retained" | "save-reported" | "unknown" | "error" | "stale-owner" | "unsupported";
  pending: boolean;
  disposed: boolean;
  currentDraft: NativeEditorDraftRecord | null;
  initializationDecisionRequired: boolean;
  captureId?: string;
  error?: Error;
}>;
export type EditorDraftCaptureInput = Readonly<{ captureId: string; text: EditorDraftText; diskBaseline: string; eol: EditorDraftEol }>;
export type EditorDraftCaptureReceipt = Readonly<{ qualified: false; captureId: string; coveredByCaptureId: string; record: NativeEditorDraftMetadata }>;
export type EditorDraftCapture = Readonly<EditorDraftCaptureInput & { documentId: string; path: string; persisted: Promise<EditorDraftCaptureReceipt> }>;
export type EditorDraftSaveResult = Readonly<{ qualified: false; state: "save-reported" | "superseded"; record?: NativeEditorDraftMetadata }>;
export interface EditorDraftDocument {
  readonly ready: Promise<NativeCaptureState>;
  capture(input: EditorDraftCaptureInput): EditorDraftCapture;
  resolveInitialization(input: { decision: "restore" | "replace"; revision: number; payloadDigest: string }): void;
  flush(options?: { timeoutMs?: number }): Promise<NativeCaptureState>;
  observe(): NativeCaptureState;
  subscribe(listener: (state: NativeCaptureState) => void): () => void;
  retry(): Promise<NativeCaptureState>;
  reportSaved(capture: EditorDraftCapture): Promise<EditorDraftSaveResult>;
  dispose(): void;
}
export class EditorDraftPersistenceError extends Error {
  constructor(readonly code: "unsupported" | "initialization-required" | "conflict" | "stale-owner" | "deadline" | "invalid-response" | "invalid-capture" | "capacity", message = code) {
    super(message); this.name = "EditorDraftPersistenceError";
  }
}
type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type Payload = z.infer<typeof payloadSchema>;
type Captured = { input: EditorDraftCaptureInput; sequence: number; materialized?: string; payload?: Payload; receipt?: NativeEditorDraftMetadata; coveredBy?: Captured };
type Ack = { capture: Captured; record: NativeEditorDraftMetadata };
type Job = { sequence: number; promise: Promise<Ack>; wake(): void; capture: Captured };
type DocumentState = {
  id: string; path: string; key: string; origin: EditorDraftOrigin; epoch: string | null;
  phase: NativeCaptureState["phase"]; error?: Error; disposed: boolean; decision: boolean;
  current: NativeEditorDraftRecord | null; known: NativeEditorDraftMetadata | null; initialized: boolean;
  latest?: Captured; uncertain?: Captured; pending?: Job; jobs: Set<Job>; tail: Promise<void>;
  savePending?: EditorDraftCapture; reports: Set<Promise<EditorDraftSaveResult>>; listeners: Set<(state: NativeCaptureState) => void>;
  ready: Promise<NativeCaptureState>; handle: EditorDraftDocument;
};
const encoder = new TextEncoder();
const MAX_TEXT = 2 * 1024 * 1024;
async function sha(text: string): Promise<string> {
  const bytes = encoder.encode(text);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((value) => value.toString(16).padStart(2, "0")).join("");
}
function validText(value: string, limit = MAX_TEXT): boolean {
  const bytes = encoder.encode(value);
  return bytes.length <= limit && new TextDecoder().decode(bytes) === value;
}
function serialized(text: string, eol: EditorDraftEol): string { return eol === "lf" ? text : text.replace(/\n/g, eol === "crlf" ? "\r\n" : "\r"); }
function asError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }
function stale(value: unknown): boolean { return String(value).includes("STALE_OWNER") || String(value).includes("OWNER_CHANGED"); }
function samePayload(a: Payload, b: Payload): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function freezeRecord(record: z.infer<typeof recordSchema>): NativeEditorDraftRecord {
  return Object.freeze({ metadata: Object.freeze(record.metadata), payload: Object.freeze(record.payload) });
}
async function checkMetadata(value: NativeEditorDraftMetadata, payload: Payload, epoch: string): Promise<NativeEditorDraftMetadata> {
  if (value.ownerId !== epoch || value.documentId !== payload.documentId || value.path !== payload.path || value.revision !== payload.revision ||
    value.payloadDigest !== await sha(JSON.stringify(payload)) || value.textDigest !== await sha(payload.text) ||
    value.serializedTextDigest !== await sha(serialized(payload.text, payload.eol)) || value.baselineDigest !== await sha(payload.diskBaseline) ||
    (value.state === "retained" ? value.saveAckId !== null : !value.saveAckId)) throw new EditorDraftPersistenceError("invalid-response");
  return Object.freeze(value);
}

/** Factory for isolated tests or a local native renderer. No filesystem-save callback exists. */
export function createEditorDraftPersistence(options: { invoke?: Invoke; available?: () => boolean; registry?: PersistenceDrainRegistry; debounceMs?: number; operationTimeoutMs?: number } = {}) {
  const native: Invoke = options.invoke ?? invokeLocal;
  const available = options.available ?? isTauri;
  const documents = new Map<string, DocumentState>();
  const captures = new WeakMap<EditorDraftCapture, { doc: DocumentState; value: Captured }>();
  let sequence = 0;
  let producer: PersistenceProducer | undefined;
  let wakeBoundary = 0;
  const delay = options.debounceMs ?? 300;
  const operationTimeout = options.operationTimeoutMs ?? 10_000;
  function snapshot(doc: DocumentState): NativeCaptureState {
    return Object.freeze({ qualified: false, documentId: doc.id, path: doc.path, ownerEpoch: doc.epoch, phase: doc.phase,
      pending: doc.jobs.size > 0 || doc.reports.size > 0, disposed: doc.disposed, currentDraft: doc.current, initializationDecisionRequired: doc.decision,
      ...(doc.latest ? { captureId: doc.latest.input.captureId } : {}), ...(doc.error ? { error: doc.error } : {}) });
  }
  function emit(doc: DocumentState) { const state = snapshot(doc); for (const listener of [...doc.listeners]) { try { listener(state); } catch { /* A view callback cannot change accepted persistence. */ } } }
  function failed(doc: DocumentState, value: unknown) { doc.error = asError(value); doc.phase = stale(value) ? "stale-owner" : "error"; emit(doc); }
  function run<T>(doc: DocumentState, operation: (work?: PersistenceWork) => Promise<T>): Promise<T> {
    return producer ? producer.run("profile", doc.key, operation) : operation();
  }
  async function call<T>(doc: DocumentState, command: string, args?: Record<string, unknown>): Promise<T> {
    const timer = setTimeout(() => { doc.error = new EditorDraftPersistenceError("deadline"); doc.phase = "unknown"; emit(doc); }, operationTimeout);
    try { return await native<T>(command, args); }
    finally { clearTimeout(timer); }
  }
  async function read(doc: DocumentState): Promise<NativeEditorDraftRecord | null> {
    if (!doc.epoch) throw new EditorDraftPersistenceError("initialization-required");
    const result = readSchema.parse(await call(doc, "native_editor_draft_read_current", { document: { ownerEpoch: doc.epoch, documentId: doc.id } }));
    if (!result.record) return null;
    const record = freezeRecord(result.record);
    if (record.payload.documentId !== doc.id) throw new EditorDraftPersistenceError("invalid-response");
    await checkMetadata(record.metadata, record.payload, doc.epoch);
    return record;
  }
  function acknowledge(doc: DocumentState, capture: Captured, record: NativeEditorDraftMetadata, work?: PersistenceWork): Ack {
    capture.receipt = record; doc.known = record; doc.uncertain = undefined; doc.error = undefined; doc.savePending = undefined;
    doc.phase = doc.pending ? "queued" : record.state; work?.confirmRecovery(); emit(doc);
    return { capture, record };
  }
  async function materialize(doc: DocumentState, capture: Captured): Promise<Payload> {
    if (capture.materialized === undefined) {
      const value = typeof capture.input.text === "string" ? capture.input.text : capture.input.text.toString();
      if (value.length !== capture.input.text.length || !validText(value) || value.includes("\r")) throw new EditorDraftPersistenceError("invalid-capture");
      capture.materialized = value;
    }
    return capture.payload ??= { documentId: doc.id, path: doc.path, text: capture.materialized, eol: capture.input.eol,
      diskBaseline: capture.input.diskBaseline, revision: (doc.known?.revision ?? 0) + 1 };
  }
  async function write(doc: DocumentState, capture: Captured, work?: PersistenceWork): Promise<Ack> {
    await doc.ready;
    if (doc.phase === "stale-owner") throw new EditorDraftPersistenceError("stale-owner");
    if (!doc.initialized || !doc.epoch || doc.decision) throw new EditorDraftPersistenceError("initialization-required");
    if (doc.uncertain) {
      const current = await read(doc);
      const attempt = doc.uncertain;
      if (current && attempt.payload && samePayload(current.payload, attempt.payload)) {
        acknowledge(doc, attempt, current.metadata, work);
        if (capture === attempt) return { capture, record: current.metadata };
      } else if ((current?.metadata.payloadDigest ?? null) !== (doc.known?.payloadDigest ?? null)) {
        doc.current = current; doc.decision = true; throw new EditorDraftPersistenceError("conflict");
      } else doc.uncertain = undefined;
    }
    const payload = await materialize(doc, capture);
    if (!Number.isSafeInteger(payload.revision)) throw new EditorDraftPersistenceError("capacity");
    doc.phase = "writing"; emit(doc);
    doc.uncertain = capture;
    const result = receiptSchema.parse(await call(doc, "native_editor_draft_put", { capture: { ownerEpoch: doc.epoch, ...payload, expectedRevision: doc.known?.revision ?? null } }));
    const record = await checkMetadata(result.record, payload, doc.epoch);
    return acknowledge(doc, capture, record, work);
  }
  function enqueue(doc: DocumentState, value: Captured): Job {
    if (doc.pending) { doc.pending.capture = value; return doc.pending; }
    let start!: () => void;
    let awake = false;
    const gate = new Promise<void>((resolve) => { start = resolve; });
    const job: Job = { sequence: value.sequence, capture: value, promise: Promise.resolve(null as unknown as Ack), wake: () => {} };
    const timer = setTimeout(() => job.wake(), delay);
    job.wake = () => { if (awake) return; awake = true; clearTimeout(timer); start(); };
    doc.pending = job; doc.jobs.add(job);
    const previous = doc.tail;
    job.promise = run(doc, async (work) => {
      await gate;
      await previous;
      // Keep the one unsent slot coalescible while an actual Native operation
      // is still settling. A fired debounce is not another queue allocation.
      if (doc.pending === job) doc.pending = undefined;
      return write(doc, job.capture, work);
    }).catch((error) => { failed(doc, error); throw error; }).finally(() => { doc.jobs.delete(job); emit(doc); });
    doc.tail = job.promise.then(() => {}, () => {});
    void job.promise.catch(() => {});
    return job;
  }
  async function flushJobs(boundary = sequence): Promise<void> {
    const jobs = [...documents.values()].flatMap((doc) => [...doc.jobs]).filter((job) => job.sequence <= boundary);
    for (const job of jobs) job.wake();
    const results = await Promise.allSettled(jobs.map((job) => job.promise));
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
  function attachRegistry(registry: PersistenceDrainRegistry) {
    producer = registry.reuseModuleProducer("native-editor-drafts", {
      wake: () => { wakeBoundary = sequence; for (const doc of documents.values()) for (const job of doc.jobs) if (job.sequence <= wakeBoundary) job.wake(); },
      flush: async () => { await flushJobs(wakeBoundary); for (const doc of documents.values()) if (doc.error) throw doc.error; },
    });
  }
  if (options.registry) attachRegistry(options.registry);
  function bindDocument(input: { documentId: string; path: string; origin: EditorDraftOrigin }): EditorDraftDocument {
    const key = JSON.stringify([input.documentId, input.path, input.origin]);
    const existing = documents.get(key);
    if (existing) { existing.disposed = false; return existing.handle; }
    if (documents.size >= 256) throw new EditorDraftPersistenceError("capacity");
    const doc = { id: input.documentId, path: input.path, key, origin: input.origin, epoch: null, phase: "initializing", disposed: false, decision: false,
      current: null, known: null, initialized: false, jobs: new Set<Job>(), reports: new Set(), tail: Promise.resolve(), listeners: new Set(), ready: Promise.resolve(null), handle: null } as unknown as DocumentState;
    const supported = input.origin === "local-native" && available();
    doc.ready = supported ? (async () => {
      try {
        const opened = openSchema.parse(await call(doc, "native_editor_draft_open"));
        doc.epoch = opened.ownerEpoch;
        doc.current = await read(doc); doc.known = doc.current?.metadata ?? null; doc.decision = !!doc.current; doc.initialized = true;
        doc.phase = doc.decision ? "restorable" : "ready"; doc.error = undefined;
      } catch (error) { failed(doc, error); }
      return snapshot(doc);
    })() : Promise.resolve().then(() => { doc.phase = "unsupported"; return snapshot(doc); });
    async function flush(wait: { timeoutMs?: number } = {}): Promise<NativeCaptureState> {
      for (const job of doc.jobs) job.wake();
      const pending: Promise<unknown>[] = [...doc.jobs].map((job) => job.promise);
      pending.push(...doc.reports);
      const settled = Promise.all(pending).then(() => { if (doc.error) throw doc.error; return snapshot(doc); });
      if (wait.timeoutMs === undefined) return settled;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { return await Promise.race([settled, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new EditorDraftPersistenceError("deadline")), wait.timeoutMs); })]); }
      finally { clearTimeout(timer); }
    }
    const handle: EditorDraftDocument = {
      ready: doc.ready,
      observe: () => snapshot(doc),
      subscribe(listener) { doc.listeners.add(listener); listener(snapshot(doc)); return () => { doc.listeners.delete(listener); }; },
      capture(raw) {
        const value: Captured = { input: Object.freeze({ ...raw }), sequence: ++sequence };
        producer?.noteMutation("profile");
        const invalid = !supported ? new EditorDraftPersistenceError("unsupported") :
          !/^[A-Za-z0-9._:-]{1,512}$/.test(doc.id) || !raw.captureId || !Number.isSafeInteger(raw.text.length) || raw.text.length > MAX_TEXT ||
          !validText(raw.diskBaseline) || !["lf", "crlf", "cr"].includes(raw.eol) ? new EditorDraftPersistenceError("invalid-capture") : undefined;
        doc.latest = value;
        let persisted: Promise<EditorDraftCaptureReceipt>;
        if (invalid) { failed(doc, invalid); persisted = run(doc, async () => { throw invalid; }); }
        else {
          doc.phase = "queued";
          const job = enqueue(doc, value);
          persisted = job.promise.then((ack) => { value.coveredBy = ack.capture; return Object.freeze({ qualified: false as const, captureId: value.input.captureId, coveredByCaptureId: ack.capture.input.captureId, record: ack.record }); });
        }
        void persisted.catch(() => {});
        const ticket = Object.freeze({ ...value.input, documentId: doc.id, path: doc.path, persisted });
        captures.set(ticket, { doc, value }); emit(doc); return ticket;
      },
      resolveInitialization(choice) {
        if (!["restore", "replace"].includes(choice.decision) || !doc.decision || !doc.current || choice.revision !== doc.current.metadata.revision || choice.payloadDigest !== doc.current.metadata.payloadDigest)
          throw new EditorDraftPersistenceError("conflict");
        doc.decision = false; doc.phase = doc.pending ? "queued" : "ready"; emit(doc);
      },
      flush,
      async retry() {
        await doc.tail;
        if (doc.phase === "stale-owner") throw new EditorDraftPersistenceError("stale-owner");
        if (!doc.initialized) {
          if (!doc.epoch) throw new EditorDraftPersistenceError("initialization-required");
          try {
            doc.current = await read(doc); doc.known = doc.current?.metadata ?? null; doc.initialized = true; doc.decision = !!doc.current;
            if (doc.decision) { doc.phase = "restorable"; emit(doc); throw new EditorDraftPersistenceError("initialization-required"); }
          } catch (error) { failed(doc, error); throw error; }
        }
        const saved = doc.savePending;
        if (!doc.latest) throw doc.error ?? new EditorDraftPersistenceError("initialization-required");
        if (!doc.latest.receipt || doc.uncertain) { const job = enqueue(doc, doc.latest); job.wake(); await job.promise; }
        if (saved) await handle.reportSaved(saved);
        return snapshot(doc);
      },
      async reportSaved(ticket) {
        const captured = captures.get(ticket);
        if (!captured || captured.doc !== doc) throw new EditorDraftPersistenceError("invalid-capture");
        // Admit before waiting for the draft receipt. A successful filesystem
        // save's exact lineage must survive an uncertain preceding DB ACK.
        doc.savePending = ticket;
        const previous = doc.tail;
        const result = run(doc, async (work) => {
          await previous;
          // Logical labels are caller-owned and can repeat. Only the private
          // captured object receiving an exact Native ACK can authorize clear.
          if (!captured.value.receipt) {
            await ticket.persisted.catch((error: unknown) => {
              if (!captured.value.receipt && !(doc.latest && doc.latest.sequence > captured.value.sequence && doc.latest.receipt)) throw error;
            });
          }
          if (!captured.value.receipt) {
            if ((captured.value.coveredBy && captured.value.coveredBy !== captured.value) ||
              (doc.latest && doc.latest.sequence > captured.value.sequence && doc.latest.receipt)) {
              if (doc.savePending === ticket) doc.savePending = undefined;
              work?.confirmRecovery();
              return Object.freeze({ qualified: false as const, state: "superseded" as const });
            }
            throw new EditorDraftPersistenceError("invalid-response");
          }
          const ack = { record: captured.value.receipt };
          if (!doc.epoch || doc.phase === "stale-owner") throw new EditorDraftPersistenceError("stale-owner");
          if (doc.known && doc.known.revision > ack.record.revision) return Object.freeze({ qualified: false as const, state: "superseded" as const });
          doc.savePending = ticket;
          const response = receiptSchema.parse(await call(doc, "native_editor_draft_clear_saved", { saved: { ownerEpoch: doc.epoch, documentId: doc.id,
            revision: ack.record.revision, payloadDigest: ack.record.payloadDigest, savedTextDigest: ack.record.serializedTextDigest } }));
          if (!captured.value.payload || response.record.state !== "save-reported") throw new EditorDraftPersistenceError("invalid-response");
          const record = await checkMetadata(response.record, captured.value.payload, doc.epoch);
          acknowledge(doc, captured.value, record, work);
          return Object.freeze({ qualified: false as const, state: "save-reported" as const, record });
        }).catch((error) => { failed(doc, error); throw error; });
        doc.reports.add(result);
        void result.then(() => { doc.reports.delete(result); emit(doc); }, () => { doc.reports.delete(result); emit(doc); });
        doc.tail = result.then(() => {}, () => {});
        return result;
      },
      dispose() { doc.disposed = true; doc.listeners.clear(); for (const job of doc.jobs) job.wake(); },
    };
    doc.handle = handle; documents.set(key, doc); return handle;
  }
  return { bindDocument, attachRegistry, async flush() { await flushJobs(); for (const doc of documents.values()) if (doc.error) throw doc.error; } };
}

const globalKey = Symbol.for("bycoda.native-editor-draft-manager.v1");
const globals = globalThis as typeof globalThis & { [globalKey]?: ReturnType<typeof createEditorDraftPersistence> };
const defaultManager = globals[globalKey] ??= createEditorDraftPersistence();
defaultManager.attachRegistry(rendererPersistenceDrain);
export const bindEditorDraftDocument = defaultManager.bindDocument;
export const flushEditorDraftPersistence = defaultManager.flush;
