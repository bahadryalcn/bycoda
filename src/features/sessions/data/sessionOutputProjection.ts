import type { Session } from "../model/session";
import { getSessions, subscribeSessionCommits } from "../model/sessionsStore";
import {
  getNativeOutputEventOrigin,
  failNativeOutputEvents,
  getNativeOutputEventOriginComparisons,
  getNativeOutputEventOriginConstituents,
  markNativeOutputOriginProjectionAccepted,
  snapshotNativeOutputEventOriginComparisons,
  retainNativeOutputEventOrigin,
  type NativeOutputItemComparison,
} from "../../../integrations/harness/core/nativeOutputDelivery";

// Private renderer model ancestry and ordinary storage acknowledgements.
// Neither an accepted model version nor a NORMAL SQLite ACK is a Native/FULL
// checkpoint or an applied/durable provider watermark.
type Origin = NonNullable<ReturnType<typeof getNativeOutputEventOrigin>>;
type Work = NonNullable<ReturnType<typeof retainNativeOutputEventOrigin>>;
type Record = {
  origin: Origin;
  work: Work;
  version: number;
  writers: number;
  writingVersions: Map<number, number>;
  replacementRequired: boolean;
  settled: boolean;
};
type Node = { lineage: Lineage; version: number; session: Session };
type Lineage = {
  id: string;
  current: Node | null;
  version: number;
  retired: string | null;
  records: Map<Origin, Record>;
  acknowledged: number;
  failedWrites: number;
  lastAck: StorageAck | null;
  fullOrigins: Map<Origin, number>;
  fullCandidate?: SessionOutputFullCandidate;
  fullUnavailable: string | null;
  fullReplacementRequired: boolean;
};
export type SessionOutputWrite = Readonly<{ kind: "session-output-write" }>;
export type StorageAck = Readonly<{
  kind: "replace" | "delta";
  revision: number;
  updatedAt: number;
  /** Locator only. Native must resolve its private actual-write ledger. */
  nativeWriteId?: string;
}>;
type CandidateAck = StorageAck & Readonly<{ nativeWriteId: string }>;
type Write = {
  node: Node;
  records: Record[];
  settled: boolean;
  counted?: boolean;
  candidate?: SessionOutputFullCandidate;
};
/** Local comparison handle only. Never a Native/FULL SQL receipt. */
export type SessionOutputFullCandidate = Readonly<{ kind: "session-output-full-candidate" }>;
type FullCandidate = {
  token: SessionOutputFullCandidate;
  node: Node;
  origins: readonly Origin[];
  items: readonly NativeOutputItemComparison[];
  payload: Readonly<object>;
  bytes: number;
  kind: StorageAck["kind"];
  ack: CandidateAck | null;
  inFlight: boolean;
  unavailable: string | null;
};
export type SessionOutputFullCandidateComparison = Readonly<{
  version: 1;
  kind: "session-output-full-candidate-comparison";
  qualified: false;
  fullCheckpoint: false;
  applicationThrough: null;
  nativeCommitmentRequired: true;
  sessionId: string;
  modelVersion: number;
  command: "session_upsert" | "session_apply_delta";
  admittedPayload: Readonly<object>;
  acknowledgement: CandidateAck;
  items: readonly NativeOutputItemComparison[];
}>;
type Runtime = {
  nodes: WeakMap<Session, Node>;
  lineages: Map<string, Lineage>;
  writes: WeakMap<SessionOutputWrite, Write>;
  listeners: Set<() => void>;
  queuedNotice: boolean;
  retained: number;
  overflow: boolean;
  activeWrites: number;
  fullCandidates: Map<SessionOutputFullCandidate, FullCandidate>;
  fullHandles: WeakMap<SessionOutputFullCandidate, FullCandidate>;
  fullBytes: number;
  fullOriginCount: number;
  fullCandidateOriginCount: number;
  fullOverflow: boolean;
  unsubscribe?: () => void;
  noteMutation?: (sessionId: string) => void;
};
const hot = import.meta.hot;
const runtime: Runtime = hot?.data.sessionOutputProjection ?? {
  nodes: new WeakMap(),
  lineages: new Map(),
  writes: new WeakMap(),
  listeners: new Set(),
  queuedNotice: false,
  retained: 0,
  overflow: false,
  activeWrites: 0,
  fullCandidates: new Map(),
  fullHandles: new WeakMap(),
  fullBytes: 0,
  fullOriginCount: 0,
  fullCandidateOriginCount: 0,
  fullOverflow: false,
};
runtime.fullCandidates ??= new Map();
runtime.fullHandles ??= new WeakMap();
runtime.fullBytes ??= 0;
runtime.fullOriginCount ??= 0;
runtime.fullCandidateOriginCount ??= 0;
runtime.fullOverflow ??= false;
for (const lineage of runtime.lineages.values()) {
  if (!lineage.fullOrigins) {
    lineage.fullOrigins = new Map();
    lineage.fullUnavailable = "full-history-unavailable";
    lineage.fullReplacementRequired = true;
  }
}
if (!Number.isSafeInteger(runtime.activeWrites)) {
  runtime.activeWrites = 0;
  runtime.overflow = true;
}
if (hot) hot.data.sessionOutputProjection = runtime;
const MAX_SESSIONS = 512;
const MAX_ORIGINS = 4096;
const MAX_TOTAL_ORIGINS = 32768;
const MAX_WRITES = 4096;
export const SESSION_OUTPUT_FULL_LIMITS = Object.freeze({
  candidates: 128,
  payloadBytesPerCandidate: 2 * 1024 * 1024,
  payloadBytesTotal: 16 * 1024 * 1024,
  originsPerSession: 4096,
  originsTotal: 32768,
  candidateOriginReferencesTotal: 32768,
  payloadDepth: 64,
  payloadEntries: 262144,
});
function dropFullCandidate(candidate: FullCandidate) {
  if (!runtime.fullCandidates.delete(candidate.token)) return;
  runtime.fullHandles.delete(candidate.token);
  runtime.fullBytes -= candidate.bytes;
  runtime.fullCandidateOriginCount -= candidate.origins.length;
  if (candidate.node.lineage.fullCandidate === candidate.token)
    candidate.node.lineage.fullCandidate = undefined;
}
function invalidateFullCandidate(lineage: Lineage, reason: string) {
  const candidate = lineage.fullCandidate && runtime.fullHandles.get(lineage.fullCandidate);
  if (!candidate) return;
  candidate.unavailable ??= reason;
  // A reader's retirement must not release an actual admitted write.
  if (!candidate.inFlight) dropFullCandidate(candidate);
}
function retainFullOrigin(lineage: Lineage, origin: Origin, version: number) {
  if (lineage.fullUnavailable || runtime.fullOverflow) return;
  if (!lineage.fullOrigins.has(origin)) {
    if (
      lineage.fullOrigins.size >= SESSION_OUTPUT_FULL_LIMITS.originsPerSession ||
      runtime.fullOriginCount >= SESSION_OUTPUT_FULL_LIMITS.originsTotal
    ) {
      lineage.fullUnavailable = "full-origin-capacity";
      invalidateFullCandidate(lineage, lineage.fullUnavailable);
      return;
    }
    runtime.fullOriginCount++;
  }
  lineage.fullOrigins.set(origin, version);
}
function fullCurrent(candidate: FullCandidate): boolean {
  const { node } = candidate;
  return (
    !runtime.fullOverflow &&
    !runtime.overflow &&
    !candidate.unavailable &&
    !node.lineage.fullUnavailable &&
    !node.lineage.retired &&
    node.lineage.current === node &&
    runtime.nodes.get(node.session) === node &&
    node.lineage.fullCandidate === candidate.token
  );
}
function finishFullCandidate(write: Write, ack: StorageAck | null, reason?: string) {
  const candidate = write.candidate && runtime.fullHandles.get(write.candidate);
  if (!candidate) return;
  candidate.inFlight = false;
  if (reason || !ack || candidate.kind !== ack.kind || !fullCurrent(candidate)) {
    candidate.unavailable ??= reason ?? "full-write-retired";
    dropFullCandidate(candidate);
    return;
  }
  if (ack.kind === "replace") write.node.lineage.fullReplacementRequired = false;
  if (write.node.lineage.fullReplacementRequired) {
    candidate.unavailable = "full-replacement-required";
    dropFullCandidate(candidate);
    return;
  }
  if (
    typeof ack.nativeWriteId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(ack.nativeWriteId)
  ) {
    candidate.unavailable = "native-write-locator-unavailable";
    dropFullCandidate(candidate);
    return;
  }
  candidate.ack = Object.freeze({ ...ack, nativeWriteId: ack.nativeWriteId });
}
function boundedJsonSnapshot(input: object): { payload: Readonly<object>; bytes: number } {
  let size = 0;
  let entries = 0;
  const active = new WeakSet<object>();
  const encoder = new TextEncoder();
  function charge(value: string) {
    if (value.length > SESSION_OUTPUT_FULL_LIMITS.payloadBytesPerCandidate)
      throw new Error("capacity");
    size += encoder.encode(value).byteLength + 4;
    if (size > SESSION_OUTPUT_FULL_LIMITS.payloadBytesPerCandidate) throw new Error("capacity");
  }
  function hasSerializationOverride(value: object): boolean {
    let current: object | null = value;
    let depth = 0;
    while (current) {
      if (++depth > SESSION_OUTPUT_FULL_LIMITS.payloadDepth) throw new Error("unsupported");
      // Inspect descriptors, never invoke a toJSON getter. Even a non-callable
      // shadow is unsupported: cloning must not uncover an inherited hook.
      if (Object.getOwnPropertyDescriptor(current, "toJSON")) return true;
      current = Object.getPrototypeOf(current);
    }
    return false;
  }
  function copy(value: unknown, depth: number): unknown {
    if (
      ++entries > SESSION_OUTPUT_FULL_LIMITS.payloadEntries ||
      depth > SESSION_OUTPUT_FULL_LIMITS.payloadDepth
    )
      throw new Error("capacity");
    if (typeof value === "string") {
      charge(value);
      return value;
    }
    if (value === null || typeof value === "boolean" || typeof value === "number") {
      size += 32;
      if (size > SESSION_OUTPUT_FULL_LIMITS.payloadBytesPerCandidate) throw new Error("capacity");
      return typeof value === "number" && !Number.isFinite(value) ? null : value;
    }
    if (value === undefined) return undefined;
    if (typeof value !== "object" || active.has(value)) throw new Error("unsupported");
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (
      (array
        ? prototype !== Array.prototype
        : prototype !== Object.prototype && prototype !== null) ||
      hasSerializationOverride(value)
    )
      throw new Error("unsupported");
    active.add(value);
    const result: unknown[] | { [key: string]: unknown } = array ? [] : Object.create(null);
    if (array) {
      if (value.length > SESSION_OUTPUT_FULL_LIMITS.payloadEntries) throw new Error("capacity");
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        // JSON's Get on a hole can observe inherited values/accessors. A null
        // placeholder would change the ordinary request instead of snapshotting it.
        if (!descriptor && index in value) throw new Error("unsupported");
        if (descriptor && !("value" in descriptor)) throw new Error("unsupported");
        const item = copy(descriptor?.value, depth + 1);
        (result as unknown[]).push(item === undefined ? null : item);
      }
    } else
      for (const key of Object.keys(value)) {
        charge(key);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !("value" in descriptor)) throw new Error("unsupported");
        const item = copy(descriptor.value, depth + 1);
        if (item !== undefined) (result as { [key: string]: unknown })[key] = item;
      }
    active.delete(value);
    return Object.freeze(result);
  }
  const payload = copy(input, 0) as Readonly<object>;
  const bytes = encoder.encode(JSON.stringify(payload)).byteLength;
  if (bytes > SESSION_OUTPUT_FULL_LIMITS.payloadBytesPerCandidate) throw new Error("capacity");
  return { payload, bytes };
}
/** Actual save adapter only: snapshot the sanitized arguments that will be sent.
 * Failure returns the original arguments and never changes ordinary persistence.
 * These JSON values are NOT the Rust SQL byte encoding or a Native commitment. */
