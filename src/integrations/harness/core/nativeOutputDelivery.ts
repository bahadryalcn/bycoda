import { z } from "zod";

// This is renderer delivery/application lineage. Native observations never become
// an actor grant, a durable SQL receipt, or proof that a void parser has finished.
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const identity = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => {
    for (const part of value) {
      const code = part.codePointAt(0)!;
      if (code < 32 || (code >= 127 && code <= 159)) return false;
    }
    return true;
  });
const source = {
  version: z.literal(1),
  qualified: z.literal(false),
  processEpoch: z.uuid(),
  streamEpoch: z.uuid(),
  streamKind: z.enum(["process", "sse"]),
  sessionId: identity,
  logicalSessionId: identity.optional(),
  sourceStoreId: identity.nullable(),
  sourceProfileId: identity.nullable(),
  storeInstance: z.uuid().nullable(),
  processId: integer.min(1).max(0xffff_ffff).nullable(),
  ownerEpoch: identity.nullable(),
};
const metadataSchema = z.strictObject({
  ...source,
  sequence: integer.min(1),
  channel: z.enum(["stdout", "stderr", "sse"]),
  itemCount: integer.min(1),
  utf8Bytes: integer,
  payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
  digestEncoding: z.literal("bycoda-output-items-le/v1"),
  available: z.boolean(),
  unavailableReason: identity.nullable(),
});
const stateSchema = z.strictObject({
  ...source,
  lastSequence: integer,
  state: z.enum(["sealed", "unsealed", "unavailable"]),
  reason: identity.nullable(),
});
export type NativeOutputMetadata = Readonly<z.infer<typeof metadataSchema>>;
export type NativeOutputState = Readonly<z.infer<typeof stateSchema>>;
export type NativeOutputChannel = NativeOutputMetadata["channel"];
export type NativeOutputItem = Readonly<{ kind: "native-output-item" }>;
/** In-process renderer lineage only. Never serializable Native authority. */
export type NativeOutputEventOrigin = Readonly<{ kind: "native-output-origin" }>;
export interface NativeOutputWork {
  readonly origin: NativeOutputEventOrigin;
  run<T>(operation: () => T): T;
  /** Terminal actual settlement, not waiter cancellation/deadline. */
  finish(): void;
  /** Terminal failed/abandoned actual work; keeps the stream unavailable. */
  fail(reason: string): void;
}
type Source = z.infer<z.ZodObject<typeof source>>;
type Batch = {
  stream: Stream;
  sequence: number;
  digestVerified: boolean;
  delivered: number;
  itemCount: number;
  causalPending: number;
};
type Item = { batch: Batch; delivered: boolean; origin?: NativeOutputEventOrigin };
type Stream = {
  source: Source;
  sourceKey: string;
  observedThrough: number;
  receivedThrough: number;
  deliveredThrough: number;
  queuedEvents: number;
  appliedEvents: number;
  pending: Map<number, Batch>;
  terminal: NativeOutputState | null;
  unavailable: string | null;
  causalPending: number;
  causalFinished: number;
  additionalInputs: number;
};
type EventOrigin = { item: NativeOutputItem; sessionId: string; applied: boolean };
type Runtime = {
  streams: Map<string, Stream>;
  items: WeakMap<NativeOutputItem, Item>;
  events: WeakMap<object, EventOrigin>;
  current: NativeOutputItem | null;
  hashJobs: number;
  overflow: boolean;
  unavailableSessions: Set<string>;
  origins: WeakMap<NativeOutputEventOrigin, NativeOutputItem>;
  workJobs: number;
  timers: Map<ReturnType<typeof setTimeout>, { started: boolean; cancelled: boolean; work: NativeOutputWork | null }>;
};
const hot = import.meta.hot;
const runtime: Runtime = hot?.data.nativeOutputDelivery ?? {
  streams: new Map(),
  items: new WeakMap(),
  events: new WeakMap(),
  current: null,
  hashJobs: 0,
  overflow: false,
  unavailableSessions: new Set(),
  origins: new WeakMap(),
  workJobs: 0,
  timers: new Map(),
};
runtime.origins ??= new WeakMap();
runtime.workJobs ??= 0;
runtime.timers ??= new Map();
if (hot) hot.data.nativeOutputDelivery = runtime;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const MAX_STREAMS = 512;
const MAX_ITEMS = 4096;
const MAX_BYTES = 1024 * 1024;
const MAX_HASH_JOBS = 32;
const MAX_PENDING_BATCHES = 128;
const MAX_CAUSAL_WORK = 1024;
const MAX_BATCH_WORK = 128;
const logicalSession = (value: Source) => value.logicalSessionId ?? value.sessionId;
const matchesSession = (value: Source, sessionId: string) => value.sessionId === sessionId || logicalSession(value) === sessionId;

