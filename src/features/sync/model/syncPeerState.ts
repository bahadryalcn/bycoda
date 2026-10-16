import { canonicalizeJsonText, canonicalJson } from "./canonicalJson";
import type {
  SyncOp,
  SyncPushResult,
  SyncRecord,
  SyncRecordValue,
  SyncTable,
} from "./syncProtocol";

type OutboxEntry = {
  table: SyncTable;
  id: string;
  baseRev: number;
  value: SyncRecordValue | null;
};
type PeerState = {
  rev: number;
  /** A pull from this peer has completed at least once. */
  pulled: boolean;
  recordRevs: Record<string, number>;
  /** Canonical JSON per record; entries written by older builds may not be canonical yet. */
  recordValues: Record<string, string>;
  outbox: OutboxEntry[];
  /** The host environment these revisions came from. */
  environmentId?: string;
};

// Versioned: everything cached for the older name-based project ids is dropped,
// which makes the next cycle a first contact (pull before push).
const keyFor = (machineId: string) => `bycoda.sync.peer.v2:${machineId}`;
const recordKey = (table: SyncTable, id: string) => `${table}:${id}`;

function emptyState(): PeerState {
  return {
    rev: 0,
    pulled: false,
    recordRevs: {},
    recordValues: {},
    outbox: [],
  };
}

function load(machineId: string): PeerState {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(keyFor(machineId)) ?? "null");
    if (!parsed || typeof parsed !== "object") return emptyState();
    const raw = parsed as Partial<PeerState>;
    const rev = typeof raw.rev === "number" ? raw.rev : 0;
    return {
      rev,
      pulled: typeof raw.pulled === "boolean" ? raw.pulled : rev > 0,
      recordRevs: raw.recordRevs && typeof raw.recordRevs === "object" ? raw.recordRevs : {},
      recordValues:
        raw.recordValues && typeof raw.recordValues === "object" ? raw.recordValues : {},
      outbox: Array.isArray(raw.outbox) ? raw.outbox : [],
      ...(typeof raw.environmentId === "string" ? { environmentId: raw.environmentId } : {}),
    };
  } catch {
    return emptyState();
  }
}

function save(machineId: string, state: PeerState): boolean {
  try {
    localStorage.setItem(keyFor(machineId), JSON.stringify(state));
    return true;
  } catch {
    // private mode / quota: this peer's sync falls behind until storage frees up
    return false;
  }
}

function knownCanonical(state: PeerState, key: string): string | undefined {
  const stored = state.recordValues[key];
  return typeof stored === "string" ? canonicalizeJsonText(stored) : undefined;
}

/** This machine's full cached state for one peer, mainly for tests/debugging. */
export function loadPeerState(machineId: string): PeerState {
  return load(machineId);
}

export function peerRev(machineId: string): number {
  return load(machineId).rev;
}

/** Advances the pull watermark (never backwards). Only a pull may call this. */
export function setPeerRev(machineId: string, rev: number): void {
  const state = load(machineId);
  if (rev <= state.rev) return;
  state.rev = rev;
  save(machineId, state);
}

/** Whether this machine has ever completed a pull from the peer. Until it
 * has, it cannot know what the host holds, so whole-list records (rail
 * layout, group order) must not be pushed. */
export function hasPulled(machineId: string): boolean {
  return load(machineId).pulled;
}

/**
 * Forgets what one peer told us after its history restarted: the machine's
 * host was replaced or its database recreated, so its revisions start over.
 * Unsent local edits stay queued, rebased onto "never seen" (baseRev 0), and
 * the next pull is a first contact again.
 */
export function resetPeerHistory(machineId: string): boolean {
  const state = load(machineId);
  return save(machineId, {
    ...emptyState(),
    outbox: state.outbox.map((entry) => ({ ...entry, baseRev: 0 })),
    ...(state.environmentId ? { environmentId: state.environmentId } : {}),
  });
}

/**
 * Ties this peer's cached revisions to the host environment that produced
 * them. A machine whose host was replaced keeps its id but answers as a new
 * environment, whose revisions may be higher or lower than ours: either way
 * they are unrelated, so the cache starts over. Older caches without an
 * environment just record the current one.
 */
export function adoptPeerEnvironment(machineId: string, environmentId: string): boolean {
  const state = load(machineId);
  if (state.environmentId === environmentId) return true;
  if (state.environmentId === undefined) return save(machineId, { ...state, environmentId });
  return save(machineId, {
    ...emptyState(),
    outbox: state.outbox.map((entry) => ({ ...entry, baseRev: 0 })),
    environmentId,
  });
}

export function markPullCompleted(machineId: string): void {
  const state = load(machineId);
  if (state.pulled) return;
  state.pulled = true;
  save(machineId, state);
}