export function prepareSessionOutputWritePayload<T extends object>(
  token: SessionOutputWrite | null,
  input: T,
  kind: StorageAck["kind"],
): T {
  const write = token ? runtime.writes.get(token) : undefined;
  if (!write || write.settled) return input;
  const { node } = write;
  invalidateFullCandidate(node.lineage, "full-write-superseded");
  if (
    write.candidate ||
    runtime.fullOverflow ||
    runtime.overflow ||
    node.lineage.retired ||
    node.lineage.fullUnavailable ||
    node.lineage.current !== node ||
    !node.lineage.fullOrigins.size ||
    (node.lineage.fullReplacementRequired && kind !== "replace")
  )
    return input;
  try {
    const snapshot = boundedJsonSnapshot(input);
    const payload = Object.freeze(
      Object.assign(Object.create(null) as object, snapshot.payload, {
        captureOutputReceipt: true,
      }),
    );
    const bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
    if (bytes > SESSION_OUTPUT_FULL_LIMITS.payloadBytesPerCandidate) throw new Error("capacity");
    const args = payload as { session?: { id?: unknown }; delta?: { session?: { id?: unknown } } };
    if ((kind === "replace" ? args.session?.id : args.delta?.session?.id) !== node.lineage.id)
      return input;
    // Snapshot every exact original at actual admission, after checking that
    // ordinary serialization has no custom hooks. Later events cannot be
    // retroactively covered by an older in-flight write.
    const comparisons = new Map<NativeOutputItemComparison, NativeOutputItemComparison>();
    for (const origin of node.lineage.fullOrigins.keys()) {
      const items = snapshotNativeOutputEventOriginComparisons(origin, node.lineage.id);
      if (!items) return input;
      for (const item of items) comparisons.set(item, item);
    }
    if (
      runtime.fullCandidates.size >= SESSION_OUTPUT_FULL_LIMITS.candidates ||
      runtime.fullBytes + bytes > SESSION_OUTPUT_FULL_LIMITS.payloadBytesTotal ||
      runtime.fullCandidateOriginCount + node.lineage.fullOrigins.size >
        SESSION_OUTPUT_FULL_LIMITS.candidateOriginReferencesTotal
    ) {
      runtime.fullOverflow = true;
      for (const candidate of runtime.fullCandidates.values())
        invalidateFullCandidate(candidate.node.lineage, "full-candidate-capacity");
      return input;
    }
    const candidateToken = Object.freeze({ kind: "session-output-full-candidate" as const });
    const candidate: FullCandidate = {
      token: candidateToken,
      node,
      kind,
      bytes,
      payload,
      origins: Object.freeze([...node.lineage.fullOrigins.keys()]),
      items: Object.freeze([...comparisons.values()]),
      ack: null,
      inFlight: true,
      unavailable: null,
    };
    runtime.fullCandidates.set(candidateToken, candidate);
    runtime.fullHandles.set(candidateToken, candidate);
    runtime.fullBytes += bytes;
    runtime.fullCandidateOriginCount += candidate.origins.length;
    node.lineage.fullCandidate = candidateToken;
    write.candidate = candidateToken;
    return payload as T;
  } catch {
    node.lineage.fullUnavailable = "full-payload-unavailable";
    return input;
  }
}
/** Exact current accepted object only, never a reconstructed Session DTO. */
export function getSessionOutputFullCandidate(session: Session): SessionOutputFullCandidate | null {
  const node = runtime.nodes.get(session);
  const token = node?.lineage.fullCandidate;
  const candidate = token && runtime.fullHandles.get(token);
  return candidate && candidate.node === node && candidate.ack && fullCurrent(candidate)
    ? token!
    : null;
}
/** Untrusted portable comparison claims. Native's private resolver is the sole
 * authority; even a successful comparison cannot grant FULL/application proof. */
