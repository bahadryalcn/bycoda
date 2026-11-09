import { prepareOutputVerification } from "./nativeOutputVerificationClient";
import {
  MAX_OUTPUT_ITEMS as MAX_ITEMS,
  MAX_OUTPUT_BYTES as MAX_BYTES,
} from "./nativeOutputVerification";
export { frameNativeOutputItems } from "./nativeOutputVerification";
import { z } from "zod";
import { isHarnessConstructionId } from "../../../shared/model/harnessProcess";
import { identity, metadataSchema, source, stateSchema } from "./nativeOutputSchemas";

export type NativeOutputMetadata = Readonly<z.infer<typeof metadataSchema>>;
export type NativeOutputState = Readonly<z.infer<typeof stateSchema>>;
export type NativeOutputChannel = NativeOutputMetadata["channel"];
/** Original wire comparison fields only; never a Native authority receipt. */
export type NativeOutputBatchDescriptor = Readonly<
  Omit<NativeOutputMetadata, "available" | "unavailableReason">
>;
export type NativeOutputItemComparison = Readonly<{
  version: 1;
  qualified: false;
  kind: "native-output-item-comparison";
  batch: NativeOutputBatchDescriptor;
  itemIndex: number;
}>;
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
  readonly descriptor: NativeOutputBatchDescriptor;
  stream: Stream;
  sequence: number;
  digestVerified: boolean;
  delivered: number;
  itemCount: number;
  causalPending: number;
};
type Item = {
  batch: Batch;
  readonly comparison: NativeOutputItemComparison;
  delivered: boolean;
  outcome:
    | "pending-parser"
    | "emitted"
    | "accepted-projection"
    | "supported-no-effect"
    | "unsupported";
  outcomeReason: string | null;
  origin?: NativeOutputEventOrigin;
};
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
  diagnosticsTruncated?: boolean;
};
type EventOrigin = { origin: NativeOutputEventOrigin; sessionId: string; applied: boolean };
type Runtime = {
  streams: Map<string, Stream>;
  items: WeakMap<NativeOutputItem, Item>;
  events: WeakMap<object, EventOrigin>;
  current: NativeOutputEventOrigin | null;
  hashJobs: number;
  overflow: boolean;
  unavailableSessions: Set<string>;
  /** Exact original process invalidations, including sources not yet observed. */
  constructionInvalidations: Map<string, string>;
  constructionInvalidationFailure: string | null;
  origins: WeakMap<NativeOutputEventOrigin, readonly NativeOutputItem[]>;
  outcomes: Map<NativeOutputItem, Item>;
  outcomesByStream: Map<Stream, Set<Item>>;
  works: WeakMap<NativeOutputWork, { active: boolean; origin: NativeOutputEventOrigin }>;
  lineageVersion: number;
  workJobs: number;
  timers: Map<
    ReturnType<typeof setTimeout>,
    { started: boolean; cancelled: boolean; work: NativeOutputWork | null }
  >;
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
  constructionInvalidations: new Map(),
  constructionInvalidationFailure: null,
  origins: new WeakMap(),
  outcomes: new Map(),
  outcomesByStream: new Map(),
  works: new WeakMap(),
  lineageVersion: 2,
  workJobs: 0,
  timers: new Map(),
};
runtime.origins ??= new WeakMap();
// Pre-upgrade HMR handles carried only one item. They must never be interpreted
// as a new multi-input proof, or attached to work from the replacement module.
if (runtime.lineageVersion !== 2) {
  for (const stream of runtime.streams.values()) stream.unavailable ??= "lineage-upgraded";
  runtime.origins = new WeakMap();
  runtime.events = new WeakMap();
  runtime.current = null;
  runtime.lineageVersion = 2;
}
runtime.outcomes ??= new Map();
// Preserve diagnostics across hot replacement without rescanning the global
// retained history on every stream inspection.
if (!runtime.outcomesByStream) {
  runtime.outcomesByStream = new Map();
  for (const item of runtime.outcomes.values()) {
    let items = runtime.outcomesByStream.get(item.batch.stream);
    if (!items) runtime.outcomesByStream.set(item.batch.stream, (items = new Set()));
    items.add(item);
  }
}
runtime.works ??= new WeakMap();
runtime.workJobs ??= 0;
runtime.timers ??= new Map();
// A pre-upgrade hot runtime cannot reconstruct invalidations it never retained.
// Keep that history unknown; do not clear old session quarantine or source work.
const constructionHistoryMissing = runtime.constructionInvalidations === undefined;
runtime.constructionInvalidations ??= new Map();
runtime.constructionInvalidationFailure ??= null;
if (constructionHistoryMissing) {
  runtime.constructionInvalidationFailure ??= "construction-invalidation-history-unavailable";
  runtime.overflow = true;
  for (const stream of runtime.streams.values())
    unavailable(stream, runtime.constructionInvalidationFailure);
}
if (hot) hot.data.nativeOutputDelivery = runtime;
const MAX_STREAMS = 512;
const MAX_HASH_JOBS = 32;
const MAX_PENDING_BATCHES = 128;
const MAX_CAUSAL_WORK = 1024;
const MAX_BATCH_WORK = 128;
const MAX_RETAINED_OUTCOMES = 32768;
const MAX_JOIN_ITEMS = 128;
const logicalSession = (value: Source) => value.logicalSessionId ?? value.sessionId;
const matchesSession = (value: Source, sessionId: string) =>
  value.sessionId === sessionId || logicalSession(value) === sessionId;