/**
 * Queues a local edit. A record this peer has never shown us gets baseRev
 * 0; otherwise the last revision we saw for it. A second edit to the same
 * record before it is pushed keeps the *original* baseRev — it still
 * describes what the host last showed us, not what we last wrote.
 */
export function queueLocalChange(
  machineId: string,
  table: SyncTable,
  id: string,
  value: SyncRecordValue | null,
): void {
  const state = load(machineId);
  const key = recordKey(table, id);
  const json = canonicalJson(value);
  const index = state.outbox.findIndex((entry) => entry.table === table && entry.id === id);
  if (index === -1) {
    if (json === knownCanonical(state, key)) return;
    const baseRev = state.recordRevs[key] ?? 0;
    state.outbox = [...state.outbox, { table, id, baseRev, value }];
  } else {
    if (canonicalJson(state.outbox[index].value) === json) return;
    state.outbox = state.outbox.map((entry, i) => (i === index ? { ...entry, value } : entry));
  }
  save(machineId, state);
}

export function hasPendingOp(machineId: string, table: SyncTable, id: string): boolean {
  return load(machineId).outbox.some((entry) => entry.table === table && entry.id === id);
}

/** Ids of a table's records the host is known to hold with a non-null value. */
export function knownRecordIds(machineId: string, table: SyncTable): string[] {
  const prefix = `${table}:`;
  return Object.entries(load(machineId).recordValues).flatMap(([key, json]) =>
    key.startsWith(prefix) && json !== "null" ? [key.slice(prefix.length)] : [],
  );
}

/** The value the host is last known to hold for a record (`undefined` when never seen). */
export function knownRecordValue(machineId: string, table: SyncTable, id: string): unknown {
  const stored = load(machineId).recordValues[recordKey(table, id)];
  if (typeof stored !== "string") return undefined;
  try {
    return JSON.parse(stored);
  } catch {
    return undefined;
  }
}

export function takeOutbox(machineId: string): SyncOp[] {
  return load(machineId).outbox.map(({ table, id, baseRev, value }) => ({
    table,
    id,
    baseRev,
    value,
  }));
}

/** Records a batch of records this peer just told us about: advances the
 * peer's revision watermark and each record's own last-known revision. */
export function markPulled(
  machineId: string,
  records: readonly SyncRecord[],
  page?: { rev: number; complete: boolean },
): boolean {
  const state = load(machineId);
  for (const record of records) {
    state.recordRevs[recordKey(record.table, record.id)] = record.rev;
    state.recordValues[recordKey(record.table, record.id)] = canonicalJson(record.value);
    state.rev = Math.max(state.rev, record.rev);
  }
  if (page) state.rev = Math.max(state.rev, page.rev);
  state.pulled ||= page?.complete !== false;
  return save(machineId, state);
}

/**
 * Settles a push: applied ops update this peer's record revisions and
 * leave the outbox; rejected ops are dropped from the outbox too (retrying
 * them unchanged would just be rejected again) and returned so the caller
 * can apply the host's current value locally instead.
 */
export function applyPushResult(
  machineId: string,
  result: SyncPushResult,
  sent: SyncOp[],
): SyncRecord[] {
  const state = load(machineId);
  for (const entry of result.applied) {
    const key = recordKey(entry.table, entry.id);
    const sentOp = sent.find((op) => op.table === entry.table && op.id === entry.id);
    if (!sentOp) continue;
    const sentJson = canonicalJson(sentOp.value);
    state.outbox = state.outbox.flatMap((item) => {
      if (item.table !== entry.table || item.id !== entry.id) return [item];
      if (canonicalJson(item.value) === sentJson) return [];
      return [{ ...item, baseRev: entry.rev }];
    });
    state.recordRevs[key] = entry.rev;
    state.recordValues[key] = sentJson;
  }
  const adopted: SyncRecord[] = [];
  for (const entry of result.rejected) {
    const key = recordKey(entry.table, entry.id);
    const sentOp = sent.find((op) => op.table === entry.table && op.id === entry.id);
    const pending = state.outbox.find((item) => item.table === entry.table && item.id === entry.id);
    state.recordRevs[key] = entry.current.rev;
    state.recordValues[key] = canonicalJson(entry.current.value);
    if (pending && sentOp && canonicalJson(pending.value) !== canonicalJson(sentOp.value)) {
      state.outbox = state.outbox.map((item) =>
        item === pending ? { ...item, baseRev: entry.current.rev } : item,
      );
      continue;
    }
    state.outbox = state.outbox.filter((item) => item !== pending);
    adopted.push(entry.current);
  }
  save(machineId, state);
  return adopted;
}