function key(value: Source): string {
  return JSON.stringify([value.processEpoch, value.streamEpoch]);
}
function binding(value: Source): string {
  return JSON.stringify([
    value.sessionId,
    value.streamKind,
    value.sourceStoreId,
    value.sourceProfileId,
    value.storeInstance,
    value.processId,
    value.ownerEpoch,
    value.logicalSessionId,
  ]);
}
function unavailable(stream: Stream, reason: string) {
  stream.unavailable ??= reason;
  stream.pending.clear();
}
function ownerKnown(value: Source): boolean {
  return (
    value.sourceStoreId !== null &&
    value.sourceProfileId !== null &&
    value.storeInstance !== null &&
    value.ownerEpoch !== null &&
    (value.streamKind === "sse" || value.processId !== null)
  );
}
function record(value: Source): Stream | null {
  const id = key(value);
  const previous = runtime.streams.get(id);
  if (previous) {
    if (previous.sourceKey !== binding(value)) unavailable(previous, "source-changed");
    return previous;
  }
  if (runtime.streams.size >= MAX_STREAMS) {
    runtime.overflow = true;
    return null;
  }
  const stream: Stream = {
    source: Object.freeze({ ...value }),
    sourceKey: binding(value),
    observedThrough: 0,
    receivedThrough: 0,
    deliveredThrough: 0,
    queuedEvents: 0,
    appliedEvents: 0,
    pending: new Map(),
    terminal: null,
    unavailable: ownerKnown(value) ? null : "source-unavailable",
    causalPending: 0,
    causalFinished: 0,
    additionalInputs: 0,
  };
  runtime.streams.set(id, stream);
  return stream;
}
export function invalidateNativeOutputSession(sessionId: string, reason: string): void {
  let found = false;
  for (const stream of runtime.streams.values())
    if (matchesSession(stream.source, sessionId)) {
      found = true;
      unavailable(stream, reason);
    }
  if (!found) return;
  flagUnknownSession(sessionId);
}
function flagUnknownSession(sessionId: string) {
  if (runtime.unavailableSessions.size < MAX_STREAMS) runtime.unavailableSessions.add(sessionId);
  else runtime.overflow = true;
}
export function invalidateNativeOutputDelivery(reason: string): void {
  for (const stream of runtime.streams.values()) unavailable(stream, reason);
}
function advance(stream: Stream) {
  if (stream.unavailable) return;
  for (;;) {
    const batch = stream.pending.get(stream.receivedThrough + 1);
    if (!batch?.digestVerified) break;
    stream.receivedThrough++;
  }
  for (;;) {
    const batch = stream.pending.get(stream.deliveredThrough + 1);
    if (!batch?.digestVerified || batch.delivered !== batch.itemCount) break;
    stream.deliveredThrough++;
    stream.pending.delete(batch.sequence);
  }
}