function key(value: Source): string {
  return JSON.stringify([value.processEpoch, value.streamEpoch]);
}
function constructionKey(sessionId: string, constructionId: string): string {
  return JSON.stringify([sessionId, constructionId]);
}
function constructionInvalidation(value: Source): string | undefined {
  return value.streamKind === "process"
    ? runtime.constructionInvalidations.get(constructionKey(value.sessionId, value.streamEpoch))
    : undefined;
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
/** A sealed stream that is either fully delivered or already unavailable (and
 * so will deliver nothing more), with no causal work in flight, can no longer
 * change what is delivered. Evicting one keeps the stream cap bounded by live
 * work instead of by the process lifetime. Session-level retention stays
 * recorded in unavailableSessions and construction invalidations. A late
 * duplicate for an evicted key is re-recorded and fails closed for that stream. */
function evictSettledStream(): boolean {
  for (const [id, stream] of runtime.streams) {
    if (
      stream.terminal?.state !== "sealed" ||
      stream.causalPending > 0 ||
      (!stream.unavailable &&
        (stream.pending.size > 0 || stream.deliveredThrough !== stream.observedThrough))
    )
      continue;
    runtime.streams.delete(id);
    runtime.outcomesByStream.delete(stream);
    return true;
  }
  return false;
}
function record(value: Source): Stream | null {
  const id = key(value);
  const previous = runtime.streams.get(id);
  if (previous) {
    if (previous.sourceKey !== binding(value)) unavailable(previous, "source-changed");
    const invalidation = constructionInvalidation(value) ?? runtime.constructionInvalidationFailure;
    if (invalidation) unavailable(previous, invalidation);
    return previous;
  }
  if (runtime.streams.size >= MAX_STREAMS && !evictSettledStream()) {
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
    unavailable:
      constructionInvalidation(value) ??
      runtime.constructionInvalidationFailure ??
      (ownerKnown(value) ? null : "source-unavailable"),
    causalPending: 0,
    causalFinished: 0,
    additionalInputs: 0,
  };
  runtime.streams.set(id, stream);
  return stream;
}
/** Original Native process correlation only: never a grant, current-route lookup,
 * registry processEpoch, or a reason to clear an existing unknown-session flag. */
export function invalidateNativeOutputConstruction(
  sessionId: string,
  constructionId: string,
  reason: string,
): void {
  const retainedReason = identity.safeParse(reason).success
    ? reason
    : "process-construction-invalidated";
  if (!identity.safeParse(sessionId).success || !isHarnessConstructionId(constructionId)) {
    quarantineNativeOutputSession(sessionId, retainedReason);
    return;
  }
  const id = constructionKey(sessionId, constructionId);
  if (!runtime.constructionInvalidations.has(id)) {
    // No eviction: even an already observed original can emit delayed metadata.
    // Losing an unrecorded invalidation makes retention globally unknown instead.
    if (runtime.constructionInvalidations.size >= MAX_STREAMS) {
      runtime.overflow = true;
      runtime.constructionInvalidationFailure ??= "construction-invalidation-capacity";
      invalidateNativeOutputDelivery(runtime.constructionInvalidationFailure);
      return;
    }
    runtime.constructionInvalidations.set(id, retainedReason);
  }
  const originalReason = runtime.constructionInvalidations.get(id)!;
  for (const stream of runtime.streams.values())
    if (
      stream.source.streamKind === "process" &&
      stream.source.sessionId === sessionId &&
      stream.source.streamEpoch === constructionId
    )
      unavailable(stream, originalReason);
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
/** An invoked source with no usable identity can emit its first metadata later. */
export function quarantineNativeOutputSession(sessionId: string, reason: string): void {
  flagUnknownSession(sessionId);
  invalidateNativeOutputSession(sessionId, reason);
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
  let verify: () => Promise<string>;
  try {
    verify = prepareOutputVerification(channel, items, value.utf8Bytes);
  } catch {
    unavailable(stream, "invalid-payload");
    return;
  }
  const descriptor: NativeOutputBatchDescriptor = Object.freeze({
    version: value.version,
    qualified: value.qualified,
    processEpoch: value.processEpoch,
    streamEpoch: value.streamEpoch,
    streamKind: value.streamKind,
    sessionId: value.sessionId,
    ...(value.logicalSessionId === undefined ? {} : { logicalSessionId: value.logicalSessionId }),
    sourceStoreId: value.sourceStoreId,
    sourceProfileId: value.sourceProfileId,
    storeInstance: value.storeInstance,
    processId: value.processId,
    // Wire ownerEpoch is the captured recipient incarnation, not the private
    // original producer owner or a grant supplied by the renderer.
    ownerEpoch: value.ownerEpoch,
    sequence: value.sequence,
    channel: value.channel,
    itemCount: value.itemCount,
    utf8Bytes: value.utf8Bytes,
    payloadSha256: value.payloadSha256,
    digestEncoding: value.digestEncoding,
  });
  const batch: Batch = {
    descriptor,
    stream,
    sequence: value.sequence,
    digestVerified: false,
    delivered: 0,
    itemCount: items.length,
    causalPending: 0,
  };
  stream.observedThrough = value.sequence;
  stream.pending.set(batch.sequence, batch);
  const tokens = items.map((_, itemIndex) => {
    const token: NativeOutputItem = Object.freeze({ kind: "native-output-item" });
    const comparison: NativeOutputItemComparison = Object.freeze({
      version: 1,
      qualified: false,
      kind: "native-output-item-comparison",
      batch: descriptor,
      itemIndex,
    });
    const owned: Item = {
      batch,
      comparison,
      delivered: false,
      outcome: "pending-parser",
      outcomeReason: null,
    };
    runtime.items.set(token, owned);
    // Bounded diagnostic history; private token ownership lives in the WeakMap.
    if (runtime.outcomes.size >= MAX_RETAINED_OUTCOMES) {
      const oldest = runtime.outcomes.keys().next().value!;
      const removed = runtime.outcomes.get(oldest)!;
      removed.batch.stream.diagnosticsTruncated = true;
      const items = runtime.outcomesByStream.get(removed.batch.stream);
      items?.delete(removed);
      if (items?.size === 0) runtime.outcomesByStream.delete(removed.batch.stream);
      runtime.outcomes.delete(oldest);
    }
    runtime.outcomes.set(token, owned);
    let streamOutcomes = runtime.outcomesByStream.get(stream);
    if (!streamOutcomes) runtime.outcomesByStream.set(stream, (streamOutcomes = new Set()));
    streamOutcomes.add(owned);
    return token;
  });
  runtime.hashJobs++;
  void Promise.resolve()
    .then(verify)
    .then((actual) => {
      if (actual !== value.payloadSha256) unavailable(stream, "payload-digest");
      else {
        batch.digestVerified = true;
        advance(stream);
      }
    })
    .catch((error) =>
      unavailable(
        stream,
        error instanceof Error && error.message === "invalid-payload"
          ? "invalid-payload"
          : "digest-unavailable",
      ),
    )
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
  runtime.current = owned && item ? originFor(item) : null;
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
    if (owned) {
      owned.outcome = "unsupported";
      owned.outcomeReason ??= reason;
      unavailable(owned.batch.stream, reason);
    }
  }
}

/** Attach lineage before frame throttling; no wire fields are added to events. */
export function captureNativeOutputEvent(sessionId: string, event: object): void {
  const previous = runtime.events.get(event);
  if (previous) {
    if (previous.applied) failOrigin(previous.origin, "event-requeued-after-apply");
    else if (previous.sessionId !== sessionId) failOrigin(previous.origin, "event-reused");
    return;
  }
  const current = runtime.current;
  const items = current && originItems(current);
  if (!current || !items?.length) return;
  if (items.some((item) => logicalSession(item.batch.stream.source) !== sessionId)) {
    failOrigin(current, "event-session-changed");
    return;
  }
  runtime.events.set(event, { origin: current, sessionId, applied: false });
  for (const item of items) if (item.outcome === "pending-parser") item.outcome = "emitted";
  const streams =
    items.length === 1 ? [items[0].batch.stream] : new Set(items.map((item) => item.batch.stream));
  for (const stream of streams) {
    if (stream.queuedEvents < Number.MAX_SAFE_INTEGER) stream.queuedEvents++;
    else unavailable(stream, "event-count-capacity");
  }
}

function originFor(item: NativeOutputItem): NativeOutputEventOrigin | null {
  const owned = runtime.items.get(item);
  if (!owned) return null;
  if (!owned.origin) {
    owned.origin = Object.freeze({ kind: "native-output-origin" });
    runtime.origins.set(owned.origin, Object.freeze([item]));
  }
  return owned.origin;
}
function originItems(origin: NativeOutputEventOrigin): Item[] | null {
  const tokens = runtime.origins.get(origin);
  if (!tokens?.length) return null;
  const items = tokens.map((token) => runtime.items.get(token));
  return items.every((item): item is Item => !!item) ? items : null;
}
function failOrigin(origin: NativeOutputEventOrigin, reason: string) {
  for (const item of originItems(origin) ?? []) {
    item.outcome = "unsupported";
    item.outcomeReason ??= reason;
    unavailable(item.batch.stream, reason);
  }
}
/** Original immutable constituents, including before their digest completes. */
export function getNativeOutputEventOriginConstituents(
  origin: NativeOutputEventOrigin,
): readonly NativeOutputEventOrigin[] | null {
  const tokens = runtime.origins.get(origin);
  if (!tokens?.length || !originItems(origin)) return null;
  return Object.freeze(tokens.map((token) => originFor(token)!));
}
/** For queued events created in the original synchronous parser scope. */
export function captureNativeOutputCurrentEvent(event: object): void {
  const owned = runtime.current && originItems(runtime.current)?.[0];
  if (owned) captureNativeOutputEvent(logicalSession(owned.batch.stream.source), event);
}
export function getNativeOutputEventOrigin(event: object): NativeOutputEventOrigin | null {
  const origin = runtime.events.get(event);
  return origin?.origin ?? null;
}
/** Recheck on each use, including after the real SQL ACK. Null also means the
 * original digest is still pending; no caller DTO can replace this lookup.
 * A previously returned frozen value remains only an untrusted comparison
 * claim if the original source later becomes unavailable. */
export function getNativeOutputEventOriginComparison(
  origin: NativeOutputEventOrigin,
  expectedSessionId?: string,
): NativeOutputItemComparison | null {
  const items = runtime.origins.get(origin);
  const owned = items?.length === 1 && runtime.items.get(items[0]);
  return owned ? originalComparison(owned, expectedSessionId, true) : null;
}
function originalComparison(
  owned: Item,
  expectedSessionId: string | undefined,
  completed: boolean,
): NativeOutputItemComparison | null {
  if (completed && (!owned.delivered || !owned.batch.digestVerified)) return null;
  // A retained pre-upgrade HMR item has no exact descriptor/index. Never
  // reconstruct either from the current stream or from a caller's fields.
  const comparison = owned.comparison;
  const descriptor = owned.batch.descriptor;
  if (
    !comparison ||
    !descriptor ||
    comparison.batch !== descriptor ||
    !Number.isSafeInteger(comparison.itemIndex) ||
    comparison.itemIndex < 0 ||
    comparison.itemIndex >= descriptor.itemCount
  )
    return null;
  const stream = owned.batch.stream;
  if (
    runtime.overflow ||
    stream.unavailable ||
    !ownerKnown(descriptor) ||
    runtime.streams.get(key(descriptor)) !== stream ||
    stream.sourceKey !== binding(descriptor) ||
    runtime.unavailableSessions.has(descriptor.sessionId) ||
    runtime.unavailableSessions.has(logicalSession(descriptor)) ||
    (expectedSessionId !== undefined && logicalSession(descriptor) !== expectedSessionId)
  )
    return null;
  return comparison;
}
/** Capture exact private originals at write admission while their digest can
 * still be pending. This is only an immutable comparison snapshot; final export
 * must recheck completed originals after the actual ACK. */
export function snapshotNativeOutputEventOriginComparisons(
  origin: NativeOutputEventOrigin,
  expectedSessionId?: string,
): readonly NativeOutputItemComparison[] | null {
  const items = originItems(origin);
  if (!items) return null;
  const comparisons = items.map((item) => originalComparison(item, expectedSessionId, false));
  return comparisons.every((item): item is NativeOutputItemComparison => item !== null)
    ? Object.freeze(comparisons)
    : null;
}
/** All-or-nothing: one invalid constituent invalidates the entire join. */
export function getNativeOutputEventOriginComparisons(
  origin: NativeOutputEventOrigin,
  expectedSessionId?: string,
): readonly NativeOutputItemComparison[] | null {
  const originals = getNativeOutputEventOriginConstituents(origin);
  if (!originals) return null;
  const comparisons = originals.map((original) =>
    getNativeOutputEventOriginComparison(original, expectedSessionId),
  );
  return comparisons.every(
    (comparison): comparison is NativeOutputItemComparison => comparison !== null,
  )
    ? Object.freeze(comparisons)
    : null;
}
/** Capture a queued provider event before its delayed presentation. The target
 * comes only from the original private item, never a provider-specific suffix. */
export function captureNativeOutputWorkEvent(work: NativeOutputWork | null, event: object): void {
  const owned = work && originItems(work.origin)?.[0];
  if (work && owned)
    work.run(() => captureNativeOutputEvent(logicalSession(owned.batch.stream.source), event));
}
function runWithNativeOutputEventOrigin<T>(
  origin: NativeOutputEventOrigin | null,
  operation: () => T,
): T {
  const before = runtime.current;
  runtime.current = origin && originItems(origin) ? origin : null;
  try {
    return operation();
  } finally {
    runtime.current = before;
  }
}
/** Preserve ordinary work without claiming partial ancestry after a failed join. */
export function runWithoutNativeOutputOrigin<T>(operation: () => T): T {
  return runWithNativeOutputEventOrigin(null, operation);
}
export function transferNativeOutputEventOrigin(from: object, to: object): void {
  const source = runtime.events.get(from);
  if (!source || from === to) return;
  if (!originItems(source.origin)) return;
  const previous = runtime.events.get(to);
  if (source.applied || (previous && previous !== source)) {
    failOrigin(source.origin, "event-origin-transfer-conflict");
    return;
  }
  if (previous) return;
  // Replacement aliases one logical event, including its applied marker. It
  // does not mint a second queued event merely because its JS object changed.
  runtime.events.set(to, source);
}
export function retainNativeOutputEventOrigin(
  origin: NativeOutputEventOrigin,
  expectedSessionId?: string,
): NativeOutputWork | null {
  const items = originItems(origin);
  if (!items) return null;
  if (
    expectedSessionId !== undefined &&
    items.some((item) => logicalSession(item.batch.stream.source) !== expectedSessionId)
  ) {
    failOrigin(origin, "causal-session-changed");
    return null;
  }
  const batches =
    items.length === 1 ? [items[0].batch] : [...new Set(items.map((item) => item.batch))];
  const streams =
    items.length === 1 ? [items[0].batch.stream] : new Set(items.map((item) => item.batch.stream));
  for (const batch of batches) batch.causalPending ??= 0;
  for (const stream of streams) {
    stream.causalPending ??= 0;
    stream.causalFinished ??= 0;
  }
  if (
    runtime.workJobs >= MAX_CAUSAL_WORK ||
    batches.some((batch) => batch.causalPending >= MAX_BATCH_WORK)
  ) {
    failOrigin(origin, "causal-work-capacity");
    return null;
  }
  runtime.workJobs++;
  for (const batch of batches) batch.causalPending++;
  for (const stream of streams) stream.causalPending++;
  const state = { active: true, origin };
  const settle = (reason?: string) => {
    if (!state.active) return;
    state.active = false;
    if (reason)
      failOrigin(origin, /^[a-z0-9-]{1,96}$/.test(reason) ? reason : "causal-work-failed");
    runtime.workJobs--;
    for (const batch of batches) batch.causalPending--;
    for (const stream of streams) {
      stream.causalPending--;
      stream.causalFinished++;
    }
  };
  const work: NativeOutputWork = Object.freeze({
    origin,
    run<T>(operation: () => T): T {
      if (!state.active) {
        failOrigin(origin, "causal-work-after-finish");
        return runWithNativeOutputEventOrigin(null, operation);
      }
      return runWithNativeOutputEventOrigin(origin, operation);
    },
    finish: () => settle(),
    fail: (reason: string) => settle(reason || "causal-work-failed"),
  });
  runtime.works.set(work, state);
  return work;
}
/** Intentional ancestry union, distinct from replacement aliases. Admission is
 * atomic: authentic active owners remain held until the joined owner exists. */
export function joinNativeOutputWorks(
  works: readonly NativeOutputWork[],
  expectedSessionId?: string,
): NativeOutputWork | null {
  const tokens = new Set<NativeOutputItem>();
  let scope: NativeOutputBatchDescriptor | undefined;
  let reason: string | null = null;
  if (!works.length || works.length > MAX_JOIN_ITEMS) reason = "causal-join-capacity";
  for (const work of works.slice(0, MAX_JOIN_ITEMS)) {
    const state = runtime.works.get(work);
    const members =
      state?.active && state.origin === work.origin && runtime.origins.get(state.origin);
    if (!members) {
      reason ??= "causal-join-invalid-owner";
      continue;
    }
    for (const token of members) {
      const item = runtime.items.get(token);
      if (!item) {
        reason ??= "causal-join-invalid-item";
        continue;
      }
      const descriptor = item.batch.descriptor;
      scope ??= descriptor;
      if (
        scope.processEpoch !== descriptor.processEpoch ||
        scope.sessionId !== descriptor.sessionId ||
        logicalSession(scope) !== logicalSession(descriptor) ||
        scope.streamKind !== descriptor.streamKind ||
        scope.sourceStoreId !== descriptor.sourceStoreId ||
        scope.sourceProfileId !== descriptor.sourceProfileId ||
        scope.storeInstance !== descriptor.storeInstance ||
        scope.processId !== descriptor.processId ||
        scope.ownerEpoch !== descriptor.ownerEpoch ||
        (expectedSessionId !== undefined && logicalSession(descriptor) !== expectedSessionId)
      )
        reason ??= "causal-join-scope";
      if (
        item.batch.stream.unavailable ||
        runtime.streams.get(key(descriptor)) !== item.batch.stream ||
        runtime.overflow ||
        runtime.unavailableSessions.has(logicalSession(descriptor))
      )
        reason ??= "causal-join-unavailable";
      tokens.add(token);
    }
  }
  if (tokens.size > MAX_JOIN_ITEMS || !tokens.size) reason ??= "causal-join-capacity";
  if (reason) {
    for (const token of tokens) {
      const origin = originFor(token);
      if (origin) failOrigin(origin, reason);
    }
    return null;
  }
  const origin: NativeOutputEventOrigin = Object.freeze({ kind: "native-output-origin" });
  runtime.origins.set(origin, Object.freeze([...tokens]));
  return retainNativeOutputEventOrigin(origin, expectedSessionId);
}
/** Explicit parser census classification; a successful handler return is never
 * evidence of supported no-effect. Only the current actual input is classified. */
export function markNativeOutputSupportedNoEffect(reason: string): void {
  for (const item of runtime.current ? (originItems(runtime.current) ?? []) : []) {
    if (item.outcome === "pending-parser") {
      item.outcome = "supported-no-effect";
      item.outcomeReason = reason;
    }
  }
}
/** Call synchronously before creating deferred work. Additional file/HTTP input
 * is conservatively unsealed even if its scheduling has a valid parent. */
export function captureNativeOutputWork(
  options: { label?: string; additionalInput?: boolean } = {},
): NativeOutputWork | null {
  const origin = runtime.current;
  if (!origin) return null;
  const work = retainNativeOutputEventOrigin(origin);
  if (options.additionalInput) noteNativeOutputAdditionalInput(work);
  return work;
}
/** A user decision, filesystem or HTTP result is not sealed by its parent's
 * stdout digest. This records that gap without releasing any actual work. */
export function noteNativeOutputAdditionalInput(work: NativeOutputWork | null): void {
  for (const stream of new Set(
    (work ? (originItems(work.origin) ?? []) : []).map((item) => item.batch.stream),
  )) {
    if ((stream.additionalInputs ?? 0) < Number.MAX_SAFE_INTEGER)
      stream.additionalInputs = (stream.additionalInputs ?? 0) + 1;
    unavailable(stream, "additional-input-unsealed");
  }
}
export function trackNativeOutputWork<T>(
  actual: Promise<T>,
  work: NativeOutputWork | null,
): Promise<T> {
  return actual.then(
    (value) => {
      work?.finish();
      return value;
    },
    (error: unknown) => {
      work?.fail("causal-work-rejected");
      throw error;
    },
  );
}
export function runNativeOutputWork<T>(
  operation: (work: NativeOutputWork | null) => T | Promise<T>,
  options: { label?: string; additionalInput?: boolean } = {},
): Promise<T> {
  const work = captureNativeOutputWork(options);
  try {
    return trackNativeOutputWork(
      Promise.resolve(work ? work.run(() => operation(work)) : operation(null)),
      work,
    );
  } catch (error) {
    work?.fail("causal-work-rejected");
    return Promise.reject(error);
  }
}
/** A synchronous sink for an owned deferred job. It never changes ambient
 * lineage across an await; callers must retain the job until its actual end. */
export function nativeOutputSink<Args extends unknown[], Result>(
  work: NativeOutputWork | null,
  sink: (...args: Args) => Result,
): (...args: Args) => Result {
  return (...args) => (work ? work.run(() => sink(...args)) : sink(...args));
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
      if (state.cancelled) work?.fail("causal-timer-retired");
      else work?.finish();
    };
    try {
      const actual = nativeOutputSink(work, () => callback(work))();
      if (actual)
        void Promise.resolve(actual).then(finish, () => {
          runtime.timers.delete(timer);
          work?.fail("causal-timer-rejected");
        });
      else finish();
    } catch (error) {
      runtime.timers.delete(timer);
      work?.fail("causal-timer-rejected");
      throw error;
    }
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
  if (!state.started) {
    runtime.timers.delete(timer);
    state.work?.fail("causal-timer-retired");
  }
}
/** Called after the actual session reducer/ref update, never after parser return. */
export function markNativeOutputEventsApplied(sessionId: string, events: readonly object[]): void {
  for (const event of events) {
    const origin = runtime.events.get(event);
    if (!origin || origin.applied) continue;
    const items = originItems(origin.origin);
    if (!items) continue;
    if (origin.sessionId !== sessionId) {
      failOrigin(origin.origin, "event-session-changed");
      continue;
    }
    origin.applied = true;
    const streams =
      items.length === 1
        ? [items[0].batch.stream]
        : new Set(items.map((item) => item.batch.stream));
    for (const stream of streams) {
      if (stream.appliedEvents < Number.MAX_SAFE_INTEGER) stream.appliedEvents++;
      else unavailable(stream, "event-count-capacity");
    }
  }
}
export function failNativeOutputEvents(events: readonly object[], reason: string): void {
  for (const event of events) {
    const origin = runtime.events.get(event);
    if (origin) failOrigin(origin.origin, reason);
  }
}
/** Called only after the accepted model object was enrolled by projection. */
export function markNativeOutputOriginProjectionAccepted(
  origin: NativeOutputEventOrigin,
  sessionId: string,
): void {
  for (const item of originItems(origin) ?? []) {
    if (logicalSession(item.batch.stream.source) !== sessionId) {
      failOrigin(origin, "projection-session-changed");
      return;
    }
    if (item.outcome !== "unsupported") item.outcome = "accepted-projection";
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
            outcomes: Object.freeze(
              [...(runtime.outcomesByStream.get(stream) ?? [])].map((item) =>
                Object.freeze({
                  sequence: item.batch.sequence,
                  itemIndex: item.comparison.itemIndex,
                  outcome: item.outcome,
                  reason: item.outcomeReason,
                  unavailableReason: stream.unavailable,
                }),
              ),
            ),
            diagnosticsTruncated: stream.diagnosticsTruncated === true,
            unavailableReason: stream.unavailable,
          }),
        ),
    ),
  });
}
