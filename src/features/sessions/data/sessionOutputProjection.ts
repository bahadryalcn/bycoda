import type { Session } from "../model/session";
import { getSessions, subscribeSessionCommits } from "../model/sessionsStore";
import {
  getNativeOutputEventOrigin,
  retainNativeOutputEventOrigin,
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
};
export type SessionOutputWrite = Readonly<{ kind: "session-output-write" }>;
export type StorageAck = Readonly<{
  kind: "replace" | "delta";
  revision: number;
  updatedAt: number;
}>;
type Write = { node: Node; records: Record[]; settled: boolean; counted?: boolean };
type Runtime = {
  nodes: WeakMap<Session, Node>;
  lineages: Map<string, Lineage>;
  writes: WeakMap<SessionOutputWrite, Write>;
  listeners: Set<() => void>;
  queuedNotice: boolean;
  retained: number;
  overflow: boolean;
  activeWrites: number;
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
};
if (!Number.isSafeInteger(runtime.activeWrites)) {
  runtime.activeWrites = 0;
  runtime.overflow = true;
}
if (hot) hot.data.sessionOutputProjection = runtime;
const MAX_SESSIONS = 512;
const MAX_ORIGINS = 4096;
const MAX_TOTAL_ORIGINS = 32768;
const MAX_WRITES = 4096;
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
    };
    runtime.lineages.set(session.id, lineage);
  }
  if (lineage.retired || !Number.isSafeInteger(lineage.version + 1)) {
    retire(lineage, "session-projection-exhausted");
    return null;
  }
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
    events.map(getNativeOutputEventOrigin).filter((origin): origin is Origin => origin !== null),
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
  for (const origin of origins) {
    const retained = node?.lineage.records.get(origin);
    if (retained) {
      retained.version = Math.max(retained.version, node!.version);
      continue;
    }
    const work = retainNativeOutputEventOrigin(origin, session.id);
    if (!work) continue;
    if (!node || node.lineage.retired || node.lineage.id !== session.id) {
      work.fail("session-projection-not-committed");
      continue;
    }
    if (node.lineage.records.size >= MAX_ORIGINS || runtime.retained >= MAX_TOTAL_ORIGINS) {
      runtime.overflow = true;
      work.fail("session-projection-capacity");
      continue;
    }
    node.lineage.records.set(origin, {
      origin,
      work,
      version: node.version,
      writers: 0,
      writingVersions: new Map(),
      replacementRequired: false,
      settled: false,
    });
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
  if (!records.length) return null;
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
  releaseWrite(write);
}
export function failSessionOutputWrite(token: SessionOutputWrite | null): void {
  const write = token ? runtime.writes.get(token) : undefined;
  if (!write || write.settled) return;
  runtime.writes.delete(token!);
  write.settled = true;
  write.node.lineage.failedWrites++;
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