/** Binary framing matches Native; no JSON reserialization or newline joining. */
export function frameNativeOutputItems(
  channel: NativeOutputChannel,
  items: readonly string[],
): Uint8Array<ArrayBuffer> {
  if (items.length < 1 || items.length > MAX_ITEMS) throw new Error("NATIVE_OUTPUT_ITEMS_CAPACITY");
  let length = 0;
  const bytes = items.map((item) => {
    if (typeof item !== "string" || item.length > MAX_BYTES)
      throw new Error("NATIVE_OUTPUT_BYTES_CAPACITY");
    const value = encoder.encode(item);
    length += value.byteLength;
    if (length > MAX_BYTES) throw new Error("NATIVE_OUTPUT_BYTES_CAPACITY");
    if (decoder.decode(value) !== item) throw new Error("NATIVE_OUTPUT_INVALID_UTF8");
    return value;
  });
  const prefix = encoder.encode("bycoda-native-output-items-v1\0");
  const result = new Uint8Array(prefix.length + 5 + items.length * 8 + length);
  result.set(prefix);
  result[prefix.length] = channel === "stdout" ? 1 : channel === "stderr" ? 2 : 3;
  const view = new DataView(result.buffer);
  view.setUint32(prefix.length + 1, items.length, true);
  let offset = prefix.length + 5;
  for (const item of bytes) {
    view.setUint32(offset, item.byteLength, true);
    view.setUint32(offset + 4, 0, true);
    result.set(item, offset + 8);
    offset += 8 + item.byteLength;
  }
  return result;
}

/** Always preserve ordinary provider delivery, even when metadata is unusable. */
export function observeNativeOutputBatch(
  sessionId: string,
  channel: NativeOutputChannel,
  items: readonly string[],
  metadata: unknown,
): readonly NativeOutputItem[] | undefined {
  if (metadata === undefined) {
    for (const stream of runtime.streams.values())
      if (matchesSession(stream.source, sessionId)) unavailable(stream, "metadata-missing");
    return;
  }
  const parsed = metadataSchema.safeParse(metadata);
  if (!parsed.success || parsed.data.sessionId !== sessionId || parsed.data.channel !== channel) {
    flagUnknownSession(sessionId);
    invalidateNativeOutputSession(sessionId, "invalid-metadata");
    return;
  }
  const value = parsed.data;
  const stream = record(value);
  if (!stream) return;
  if ((channel === "sse") !== (value.streamKind === "sse"))
    unavailable(stream, "stream-channel-changed");
  if (value.sequence !== stream.observedThrough + 1) unavailable(stream, "sequence-gap-or-replay");
  if (stream.terminal?.state === "sealed") unavailable(stream, "output-after-seal");
  if (!value.available || value.unavailableReason !== null)
    unavailable(stream, value.unavailableReason ?? "native-unavailable");
  if (
    value.itemCount !== items.length ||
    value.itemCount > MAX_ITEMS ||
    value.utf8Bytes > MAX_BYTES
  )
    unavailable(stream, "batch-capacity");
  if (stream.pending.size >= MAX_PENDING_BATCHES || runtime.hashJobs >= MAX_HASH_JOBS)
    unavailable(stream, "renderer-capacity");
  if (stream.unavailable) return;
  let framed: Uint8Array<ArrayBuffer>;
  try {
    framed = frameNativeOutputItems(channel, items);
    const overhead =
      encoder.encode("bycoda-native-output-items-v1\0").length + 5 + items.length * 8;
    if (framed.byteLength - overhead !== value.utf8Bytes) throw new Error("byte-count");
  } catch {
    unavailable(stream, "invalid-payload");
    return;
  }
  const batch: Batch = {
    stream,
    sequence: value.sequence,
    digestVerified: false,
    delivered: 0,
    itemCount: items.length,
    causalPending: 0,
  };
  stream.observedThrough = value.sequence;
  stream.pending.set(batch.sequence, batch);
  const tokens = items.map(() => {
    const token: NativeOutputItem = Object.freeze({ kind: "native-output-item" });
    runtime.items.set(token, { batch, delivered: false });
    return token;
  });
  runtime.hashJobs++;
  void Promise.resolve()
    .then(() => crypto.subtle.digest("SHA-256", framed))
    .then((digest) => {
      const actual = [...new Uint8Array(digest)]
        .map((part) => part.toString(16).padStart(2, "0"))
        .join("");
      if (actual !== value.payloadSha256) unavailable(stream, "payload-digest");
      else {
        batch.digestVerified = true;
        advance(stream);
      }
    })
    .catch(() => unavailable(stream, "digest-unavailable"))
    .finally(() => {
      runtime.hashJobs--;
    });
  return tokens;
}