export function getSessionOutputFullCandidateComparison(
  token: SessionOutputFullCandidate,
): SessionOutputFullCandidateComparison | null {
  const candidate = runtime.fullHandles.get(token);
  if (!candidate || !candidate.ack || candidate.inFlight || !fullCurrent(candidate)) return null;
  const items: NativeOutputItemComparison[] = [];
  for (const origin of candidate.origins) {
    const originals = getNativeOutputEventOriginComparisons(origin, candidate.node.lineage.id);
    if (!originals) return null;
    for (const item of originals) if (!items.includes(item)) items.push(item);
  }
  if (
    !candidate.items ||
    items.length !== candidate.items.length ||
    items.some((item, index) => item !== candidate.items[index])
  )
    return null;
  return Object.freeze({
    version: 1,
    kind: "session-output-full-candidate-comparison",
    qualified: false,
    fullCheckpoint: false,
    applicationThrough: null,
    nativeCommitmentRequired: true,
    sessionId: candidate.node.lineage.id,
    modelVersion: candidate.node.version,
    command: candidate.kind === "replace" ? "session_upsert" : "session_apply_delta",
    admittedPayload: candidate.payload,
    acknowledgement: candidate.ack,
    items: Object.freeze(items),
  });
}
export function disposeSessionOutputFullCandidate(token: SessionOutputFullCandidate): void {
  const candidate = runtime.fullHandles.get(token);
  if (!candidate) return;
  candidate.unavailable ??= "full-candidate-disposed";
  if (!candidate.inFlight) dropFullCandidate(candidate);
}
export function sessionOutputFullCandidateObservation(sessionId: string) {
  const lineage = runtime.lineages.get(sessionId);
  return Object.freeze({
    qualified: false,
    fullCheckpoint: false,
    applicationThrough: null,
    retainedCandidates: runtime.fullCandidates.size,
    inFlightCandidates: [...runtime.fullCandidates.values()].filter(
      (candidate) => candidate.inFlight,
    ).length,
    payloadBytes: runtime.fullBytes,
    retainedOrigins: runtime.fullOriginCount,
    candidateOriginReferences: runtime.fullCandidateOriginCount,
    sessionOrigins: lineage?.fullOrigins.size ?? 0,
    unavailable:
      runtime.fullOverflow || runtime.overflow || !!lineage?.retired || !!lineage?.fullUnavailable,
    replacementRequired: lineage?.fullReplacementRequired ?? false,
    limits: SESSION_OUTPUT_FULL_LIMITS,
  });
}
if (hot)
  hot.dispose(() => {
    for (const lineage of runtime.lineages.values()) {
      lineage.fullUnavailable = "full-tracker-reloaded";
      invalidateFullCandidate(lineage, lineage.fullUnavailable);
    }
  });
