import { normalizeLineBreaks, restoreMixedLineEndings } from "../editor/editorDoc";
import { invoke as invokeLocal, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";
import {
  rendererPersistenceDrain,
  type PersistenceDrainRegistry,
  type PersistenceProducer,
  type PersistenceWork,
} from "../../sessions/data/persistenceDrain";

export type EditorDraftEol = "lf" | "crlf" | "cr";
/** CodeMirror Text is immutable; callers must retain the actual document value. */
export type EditorDraftText = string | { readonly length: number; toString(): string };
export type EditorDraftOrigin = "local-native" | "web" | "remote";
const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const metadataSchema = z.strictObject({
  ownerId: digest,
  storeInstance: z.string(),
  windowIncarnation: z.string(),
  windowLabel: z.string(),
  documentId: z.string(),
  path: z.string(),
  revision: counter.min(1),
  payloadDigest: digest,
  textDigest: digest,
  serializedTextDigest: digest,
  baselineDigest: digest,
  retainedBytes: counter.max(4 * 1024 * 1024),
  state: z.enum(["retained", "save-reported"]),
  saveAckId: z.string().nullable(),
  updatedAt: counter,
});
const payloadSchema = z.strictObject({
  documentId: z.string(),
  path: z.string(),
  text: z.string(),
  eol: z.enum(["lf", "crlf", "cr"]),
  serializedText: z.string().optional(),
  diskBaseline: z.string(),
  revision: counter.min(1),
});
const recordSchema = z.strictObject({ metadata: metadataSchema, payload: payloadSchema });
const readSchema = z.strictObject({
  version: z.literal(1),
  qualified: z.literal(false),
  record: recordSchema.nullable(),
});
const receiptSchema = z.strictObject({
  version: z.literal(1),
  qualified: z.literal(false),
  record: metadataSchema,
});
const openSchema = z.strictObject({
  version: z.literal(1),
  qualified: z.literal(false),
  ownerEpoch: digest,
});
export type NativeEditorDraftMetadata = Readonly<z.infer<typeof metadataSchema>>;
export type NativeEditorDraftRecord = Readonly<{
  metadata: NativeEditorDraftMetadata;
  payload: Readonly<z.infer<typeof payloadSchema>>;
}>;
export type NativeCaptureState = Readonly<{
  qualified: false;
  documentId: string;
  path: string;
  ownerEpoch: string | null;
  phase:
    | "initializing"
    | "ready"
    | "restorable"
    | "queued"
    | "writing"
    | "retained"
    | "save-reported"
    | "unknown"
    | "error"
    | "stale-owner"
    | "unsupported";
  pending: boolean;
  disposed: boolean;
  currentDraft: NativeEditorDraftRecord | null;
  /** Last exact Native row acknowledged by this owner/document lane. */
  acknowledgedDraft?: NativeEditorDraftMetadata;
  initializationDecisionRequired: boolean;
  captureId?: string;
  error?: Error;
}>;
export type EditorDraftCaptureInput = Readonly<{
  captureId: string;
  text: EditorDraftText;
  diskBaseline: string;
  eol: EditorDraftEol;
  /** Raw source whose unchanged separators are retained during materialization. */
  lineEndingSource?: string;
}>;
export type EditorDraftCaptureReceipt = Readonly<{
  qualified: false;
  captureId: string;
  coveredByCaptureId: string;
  record: NativeEditorDraftMetadata;
}>;
export type EditorDraftCapture = Readonly<
  EditorDraftCaptureInput & {
    documentId: string;
    path: string;
    persisted: Promise<EditorDraftCaptureReceipt>;
  }
>;
export type EditorDraftSaveResult = Readonly<{
  qualified: false;
  state: "save-reported" | "superseded";
  record?: NativeEditorDraftMetadata;
}>;
export interface EditorDraftDocument {
  readonly ready: Promise<NativeCaptureState>;
  capture(input: EditorDraftCaptureInput): EditorDraftCapture;
  resolveInitialization(input: {
    decision: "restore" | "replace";
    revision: number;
    payloadDigest: string;
  }): void;
  flush(options?: { timeoutMs?: number }): Promise<NativeCaptureState>;
  observe(): NativeCaptureState;
  subscribe(listener: (state: NativeCaptureState) => void): () => void;
  retry(): Promise<NativeCaptureState>;
  reportSaved(capture: EditorDraftCapture): Promise<EditorDraftSaveResult>;
  dispose(): void;
}
export class EditorDraftPersistenceError extends Error {
  constructor(
    readonly code:
      | "unsupported"
      | "initialization-required"
      | "conflict"
      | "stale-owner"
      | "deadline"
      | "invalid-response"
      | "invalid-capture"
      | "capacity"
      | "disposed"
      | "implementation-changed",
    message = code,
  ) {
    super(message);
    this.name = "EditorDraftPersistenceError";
  }
}
type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type Payload = z.infer<typeof payloadSchema>;
type Captured = {
  input: EditorDraftCaptureInput;
  path: string;
  sequence: number;
  materialized?: string;
  payload?: Payload;
  receipt?: NativeEditorDraftMetadata;
  coveredBy?: Captured;
};
type Ack = { capture: Captured; record: NativeEditorDraftMetadata };
type Job = {
  sequence: number;
  rearm(): void;
  implementation: number;
  promise: Promise<Ack>;
  wake(): void;
  capture: Captured;
  /** Woken by a save/quit/unload flush: the write must verify every digest. */
  urgent?: boolean;
  /** Superseded by an oversized capture: it must not write an older copy over it. */
  cancelled?: boolean;
};
type DocumentState = {
  id: string;
  path: string;
  key: string;
  origin: EditorDraftOrigin;
  epoch: string | null;
  phase: NativeCaptureState["phase"];
  error?: Error;
  disposed: boolean;
  decision: boolean;
  current: NativeEditorDraftRecord | null;
  known: NativeEditorDraftMetadata | null;
  initialized: boolean;
  latest?: Captured;
  uncertain?: Captured;
  pending?: Job;
  jobs: Set<Job>;
  tail: Promise<void>;
  savePending?: EditorDraftCapture;
  reports: Set<Promise<EditorDraftSaveResult>>;
  listeners: Set<(state: NativeCaptureState) => void>;
  bindings: number;
  restoreBoundary?: number;
  failureSequence: number;
  validBaseline?: string;
  digestsVerified?: boolean;
  verifiedBaseline?: string;
  verifiedBaselineDigest?: string;
  verifiedText?: string;
  verifiedTextDigest?: string;
  emitted?: NativeCaptureState;
  ready: Promise<NativeCaptureState>;
  handle: EditorDraftDocument & {
    captureAt(input: EditorDraftCaptureInput, path: string): EditorDraftCapture;
  };
};
const encoder = new TextEncoder();
const MAX_TEXT = 2 * 1024 * 1024;
async function sha(text: string): Promise<string> {
  const bytes = encoder.encode(text);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
function validText(value: string, limit = MAX_TEXT): boolean {
  const bytes = encoder.encode(value);
  return (
    bytes.length <= limit && new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes) === value
  );
}
function serialized(text: string, eol: EditorDraftEol): string {
  return eol === "lf" ? text : text.replace(/\n/g, eol === "crlf" ? "\r\n" : "\r");
}
function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
function stale(value: unknown): boolean {
  return String(value).includes("STALE_OWNER") || String(value).includes("OWNER_CHANGED");
}
function samePayload(a: Payload, b: Payload): boolean {
  return (
    a.documentId === b.documentId &&
    a.path === b.path &&
    a.text === b.text &&
    a.eol === b.eol &&
    a.serializedText === b.serializedText &&
    a.diskBaseline === b.diskBaseline &&
    a.revision === b.revision
  );
}
function freezeRecord(record: z.infer<typeof recordSchema>): NativeEditorDraftRecord {
  return Object.freeze({
    metadata: Object.freeze(record.metadata),
    payload: Object.freeze(record.payload),
  });
}
/** Below this size hashing the text costs less than trusting the Host's digest. */
const QUICK_CHECK_MIN_CHARS = 64 * 1024;
async function checkMetadata(
  value: NativeEditorDraftMetadata,
  payload: Payload,
  epoch: string,
  doc?: DocumentState,
  strict = false,
): Promise<NativeEditorDraftMetadata> {
  if (
    (payload.serializedText !== undefined &&
      (!validText(payload.serializedText) ||
        normalizeLineBreaks(payload.serializedText) !== payload.text)) ||
    value.ownerId !== epoch ||
    value.documentId !== payload.documentId ||
    value.path !== payload.path ||
    value.revision !== payload.revision ||
    (value.state === "retained" ? value.saveAckId !== null : !value.saveAckId)
  )
    throw new EditorDraftPersistenceError("invalid-response");
  // Digests are hashed on the first write, a new baseline, or a cheap-check mismatch.
  // The quick path only covers large intermediate writes; a save/quit flush and any small text
  // are fully hashed. Even quick, a text digest that contradicts the last verified text is invalid.
  const quick =
    !strict &&
    payload.text.length >= QUICK_CHECK_MIN_CHARS &&
    !!doc?.digestsVerified &&
    doc.verifiedBaseline === payload.diskBaseline &&
    value.baselineDigest === doc.verifiedBaselineDigest;
  if (quick && doc?.verifiedText !== undefined) {
    const sameText = payload.text === doc.verifiedText;
    if (sameText !== (value.textDigest === doc.verifiedTextDigest))
      throw new EditorDraftPersistenceError("invalid-response");
  }
  if (!quick) {
    if (
      value.payloadDigest !== (await sha(JSON.stringify(payload))) ||
      value.textDigest !== (await sha(payload.text)) ||
      value.serializedTextDigest !==
        (await sha(payload.serializedText ?? serialized(payload.text, payload.eol))) ||
      value.baselineDigest !== (await sha(payload.diskBaseline))
    )
      throw new EditorDraftPersistenceError("invalid-response");
    if (doc) {
      doc.digestsVerified = true;
      doc.verifiedBaseline = payload.diskBaseline;
      doc.verifiedBaselineDigest = value.baselineDigest;
      doc.verifiedText = payload.text;
      doc.verifiedTextDigest = value.textDigest;
    }
  }
  return Object.freeze(value);
}
/** Baseline validity is a property of the string; cache it per baseline identity. */
function baselineValid(doc: DocumentState, baseline: string): boolean {
  if (doc.validBaseline === baseline) return true;
  if (!validText(baseline)) return false;
  doc.validBaseline = baseline;
  return true;
}

type ManagerOptions = {
  invoke?: Invoke;
  available?: () => boolean;
  registry?: PersistenceDrainRegistry;
  debounceMs?: number;
  /** Upper bound on how long continuous edits can postpone the first write. */
  maxWaitMs?: number;
  operationTimeoutMs?: number;
};
type RetainedState = {
  version: 1;
  documents: Map<string, DocumentState>;
  captures: WeakMap<EditorDraftCapture, { doc: DocumentState; value: Captured }>;
  sequence: number;
  waiters: number;
  saveReports: number;
  implementation: number;
};
function retainedState(): RetainedState {
  return {
    version: 1,
    documents: new Map(),
    captures: new WeakMap(),
    sequence: 0,
    waiters: 0,
    saveReports: 0,
    implementation: 0,
  };
}
/** Factory for isolated tests or a local native renderer. No filesystem-save callback exists. */
export function createEditorDraftPersistence(options: ManagerOptions = {}) {
  return implementManager(options, retainedState());
}
function implementManager(options: ManagerOptions, state: RetainedState) {
  if (state.version !== 1 || !Number.isSafeInteger(state.implementation + 1))
    throw new EditorDraftPersistenceError("implementation-changed");
  const implementation = ++state.implementation;
  const native: Invoke = options.invoke ?? invokeLocal;
  const available = options.available ?? isTauri;
  const { documents, captures } = state;
  let producer: PersistenceProducer | undefined;
  let wakeBoundary = 0;
  const delay = options.debounceMs ?? 1500;
  const maxWait = Math.max(delay, options.maxWaitMs ?? 5000);
  const operationTimeout = options.operationTimeoutMs ?? 10_000;
  function snapshot(doc: DocumentState): NativeCaptureState {
    return Object.freeze({
      qualified: false,
      documentId: doc.id,
      path: doc.path,
      ownerEpoch: doc.epoch,
      phase: doc.phase,
      pending: doc.jobs.size > 0 || doc.reports.size > 0,
      disposed: doc.disposed,
      currentDraft: doc.current,
      initializationDecisionRequired: doc.decision,
      ...(doc.known ? { acknowledgedDraft: doc.known } : {}),
      ...(doc.latest ? { captureId: doc.latest.input.captureId } : {}),
      ...(doc.error ? { error: doc.error } : {}),
    });
  }
  // Listeners only need a new snapshot when something they render changed; the
  // per-keystroke captureId value is readable through observe().
  function sameView(a: NativeCaptureState | undefined, b: NativeCaptureState): boolean {
    return (
      !!a &&
      a.phase === b.phase &&
      a.pending === b.pending &&
      a.error === b.error &&
      a.disposed === b.disposed &&
      a.path === b.path &&
      a.ownerEpoch === b.ownerEpoch &&
      a.currentDraft === b.currentDraft &&
      a.acknowledgedDraft === b.acknowledgedDraft &&
      a.initializationDecisionRequired === b.initializationDecisionRequired &&
      (a.captureId === undefined) === (b.captureId === undefined)
    );
  }
  function emit(doc: DocumentState, force = false) {
    const state = snapshot(doc);
    if (!force && sameView(doc.emitted, state)) return;
    doc.emitted = state;
    // Snapshot the notification boundary: a callback can subscribe/unsubscribe.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const listener of [...doc.listeners]) {
      try {
        listener(state);
      } catch {
        /* A view callback cannot change accepted persistence. */
      }
    }
  }
  function failed(doc: DocumentState, value: unknown, failedSequence = doc.latest?.sequence ?? 0) {
    doc.failureSequence = Math.max(doc.failureSequence, failedSequence);
    doc.error = asError(value);
    doc.digestsVerified = false;
    doc.phase = stale(value) ? "stale-owner" : "error";
    emit(doc);
  }
  function run<T>(
    doc: DocumentState,
    operation: (work?: PersistenceWork) => Promise<T>,
  ): Promise<T> {
    return producer ? producer.run("profile", doc.key, operation) : operation();
  }
  async function call<T>(
    doc: DocumentState,
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T> {
    const timer = setTimeout(() => {
      doc.error = new EditorDraftPersistenceError("deadline");
      doc.phase = "unknown";
      emit(doc);
    }, operationTimeout);
    try {
      return await native<T>(command, args);
    } finally {
      clearTimeout(timer);
    }
  }
  async function read(doc: DocumentState): Promise<NativeEditorDraftRecord | null> {
    if (!doc.epoch) throw new EditorDraftPersistenceError("initialization-required");
    const result = readSchema.parse(
      await call(doc, "native_editor_draft_read_current", {
        document: { ownerEpoch: doc.epoch, documentId: doc.id },
      }),
    );
    if (!result.record) return null;
    const record = freezeRecord(result.record);
    if (record.payload.documentId !== doc.id)
      throw new EditorDraftPersistenceError("invalid-response");
    await checkMetadata(record.metadata, record.payload, doc.epoch);
    return record;
  }
  function acknowledge(
    doc: DocumentState,
    capture: Captured,
    record: NativeEditorDraftMetadata,
    work?: PersistenceWork,
  ): Ack {
    capture.receipt = record;
    doc.known = record;
    doc.uncertain = undefined;
    if (capture.sequence >= doc.failureSequence) {
      doc.error = undefined;
      work?.confirmRecovery();
    }
    if (
      doc.savePending &&
      (captures.get(doc.savePending)?.value.sequence ?? Infinity) <= capture.sequence
    )
      doc.savePending = undefined;
    if (capture.payload)
      doc.current = freezeRecord({ metadata: { ...record }, payload: { ...capture.payload } });
    doc.phase = doc.error ? "error" : doc.pending ? "queued" : record.state;
    emit(doc);
    return { capture, record };
  }
  async function materialize(doc: DocumentState, capture: Captured): Promise<Payload> {
    if (capture.materialized === undefined) {
      const value =
        typeof capture.input.text === "string" ? capture.input.text : capture.input.text.toString();
      if (value.length !== capture.input.text.length || !validText(value) || value.includes("\r"))
        throw new EditorDraftPersistenceError("invalid-capture");
      capture.materialized = value;
    }
    const source = capture.input.lineEndingSource ?? capture.input.diskBaseline;
    const eol = capture.input.eol === "crlf" ? "\r\n" : capture.input.eol === "cr" ? "\r" : "\n";
    const exact = restoreMixedLineEndings(capture.materialized, source, eol);
    if (!validText(exact)) throw new EditorDraftPersistenceError("invalid-capture");
    const uniform = serialized(capture.materialized, capture.input.eol);
    return (capture.payload ??= {
      documentId: doc.id,
      path: capture.path,
      text: capture.materialized,
      eol: capture.input.eol,
      ...(exact !== uniform ? { serializedText: exact } : {}),
      diskBaseline: capture.input.diskBaseline,
      revision: (doc.known?.revision ?? 0) + 1,
    });
  }
  async function write(
    doc: DocumentState,
    capture: Captured,
    work?: PersistenceWork,
    strict = false,
  ): Promise<Ack> {
    await doc.ready;
    if (doc.phase === "stale-owner") throw new EditorDraftPersistenceError("stale-owner");
    if (
      !doc.initialized ||
      !doc.epoch ||
      doc.decision ||
      (doc.restoreBoundary !== undefined && capture.sequence <= doc.restoreBoundary)
    )
      throw new EditorDraftPersistenceError("initialization-required");
    if (doc.uncertain) {
      const current = await read(doc);
      const attempt = doc.uncertain;
      if (current && attempt.payload && samePayload(current.payload, attempt.payload)) {
        acknowledge(doc, attempt, current.metadata, work);
        if (capture === attempt) return { capture, record: current.metadata };
      } else if ((current?.metadata.payloadDigest ?? null) !== (doc.known?.payloadDigest ?? null)) {
        doc.current = current;
        doc.decision = true;
        throw new EditorDraftPersistenceError("conflict");
      } else doc.uncertain = undefined;
    }
    const payload = await materialize(doc, capture);
    if (!Number.isSafeInteger(payload.revision)) throw new EditorDraftPersistenceError("capacity");
    doc.phase = "writing";
    emit(doc);
    doc.uncertain = capture;
    const result = receiptSchema.parse(
      await call(doc, "native_editor_draft_put", {
        capture: {
          ownerEpoch: doc.epoch,
          ...payload,
          expectedRevision: doc.known?.revision ?? null,
        },
      }),
    );
    const record = await checkMetadata(result.record, payload, doc.epoch, doc, strict);
    return acknowledge(doc, capture, record, work);
  }
  function enqueue(doc: DocumentState, value: Captured): Job {
    if (doc.pending?.implementation === implementation) {
      doc.pending.capture = value;
      doc.pending.rearm();
      return doc.pending;
    }
    let start!: () => void;
    let awake = false;
    const gate = new Promise<void>((resolve) => {
      start = resolve;
    });
    const job: Job = {
      sequence: value.sequence,
      implementation,
      capture: value,
      promise: Promise.resolve(null as unknown as Ack),
      wake: () => {},
      rearm: () => {},
    };
    // Debounce: each coalesced edit restarts the timer, bounded by maxWait.
    const startedAt = Date.now();
    let timer = setTimeout(() => job.wake(), Math.min(delay, maxWait));
    job.rearm = () => {
      if (awake) return;
      clearTimeout(timer);
      const left = Math.max(0, maxWait - (Date.now() - startedAt));
      timer = setTimeout(() => job.wake(), Math.min(delay, left));
    };
    job.wake = () => {
      if (awake) return;
      awake = true;
      clearTimeout(timer);
      start();
    };
    doc.pending = job;
    doc.jobs.add(job);
    const previous = doc.tail;
    job.promise = run(doc, async (work) => {
      await gate;
      await previous;
      if (job.cancelled) throw new EditorDraftPersistenceError("capacity");
      // Keep the one unsent slot coalescible while an actual Native operation
      // is still settling. A fired debounce is not another queue allocation.
      if (doc.pending === job) doc.pending = undefined;
      return write(doc, job.capture, work, job.urgent);
    })
      .catch((error) => {
        if (!job.cancelled) failed(doc, error, job.capture.sequence);
        throw error;
      })
      .finally(() => {
        doc.jobs.delete(job);
        emit(doc);
      });
    doc.tail = job.promise.then(
      () => {},
      () => {},
    );
    void job.promise.catch(() => {});
    return job;
  }
  async function flushJobs(boundary = state.sequence): Promise<void> {
    const jobs = [...documents.values()]
      .flatMap((doc) => [...doc.jobs])
      .filter((job) => job.sequence <= boundary && !job.cancelled);
    for (const job of jobs) {
      job.urgent = true;
      job.wake();
    }
    const results = await Promise.allSettled(jobs.map((job) => job.promise));
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
  function attachRegistry(registry: PersistenceDrainRegistry) {
    producer = registry.reuseModuleProducer("native-editor-drafts", {
      wake: () => {
        wakeBoundary = state.sequence;
        for (const doc of documents.values())
          for (const job of doc.jobs)
            if (job.sequence <= wakeBoundary && !job.cancelled) {
              job.urgent = true;
              job.wake();
            }
      },
      flush: async () => {
        await flushJobs(wakeBoundary);
        for (const doc of documents.values()) if (doc.error) throw doc.error;
      },
    });
  }
  if (options.registry) attachRegistry(options.registry);
  function bindDocument(input: {
    documentId: string;
    path: string;
    origin: EditorDraftOrigin;
  }): EditorDraftDocument {
    // Native rows are keyed by owner/document, never path. Keep a single CAS and
    // failure-recovery lane across renames; each accepted capture keeps its path.
    // This lane never reopens/rebinds its epoch after an owner change.
    const key = JSON.stringify([input.origin, input.documentId]);
    const existing = documents.get(key);
    if (existing) return bindLease(existing, input.path);
    if (documents.size >= 256) throw new EditorDraftPersistenceError("capacity");
    const doc = {
      id: input.documentId,
      path: input.path,
      key,
      origin: input.origin,
      epoch: null,
      phase: "initializing",
      disposed: false,
      decision: false,
      current: null,
      known: null,
      initialized: false,
      bindings: 0,
      failureSequence: 0,
      jobs: new Set<Job>(),
      reports: new Set(),
      tail: Promise.resolve(),
      listeners: new Set(),
      ready: Promise.resolve(null),
      handle: null,
    } as unknown as DocumentState;
    const supported = input.origin === "local-native" && available();
    doc.ready = supported
      ? (async () => {
          try {
            const opened = openSchema.parse(await call(doc, "native_editor_draft_open"));
            doc.epoch = opened.ownerEpoch;
            doc.current = await read(doc);
            doc.known = doc.current?.metadata ?? null;
            doc.decision = !!doc.current;
            doc.initialized = true;
            if (doc.failureSequence === 0) doc.error = undefined;
            doc.phase = doc.error ? "error" : doc.decision ? "restorable" : "ready";
          } catch (error) {
            failed(doc, error);
          }
          return snapshot(doc);
        })()
      : Promise.resolve().then(() => {
          doc.phase = "unsupported";
          return snapshot(doc);
        });
    installDocument(doc);
    documents.set(key, doc);
    return bindLease(doc, input.path);
  }
  function installDocument(doc: DocumentState) {
    const supported = doc.origin === "local-native" && available();
    async function flush(wait: { timeoutMs?: number } = {}): Promise<NativeCaptureState> {
      for (const job of doc.jobs) job.wake();
      const pending: Promise<unknown>[] = [...doc.jobs].map((job) => job.promise);
      pending.push(...doc.reports);
      const settled = Promise.all(pending).then(() => {
        if (doc.error) throw doc.error;
        return snapshot(doc);
      });
      if (wait.timeoutMs === undefined) return settled;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          settled,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new EditorDraftPersistenceError("deadline")),
              wait.timeoutMs,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    const handle: DocumentState["handle"] = {
      ready: doc.ready,
      observe: () => snapshot(doc),
      subscribe(listener) {
        doc.listeners.add(listener);
        listener(snapshot(doc));
        return () => {
          doc.listeners.delete(listener);
        };
      },
      capture(raw) {
        return handle.captureAt(raw, doc.path);
      },
      captureAt(raw, path) {
        const value: Captured = {
          input: Object.freeze({ ...raw }),
          path,
          sequence: ++state.sequence,
        };
        producer?.noteMutation("profile");
        let invalid = !supported
          ? new EditorDraftPersistenceError("unsupported")
          : !/^[A-Za-z0-9._:-]{1,512}$/.test(doc.id) ||
              !raw.captureId ||
              !Number.isSafeInteger(raw.text.length) ||
              raw.text.length > MAX_TEXT ||
              !baselineValid(doc, raw.diskBaseline) ||
              !["lf", "crlf", "cr"].includes(raw.eol)
            ? new EditorDraftPersistenceError("invalid-capture")
            : undefined;
        if (!invalid) {
          const retained = new Set<Captured>([value]);
          for (const other of documents.values()) {
            if (other !== doc && other.latest) retained.add(other.latest);
            if (other.uncertain) retained.add(other.uncertain);
            for (const job of other.jobs)
              if (other !== doc || job !== doc.pending) retained.add(job.capture);
          }
          // Logical UTF16 snapshot allowance, not a claim about JS heap/RSS.
          let bytes = 0;
          for (const item of retained)
            bytes += (item.input.text.length + item.input.diskBaseline.length) * 2 + 512;
          if (bytes > 64 * 1024 * 1024) invalid = new EditorDraftPersistenceError("capacity");
        }
        if (!invalid) doc.latest = value;
        if (doc.restoreBoundary !== undefined && value.sequence > doc.restoreBoundary)
          doc.restoreBoundary = undefined;
        let job: Job | undefined;
        // Size/capacity limits disable draft capture for this edit without the red
        // banner; only a real Native write failure (see failed()) warns the user.
        const oversize =
          invalid?.code === "capacity" ||
          (Number.isSafeInteger(raw.text.length) && raw.text.length > MAX_TEXT);
        if (invalid && oversize) {
          console.warn(
            `[editor-draft] capture skipped (${invalid.code}); recovery copy is not kept`,
          );
          // The unsent older capture would otherwise be stored as if it were this document.
          const older = doc.pending;
          if (older) {
            older.cancelled = true;
            doc.pending = undefined;
            older.wake();
            if (doc.phase === "queued")
              doc.phase = doc.error ? "error" : (doc.known?.state ?? "ready");
          }
        } else if (invalid) failed(doc, invalid, value.sequence);
        else {
          doc.phase = "queued";
          job = enqueue(doc, value);
        }
        let persisted: Promise<EditorDraftCaptureReceipt> | undefined;
        const ticket = Object.freeze({
          ...value.input,
          documentId: doc.id,
          path: value.path,
          // A dropped keystroke ticket must attach no reaction retaining its
          // obsolete full document to a potentially stuck Native operation.
          get persisted() {
            if (!persisted) {
              if (invalid || state.waiters >= 64)
                persisted = Promise.reject(invalid ?? new EditorDraftPersistenceError("capacity"));
              else {
                state.waiters++;
                persisted = job!.promise
                  .then((ack) => {
                    value.coveredBy = ack.capture;
                    return Object.freeze({
                      qualified: false as const,
                      captureId: value.input.captureId,
                      coveredByCaptureId: ack.capture.input.captureId,
                      record: ack.record,
                    });
                  })
                  .finally(() => {
                    state.waiters--;
                  });
              }
              void persisted.catch(() => {});
            }
            return persisted;
          },
        });
        captures.set(ticket, { doc, value });
        emit(doc);
        return ticket;
      },
      resolveInitialization(choice) {
        if (
          !["restore", "replace"].includes(choice.decision) ||
          !doc.decision ||
          !doc.current ||
          choice.revision !== doc.current.metadata.revision ||
          choice.payloadDigest !== doc.current.metadata.payloadDigest
        )
          throw new EditorDraftPersistenceError("conflict");
        doc.known = doc.current.metadata;
        doc.uncertain = undefined;
        if (doc.latest) {
          doc.latest.payload = undefined;
          doc.latest.receipt = undefined;
          doc.latest.coveredBy = undefined;
        }
        // Restoring is a UI document decision, not permission to replay an old
        // local edit. Keep it retained until the restored/new document is captured.
        doc.restoreBoundary = choice.decision === "restore" ? doc.latest?.sequence : undefined;
        doc.decision = false;
        doc.phase = doc.pending ? "queued" : "ready";
        emit(doc);
      },
      flush,
      async retry() {
        await doc.tail;
        if (doc.phase === "stale-owner") throw new EditorDraftPersistenceError("stale-owner");
        if (!doc.initialized) {
          if (!doc.epoch) throw new EditorDraftPersistenceError("initialization-required");
          try {
            doc.current = await read(doc);
            doc.known = doc.current?.metadata ?? null;
            doc.initialized = true;
            doc.decision = !!doc.current;
            if (doc.decision) {
              doc.phase = "restorable";
              emit(doc);
              throw new EditorDraftPersistenceError("initialization-required");
            }
          } catch (error) {
            failed(doc, error);
            throw error;
          }
        }
        const saved = doc.savePending;
        if (!doc.latest)
          throw doc.error ?? new EditorDraftPersistenceError("initialization-required");
        if (!doc.latest.receipt || doc.uncertain) {
          const job = enqueue(doc, doc.latest);
          job.wake();
          await job.promise;
        }
        if (saved) await handle.reportSaved(saved);
        return snapshot(doc);
      },
      async reportSaved(ticket) {
        const captured = captures.get(ticket);
        if (!captured || captured.doc !== doc)
          throw new EditorDraftPersistenceError("invalid-capture");
        if (state.saveReports >= 64 || doc.reports.size >= 32)
          throw new EditorDraftPersistenceError("capacity");
        state.saveReports++;
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
              if (
                !captured.value.receipt &&
                !(doc.latest && doc.latest.sequence > captured.value.sequence && doc.latest.receipt)
              )
                throw error;
            });
          }
          if (!captured.value.receipt) {
            if (
              (captured.value.coveredBy && captured.value.coveredBy !== captured.value) ||
              (doc.latest && doc.latest.sequence > captured.value.sequence && doc.latest.receipt)
            ) {
              if (doc.savePending === ticket) doc.savePending = undefined;
              work?.confirmRecovery();
              return Object.freeze({ qualified: false as const, state: "superseded" as const });
            }
            throw new EditorDraftPersistenceError("invalid-response");
          }
          const ack = { record: captured.value.receipt };
          if (!doc.epoch || doc.phase === "stale-owner")
            throw new EditorDraftPersistenceError("stale-owner");
          if (doc.known && doc.known.revision > ack.record.revision)
            return Object.freeze({ qualified: false as const, state: "superseded" as const });
          doc.savePending = ticket;
          const response = receiptSchema.parse(
            await call(doc, "native_editor_draft_clear_saved", {
              saved: {
                ownerEpoch: doc.epoch,
                documentId: doc.id,
                revision: ack.record.revision,
                payloadDigest: ack.record.payloadDigest,
                savedTextDigest: ack.record.serializedTextDigest,
              },
            }),
          );
          if (!captured.value.payload || response.record.state !== "save-reported")
            throw new EditorDraftPersistenceError("invalid-response");
          const record = await checkMetadata(response.record, captured.value.payload, doc.epoch);
          acknowledge(doc, captured.value, record, work);
          return Object.freeze({
            qualified: false as const,
            state: "save-reported" as const,
            record,
          });
        }).catch((error) => {
          failed(doc, error, captured.value.sequence);
          throw error;
        });
        doc.reports.add(result);
        void result.then(
          () => {
            doc.reports.delete(result);
            state.saveReports--;
            emit(doc);
          },
          () => {
            doc.reports.delete(result);
            state.saveReports--;
            emit(doc);
          },
        );
        doc.tail = result.then(
          () => {},
          () => {},
        );
        return result;
      },
      dispose() {
        if (doc.bindings === 0) doc.disposed = true;
        for (const job of doc.jobs) job.wake();
      },
    };
    doc.handle = handle;
  }
  function bindLease(doc: DocumentState, path: string): EditorDraftDocument {
    if (doc.bindings >= 256) throw new EditorDraftPersistenceError("capacity");
    doc.bindings++;
    doc.disposed = false;
    doc.path = path;
    let retired = false;
    const subscriptions = new Set<() => void>();
    const owned = new WeakSet<EditorDraftCapture>();
    const base = doc.handle;
    function view(value: NativeCaptureState): NativeCaptureState {
      return Object.freeze({
        ...value,
        path,
        disposed: retired,
        ...(implementation !== state.implementation
          ? {
              phase: "error" as const,
              error: new EditorDraftPersistenceError("implementation-changed"),
            }
          : {}),
      });
    }
    return {
      ready: base.ready.then(() => view(base.observe())),
      observe: () => view(base.observe()),
      capture(value) {
        if (retired || implementation !== state.implementation) {
          let persisted: Promise<EditorDraftCaptureReceipt> | undefined;
          return Object.freeze({
            ...value,
            documentId: doc.id,
            path,
            get persisted() {
              if (!persisted) {
                persisted = Promise.reject(
                  new EditorDraftPersistenceError(retired ? "disposed" : "implementation-changed"),
                );
                void persisted.catch(() => {});
              }
              return persisted;
            },
          });
        }
        const ticket = base.captureAt(value, path);
        owned.add(ticket);
        return ticket;
      },
      resolveInitialization(value) {
        if (retired || implementation !== state.implementation)
          throw new EditorDraftPersistenceError(retired ? "disposed" : "implementation-changed");
        base.resolveInitialization(value);
      },
      flush: async (value) => view(await base.flush(value)),
      retry: async () => {
        if (retired || implementation !== state.implementation)
          throw new EditorDraftPersistenceError(retired ? "disposed" : "implementation-changed");
        return view(await base.retry());
      },
      reportSaved: (ticket) =>
        owned.has(ticket)
          ? base.reportSaved(ticket)
          : Promise.reject(new EditorDraftPersistenceError("invalid-capture")),
      subscribe(listener) {
        if (retired) return () => {};
        const unsubscribe = base.subscribe((value) => listener(view(value)));
        const remove = () => {
          subscriptions.delete(remove);
          unsubscribe();
        };
        subscriptions.add(remove);
        return remove;
      },
      dispose() {
        if (retired) return;
        retired = true;
        doc.bindings--;
        for (const remove of subscriptions) remove();
        base.dispose();
      },
    };
  }
  // Only state survives module reload. New bindings use this implementation;
  // already accepted closures keep their actual operations alive to settlement.
  for (const doc of documents.values()) {
    doc.pending?.wake();
    installDocument(doc);
    emit(doc, true);
  }
  return {
    bindDocument,
    attachRegistry,
    observation() {
      return Object.freeze({
        qualified: false as const,
        documents: documents.size,
        jobs: [...documents.values()].reduce((sum, doc) => sum + doc.jobs.size, 0),
        pendingSlots: [...documents.values()].filter((doc) => doc.pending).length,
        waiters: state.waiters,
        saveReports: state.saveReports,
      });
    },
    async flush() {
      await flushJobs();
      for (const doc of documents.values()) if (doc.error) throw doc.error;
    },
  };
}

const globalKey = Symbol.for("bycoda.native-editor-draft-state.v1");
const globals = globalThis as typeof globalThis & { [globalKey]?: RetainedState };
const defaultManager = implementManager({}, (globals[globalKey] ??= retainedState()));
defaultManager.attachRegistry(rendererPersistenceDrain);
// A reload or window close bypasses the quit coordinator, so wake the debounced writes here.
// The previous module instance's listeners are removed first (hot reload).
if (typeof window !== "undefined") {
  const pageKey = Symbol.for("bycoda.native-editor-draft-pagehide.v1");
  const holder = globalThis as typeof globalThis & { [pageKey]?: () => void };
  holder[pageKey]?.();
  const onPageHide = () => {
    void defaultManager.flush().catch(() => {});
  };
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("beforeunload", onPageHide);
  holder[pageKey] = () => {
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("beforeunload", onPageHide);
  };
}
export const bindEditorDraftDocument = defaultManager.bindDocument;
export const flushEditorDraftPersistence = defaultManager.flush;