export function observeNativeOutputState(sessionId: string, raw: unknown): void {
  if (raw === undefined) return;
  const parsed = stateSchema.safeParse(raw);
  if (!parsed.success || parsed.data.sessionId !== sessionId) {
    flagUnknownSession(sessionId);
    invalidateNativeOutputSession(sessionId, "invalid-terminal");
    return;
  }
  const value = parsed.data;
  const stream = record(value);
  if (!stream) return;
  if (
    stream.terminal?.state === "sealed" &&
    JSON.stringify(stream.terminal) !== JSON.stringify(value)
  )
    unavailable(stream, "terminal-changed");
  if (value.state === "unavailable") unavailable(stream, value.reason ?? "native-unavailable");
  if (
    value.state === "sealed" &&
    (value.reason !== null || value.lastSequence !== stream.observedThrough)
  )
    unavailable(stream, "terminal-gap");
  stream.terminal = Object.freeze({ ...value });
}

/** Only the original in-process token can enter a synchronous parser scope. */
export function deliverNativeOutputItem(
  item: NativeOutputItem | undefined,
  handler: () => void,
): void {
  const owned = item && runtime.items.get(item);
  const previous = runtime.current;
  runtime.current = owned && item ? item : null;
  try {
    handler();
    if (owned && !owned.delivered) {
      owned.delivered = true;
      owned.batch.delivered++;
      advance(owned.batch.stream);
    }
  } catch (error) {
    if (owned) unavailable(owned.batch.stream, "handler-failed");
    throw error;
  } finally {
    runtime.current = previous;
  }
}
export function discardNativeOutputItems(
  items: readonly (NativeOutputItem | null | undefined)[],
  reason: string,
): void {
  for (const item of items) {
    const owned = item && runtime.items.get(item);
    if (owned) unavailable(owned.batch.stream, reason);
  }
}

/** Attach lineage before frame throttling; no wire fields are added to events. */
export function captureNativeOutputEvent(sessionId: string, event: object): void {
  const previous = runtime.events.get(event);
  if (previous) {
    const owned = runtime.items.get(previous.item);
    if (owned && previous.applied) unavailable(owned.batch.stream, "event-requeued-after-apply");
    else if (owned && previous.sessionId !== sessionId) unavailable(owned.batch.stream, "event-reused");
    return;
  }
  const current = runtime.current;
  const owned = current && runtime.items.get(current);
  if (!current || !owned) return;
  if (logicalSession(owned.batch.stream.source) !== sessionId) {
    unavailable(owned.batch.stream, "event-session-changed");
    return;
  }
  runtime.events.set(event, { item: current, sessionId, applied: false });
  if (owned.batch.stream.queuedEvents < Number.MAX_SAFE_INTEGER) owned.batch.stream.queuedEvents++;
  else unavailable(owned.batch.stream, "event-count-capacity");
}

function originFor(item: NativeOutputItem): NativeOutputEventOrigin | null {
  const owned = runtime.items.get(item); if (!owned) return null;
  if (!owned.origin) {
    owned.origin = Object.freeze({ kind: "native-output-origin" });
    runtime.origins.set(owned.origin, item);
  }
  return owned.origin;
}
/** For queued events created in the original synchronous parser scope. */
export function captureNativeOutputCurrentEvent(event: object): void {
  const owned = runtime.current && runtime.items.get(runtime.current);
  if (owned) captureNativeOutputEvent(logicalSession(owned.batch.stream.source), event);
}
export function getNativeOutputEventOrigin(event: object): NativeOutputEventOrigin | null {
  const origin = runtime.events.get(event);
  return origin ? originFor(origin.item) : null;
}
/** Capture a queued provider event before its delayed presentation. The target
 * comes only from the original private item, never a provider-specific suffix. */