function changed() {
  if (runtime.queuedNotice) return;
  runtime.queuedNotice = true;
  queueMicrotask(() => {
    runtime.queuedNotice = false;
    for (const listener of runtime.listeners) {
      try {
        listener();
      } catch (error) {
        console.warn("Session output persistence observer failed", error);
      }
    }
  });
}
function settle(lineage: Lineage, record: Record, reason?: string) {
  if (record.settled) return;
  record.settled = true;
  lineage.records.delete(record.origin);
  runtime.retained--;
  if (reason) record.work.fail(reason);
  else {
    record.work.finish();
    lineage.acknowledged++;
  }
}
function retire(lineage: Lineage, reason: string) {
  invalidateFullCandidate(lineage, reason);
  runtime.fullOriginCount -= lineage.fullOrigins.size;
  lineage.fullOrigins.clear();
  lineage.retired ??= reason;
  lineage.current = null;
  for (const record of lineage.records.values())
    if (!record.writers) settle(lineage, record, reason);
}
function nodeFor(session: Session, previous?: Node): Node | null {
  let lineage = previous?.lineage;
  if (!lineage) {
    if (runtime.lineages.size >= MAX_SESSIONS && !runtime.lineages.has(session.id)) {
      runtime.overflow = true;
      return null;
    }
    lineage = {
      id: session.id,
      current: null,
      version: 0,
      retired: null,
      records: new Map(),
      acknowledged: 0,
      failedWrites: 0,
      lastAck: null,
      fullOrigins: new Map(),
      fullUnavailable: null,
      fullReplacementRequired: false,
    };
    runtime.lineages.set(session.id, lineage);
  }
  if (lineage.retired || !Number.isSafeInteger(lineage.version + 1)) {
    retire(lineage, "session-projection-exhausted");
    return null;
  }
  invalidateFullCandidate(lineage, "accepted-model-changed");
  const node = { lineage, version: ++lineage.version, session };
  lineage.current = node;
  runtime.nodes.set(session, node);
  return node;
}
function committed(previous: readonly Session[], next: readonly Session[], reset: boolean) {
  const before = new Map(previous.map((session) => [session.id, session]));
  const ids = new Set<string>();
  for (const session of next) {
    if (ids.has(session.id)) {
      const lineage = runtime.lineages.get(session.id);
      if (lineage) retire(lineage, "duplicate-session-projection");
      continue;
    }
    ids.add(session.id);
    const old = before.get(session.id);
    const oldNode = old ? runtime.nodes.get(old) : undefined;
    if (!reset && old === session && oldNode && !oldNode.lineage.retired) continue;
    const previousLineage = runtime.lineages.get(session.id);
    if (reset || !oldNode || oldNode.lineage.retired) {
      if (previousLineage) retire(previousLineage, "session-projection-replaced");
      nodeFor(session);
    } else nodeFor(session, oldNode);
  }
  for (const [id, lineage] of runtime.lineages) {
    if (!ids.has(id)) {
      retire(lineage, "session-projection-removed");
      runtime.lineages.delete(id);
    }
  }
  changed();
}
runtime.unsubscribe?.();
runtime.unsubscribe = subscribeSessionCommits(committed);
// The module can load after sessions were opened. Actual current objects are
// enrolled; no caller-supplied counter/DTO can reconstruct an old lineage.
if (!runtime.lineages.size) committed([], getSessions(), false);