export function captureNativeOutputWorkEvent(work: NativeOutputWork | null, event: object): void {
  const item = work && runtime.origins.get(work.origin);
  const owned = item && runtime.items.get(item);
  if (work && owned) work.run(() => captureNativeOutputEvent(logicalSession(owned.batch.stream.source), event));
}
function runWithNativeOutputEventOrigin<T>(origin: NativeOutputEventOrigin | null, operation: () => T): T {
  const item = origin && runtime.origins.get(origin);
  const before = runtime.current; runtime.current = item ?? null;
  try { return operation(); } finally { runtime.current = before; }
}
export function transferNativeOutputEventOrigin(from: object, to: object): void {
  const source = runtime.events.get(from); if (!source || from === to) return;
  const owned = runtime.items.get(source.item); if (!owned) return;
  const previous = runtime.events.get(to);
  if (source.applied || (previous && previous !== source)) {
    unavailable(owned.batch.stream, "event-origin-transfer-conflict"); return;
  }
  if (previous) return;
  // Replacement aliases one logical event, including its applied marker. It
  // does not mint a second queued event merely because its JS object changed.
  runtime.events.set(to, source);
}
export function retainNativeOutputEventOrigin(origin: NativeOutputEventOrigin, expectedSessionId?: string): NativeOutputWork | null {
  const item = runtime.origins.get(origin); const owned = item && runtime.items.get(item);
  if (!item || !owned) return null;
  const { batch } = owned; const stream = batch.stream;
  if (expectedSessionId !== undefined && logicalSession(stream.source) !== expectedSessionId) {
    unavailable(stream, "causal-session-changed"); return null;
  }
  batch.causalPending ??= 0; stream.causalPending ??= 0; stream.causalFinished ??= 0;
  if (runtime.workJobs >= MAX_CAUSAL_WORK || batch.causalPending >= MAX_BATCH_WORK) {
    unavailable(stream, "causal-work-capacity"); return null;
  }
  runtime.workJobs++; batch.causalPending++; stream.causalPending++;
  let active = true;
  const settle = (reason?: string) => {
    if (!active) return; active = false;
    if (reason) unavailable(stream, /^[a-z0-9-]{1,96}$/.test(reason) ? reason : "causal-work-failed");
    runtime.workJobs--; batch.causalPending--; stream.causalPending--; stream.causalFinished++;
  };
  return Object.freeze({ origin,
    run<T>(operation: () => T): T {
      if (!active) { unavailable(stream, "causal-work-after-finish"); return runWithNativeOutputEventOrigin(null, operation); }
      return runWithNativeOutputEventOrigin(origin, operation);
    },
    finish: () => settle(), fail: (reason: string) => settle(reason || "causal-work-failed"),
  });
}
/** Call synchronously before creating deferred work. Additional file/HTTP input
 * is conservatively unsealed even if its scheduling has a valid parent. */
export function captureNativeOutputWork(options: { label?: string; additionalInput?: boolean } = {}): NativeOutputWork | null {
  const origin = runtime.current && originFor(runtime.current); if (!origin) return null;
  const work = retainNativeOutputEventOrigin(origin);
  if (work && options.additionalInput) {
    const item = runtime.origins.get(origin)!; const stream = runtime.items.get(item)!.batch.stream;
    stream.additionalInputs = (stream.additionalInputs ?? 0) + 1;
    unavailable(stream, "additional-input-unsealed");
  }
  return work;
}
export function trackNativeOutputWork<T>(actual: Promise<T>, work: NativeOutputWork | null): Promise<T> {
  return actual.then((value) => { work?.finish(); return value; }, (error: unknown) => { work?.fail("causal-work-rejected"); throw error; });
}
export function runNativeOutputWork<T>(operation: (work: NativeOutputWork | null) => T | Promise<T>, options: { label?: string; additionalInput?: boolean } = {}): Promise<T> {
  const work = captureNativeOutputWork(options);
  try { return trackNativeOutputWork(Promise.resolve(work ? work.run(() => operation(work)) : operation(null)), work); }
  catch (error) { work?.fail("causal-work-rejected"); return Promise.reject(error); }
}
/** A synchronous sink for an owned deferred job. It never changes ambient
 * lineage across an await; callers must retain the job until its actual end. */
export function nativeOutputSink<Args extends unknown[], Result>(
  work: NativeOutputWork | null,
  sink: (...args: Args) => Result,
): (...args: Args) => Result {
  return (...args) => work ? work.run(() => sink(...args)) : sink(...args);
}
/** Admit before scheduling, and own a returned actual promise after the timer
 * fires. Clearing a running timer never settles the callback's work. */
export function scheduleNativeOutputCallback(
  callback: (work: NativeOutputWork | null) => void | Promise<void>,
  delay: number,
  options: { additionalInput?: boolean } = {},
): ReturnType<typeof setTimeout> {
  const work = captureNativeOutputWork(options);
  const state = { started: false, cancelled: false, work };
  const timer = setTimeout(() => {
    state.started = true;
    const finish = () => {
      runtime.timers.delete(timer);
      if (state.cancelled) work?.fail("causal-timer-retired"); else work?.finish();
    };
    try {
      const actual = nativeOutputSink(work, () => callback(work))();
      if (actual) void Promise.resolve(actual).then(finish, () => { runtime.timers.delete(timer); work?.fail("causal-timer-rejected"); });
      else finish();
    } catch (error) { runtime.timers.delete(timer); work?.fail("causal-timer-rejected"); throw error; }
  }, delay);
  // Untracked ordinary timers need no registry record. Existing callbacks keep
  // their ordinary timing; failed lineage admission has already tainted source.
  if (work) runtime.timers.set(timer, state);
  return timer;
}
export function cancelNativeOutputCallback(timer: ReturnType<typeof setTimeout> | undefined): void {
  if (timer === undefined) return;
  clearTimeout(timer);
  const state = runtime.timers.get(timer);
  if (!state) return;
  state.cancelled = true;
  if (!state.started) { runtime.timers.delete(timer); state.work?.fail("causal-timer-retired"); }
}
/** Called after the actual session reducer/ref update, never after parser return. */
export function markNativeOutputEventsApplied(sessionId: string, events: readonly object[]): void {
  for (const event of events) {
    const origin = runtime.events.get(event);
    if (!origin || origin.applied) continue;
    const owned = runtime.items.get(origin.item);
    if (!owned) continue;
    if (origin.sessionId !== sessionId) {
      unavailable(owned.batch.stream, "event-session-changed");
      continue;
    }
    origin.applied = true;
    if (owned.batch.stream.appliedEvents < Number.MAX_SAFE_INTEGER)
      owned.batch.stream.appliedEvents++;
    else unavailable(owned.batch.stream, "event-count-capacity");
  }
}
export function failNativeOutputEvents(events: readonly object[], reason: string): void {
  for (const event of events) {
    const origin = runtime.events.get(event);
    const owned = origin && runtime.items.get(origin.item);
    if (owned) unavailable(owned.batch.stream, reason);
  }
}
if (hot) hot.dispose(() => invalidateNativeOutputDelivery("tracker-reloaded"));

export function inspectNativeOutputDelivery(sessionId: string) {
  return Object.freeze({
    version: 1 as const,
    qualified: false as const,
    coverage: "unverified" as const, // Deferred provider callbacks and SQL need explicit receipt binding.
    retentionUnavailable: runtime.overflow || runtime.unavailableSessions.has(sessionId),
    streams: Object.freeze(
      [...runtime.streams.values()]
        .filter((stream) => matchesSession(stream.source, sessionId))
        .map((stream) =>
          Object.freeze({
            processEpoch: stream.source.processEpoch,
            streamEpoch: stream.source.streamEpoch,
            streamKind: stream.source.streamKind,
            receivedThrough: stream.receivedThrough,
            deliveredThrough: stream.deliveredThrough,
            queuedEvents: stream.queuedEvents,
            appliedEvents: stream.appliedEvents,
            pendingCausalWork: stream.causalPending ?? 0,
            finishedCausalWork: stream.causalFinished ?? 0,
            additionalUnsealedInputs: stream.additionalInputs ?? 0,
            applicationThrough: null,
            nativeState: stream.terminal?.state ?? "unsealed",
            nativeLastSequence: stream.terminal?.lastSequence ?? null,
            pendingBatches: stream.pending.size,
            unavailableReason: stream.unavailable,
          }),
        ),
    ),
  });
}