/** Call only after the real reducer/ref/model commit, with original events. */
export function recordAppliedSessionOutput(session: Session, events: readonly object[]): void {
  const origins = new Set(
    events.flatMap((event) => {
      const origin = getNativeOutputEventOrigin(event);
      return origin ? (getNativeOutputEventOriginConstituents(origin) ?? []) : [];
    }),
  );
  if (!origins.size) return;
  // Admit real application before its save can be deferred by a UI timer.
  // This registry counter is still not Native idle or a durable watermark.
  try {
    runtime.noteMutation?.(session.id);
  } catch (error) {
    console.warn("Session output mutation accounting failed", error);
  }
  let node = runtime.nodes.get(session);
  // A real reducer no-op is still a distinct application point. An already
  // admitted save must not cover a later event sharing the same session object.
  if (node && !node.lineage.retired && node.lineage.current?.session === session)
    node = nodeFor(session, node) ?? undefined;
  if (!node || node.lineage.retired || node.lineage.id !== session.id) {
    failNativeOutputEvents(events, "session-projection-not-committed");
    changed();
    return;
  }
  const additions = [...origins].filter((origin) => !node!.lineage.records.has(origin));
  if (
    node.lineage.records.size + additions.length > MAX_ORIGINS ||
    runtime.retained + additions.length > MAX_TOTAL_ORIGINS
  ) {
    runtime.overflow = true;
    failNativeOutputEvents(events, "session-projection-capacity");
    changed();
    return;
  }
  // All constituent ownership is admitted before any records are advanced. A
  // mid-admission capacity failure cannot leave a seemingly covering subset.
  const admitted = new Map<Origin, Work>();
  for (const origin of additions) {
    const work = retainNativeOutputEventOrigin(origin, session.id);
    if (!work) {
      node.lineage.fullUnavailable ??= "session-projection-origin-incomplete";
      for (const owned of admitted.values()) owned.fail("session-projection-origin-incomplete");
      failNativeOutputEvents(events, "session-projection-origin-incomplete");
      changed();
      return;
    }
    admitted.set(origin, work);
  }
  for (const origin of origins) {
    const retained = node.lineage.records.get(origin);
    if (retained) {
      retained.version = Math.max(retained.version, node!.version);
      retainFullOrigin(node!.lineage, origin, node!.version);
      markNativeOutputOriginProjectionAccepted(origin, session.id);
      continue;
    }
    const work = admitted.get(origin)!;
    node.lineage.records.set(origin, {
      origin,
      work,
      version: node.version,
      writers: 0,
      writingVersions: new Map(),
      replacementRequired: false,
      settled: false,
    });
    retainFullOrigin(node.lineage, origin, node.version);
    markNativeOutputOriginProjectionAccepted(origin, session.id);
    runtime.retained++;
  }
  changed();
}

/** Capture at actual service admission, before queue/debounce/coalescing. */
export function captureSessionOutputWrite(session: Session): SessionOutputWrite | null {
  const node = runtime.nodes.get(session);
  if (!node || node.lineage.retired) return null;
  const records = [...node.lineage.records.values()].filter(
    (record) => !record.settled && record.version <= node.version,
  );
  if (!records.length && !node.lineage.fullOrigins.size) return null;
  if (runtime.overflow || runtime.activeWrites >= MAX_WRITES) {
    runtime.overflow = true;
    return null;
  }
  for (const record of records) {
    record.writers++;
    record.writingVersions.set(node.version, (record.writingVersions.get(node.version) ?? 0) + 1);
  }
  const token = Object.freeze({ kind: "session-output-write" as const });
  runtime.activeWrites++;
  runtime.writes.set(token, { node, records, settled: false, counted: true });
  return token;
}
function releaseWrite(write: Write) {
  if (write.counted) runtime.activeWrites--;
  for (const record of write.records) {
    record.writers--;
    const count = (record.writingVersions.get(write.node.version) ?? 1) - 1;
    if (count) record.writingVersions.set(write.node.version, count);
    else record.writingVersions.delete(write.node.version);
    if (write.node.lineage.retired && !record.writers)
      settle(write.node.lineage, record, write.node.lineage.retired);
  }
}
/** A coalesced/discarded snapshot is not an ACK; a later actual descendant may cover it. */
export function releaseSessionOutputWrite(token: SessionOutputWrite | null): void {
  const write = token ? runtime.writes.get(token) : undefined;
  if (!write || write.settled) return;
  runtime.writes.delete(token!);
  write.settled = true;
  finishFullCandidate(write, null, "write-not-acknowledged");
  releaseWrite(write);
}
export function failSessionOutputWrite(token: SessionOutputWrite | null): void {
  const write = token ? runtime.writes.get(token) : undefined;
  if (!write || write.settled) return;
  runtime.writes.delete(token!);
  write.settled = true;
  write.node.lineage.failedWrites++;
  write.node.lineage.fullReplacementRequired = true;
  invalidateFullCandidate(write.node.lineage, "write-unconfirmed");
  finishFullCandidate(write, null, "write-unconfirmed");
  // A rejected/unknown CAS never consumes the original output. Keep it held
  // for an actual complete replacement ACK, without resending provider effects.
  for (const record of write.records) if (!record.settled) record.replacementRequired = true;
  releaseWrite(write);
}
export function acknowledgeSessionOutputWrite(
  token: SessionOutputWrite | null,
  ack: StorageAck,
): void {
  const write = token ? runtime.writes.get(token) : undefined;
  if (!write || write.settled) return;
  if (
    !Number.isSafeInteger(ack.revision) ||
    ack.revision < 0 ||
    !Number.isSafeInteger(ack.updatedAt) ||
    ack.updatedAt < 0 ||
    (ack.kind !== "replace" && ack.kind !== "delta")
  ) {
    failSessionOutputWrite(token);
    return;
  }
  write.settled = true;
  runtime.writes.delete(token!);
  const lineage = write.node.lineage;
  finishFullCandidate(write, ack);
  if (!lineage.retired) {
    for (const record of write.records) {
      if (
        !record.settled &&
        record.version <= write.node.version &&
        (!record.replacementRequired || ack.kind === "replace")
      )
        settle(lineage, record);
    }
    if (!lineage.lastAck || ack.revision >= lineage.lastAck.revision)
      lineage.lastAck = Object.freeze({ ...ack });
  }
  releaseWrite(write);
}
export function installSessionOutputMutationAccounting(
  noteMutation: (sessionId: string) => void,
): void {
  runtime.noteMutation = noteMutation;
}
/** Matching accepted model lifetimes, never a Native row identity or grant. */
export function sameSessionOutputLifetime(previous: Session, current: Session): boolean {
  const a = runtime.nodes.get(previous);
  const b = runtime.nodes.get(current);
  return !!a && !!b && a.lineage === b.lineage && !a.lineage.retired;
}
export function hasPendingSessionOutput(session: Session): boolean {
  const node = runtime.nodes.get(session);
  return (
    !!node &&
    !node.lineage.retired &&
    [...node.lineage.records.values()].some((record) => record.version <= node.version)
  );
}
export function needsSessionOutputWrite(session: Session): boolean {
  const node = runtime.nodes.get(session);
  return (
    !!node &&
    !node.lineage.retired &&
    [...node.lineage.records.values()].some(
      (record) =>
        record.version <= node.version &&
        ![...record.writingVersions.keys()].some((version) => version >= record.version),
    )
  );
}
export function sessionOutputNeedsReplacement(session: Session): boolean {
  const node = runtime.nodes.get(session);
  return (
    !!node &&
    !node.lineage.retired &&
    [...node.lineage.records.values()].some(
      (record) => record.version <= node.version && record.replacementRequired,
    )
  );
}
export function pendingSessionOutputSnapshots(ids?: readonly string[]): Session[] {
  const result: Session[] = [];
  for (const lineage of runtime.lineages.values()) {
    if (lineage.retired || !lineage.records.size || (ids && !ids.includes(lineage.id))) continue;
    const session = lineage.current?.session;
    if (session) result.push(session);
  }
  return result;
}
export function subscribePendingSessionOutput(listener: () => void): () => void {
  runtime.listeners.add(listener);
  return () => {
    runtime.listeners.delete(listener);
  };
}
export function sessionOutputStorageObservation(sessionId: string) {
  const lineage = runtime.lineages.get(sessionId);
  return Object.freeze({
    qualified: false as const,
    fullCheckpoint: false as const,
    applicationThrough: null,
    pendingOrigins: lineage?.records.size ?? 0,
    acknowledgedOrigins: lineage?.acknowledged ?? 0,
    failedWrites: lineage?.failedWrites ?? 0,
    unavailable: runtime.overflow || !!lineage?.retired,
    activeWrites: runtime.activeWrites,
    lastAck: lineage?.lastAck ?? null,
  });
}
