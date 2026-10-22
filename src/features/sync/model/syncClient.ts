import { applyRemoteAppearanceRecords, captureLocalAppearanceChanges } from "./syncAppearance";
import { applyRemoteGroupRecords, captureLocalGroupChanges } from "./syncGroups";
import { applyRemoteLockRecords, captureLocalLockChanges } from "./syncLock";
import {
  applyRemoteProjectRecords,
  captureLocalProjectChanges,
  localProjectIdsByPath,
} from "./syncProjects";
import {
  adoptLocalProjects,
  autoAddRemoteProjects,
  nameAutoAddedProjects,
} from "./syncRemoteProjects";
import { canonicalJson } from "./canonicalJson";
import {
  applyPushResult,
  hasPulled,
  markPullCompleted,
  markPulled,
  loadPeerState,
  adoptPeerEnvironment,
  peerRev,
  resetPeerHistory,
  takeOutbox,
} from "./syncPeerState";
import { remoteErrorText } from "../../connections/model/remoteFailure";
import { parseSyncRecord, syncPushBatches } from "./syncProtocol";
import type { SyncPushResult, SyncRecord } from "./syncProtocol";

const mergedListeners = new Set<() => void>();

/** Fires when a push was rejected and the host's value replaced a local edit. */
export function subscribeSyncMerged(listener: () => void): () => void {
  mergedListeners.add(listener);
  return () => void mergedListeners.delete(listener);
}

export const SYNC_MERGED_MESSAGE = "This change was merged with an update from your other machine.";
export const SYNC_UNSUPPORTED_MESSAGE = "Update the host on this machine";

export type SyncState = "idle" | "syncing" | "ok" | "error" | "unsupported" | "unlinked";
export type SyncStatus = {
  state: SyncState;
  lastSyncAt?: number;
  lastError?: string;
  pendingOps: number;
};

const NOT_STARTED: SyncStatus = { state: "idle", pendingOps: 0 };
const statuses = new Map<string, SyncStatus>();
const statusListeners = new Set<() => void>();

/** Returns the same object until the status changes, so it is safe as a useSyncExternalStore snapshot. */
export function getSyncStatus(machineId: string): SyncStatus {
  return statuses.get(machineId) ?? NOT_STARTED;
}

export function subscribeSyncStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => void statusListeners.delete(listener);
}

/** Merges a change into a machine's status; lastSyncAt and lastError carry over unless overridden. */
export function recordSyncStatus(
  machineId: string,
  patch: Partial<SyncStatus> & { state: SyncState },
): void {
  statuses.set(machineId, { ...getSyncStatus(machineId), ...patch });
  for (const listener of [...statusListeners]) listener();
}

function pendingCount(machineId: string): number {
  try {
    return takeOutbox(machineId).length;
  } catch {
    return 0;
  }
}

export type SyncRequest = (method: string, params: unknown) => Promise<unknown>;

let syncWriteDepth = 0;

/** True while sync itself is touching local library state (capturing it or
 * applying host records). Change events fired in that window are sync's own
 * echo and must not schedule another cycle. */
export function isApplyingRemote(): boolean {
  return syncWriteDepth > 0;
}

function duringSyncWrite<T>(run: () => T): T {
  syncWriteDepth += 1;
  try {
    return run();
  } finally {
    syncWriteDepth -= 1;
  }
}

function applyIncoming(machineId: string, records: readonly SyncRecord[]): void {
  duringSyncWrite(() => {
    applyRemoteProjectRecords(machineId, records);
    applyRemoteGroupRecords(machineId, records);
    applyRemoteAppearanceRecords(machineId, records);
    applyRemoteLockRecords(machineId, records);
  });
}

function asObject(result: unknown, method: string): Record<string, unknown> {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error(`${method} returned a malformed result`);
  }
  return result as Record<string, unknown>;
}

function parsePushResult(result: unknown): SyncPushResult {
  const raw = asObject(result, "sync.push");
  const applied = (Array.isArray(raw.applied) ? raw.applied : []).flatMap((entry) => {
    const record = parseSyncRecord({ ...(entry as object), value: null });
    return record ? [{ table: record.table, id: record.id, rev: record.rev }] : [];
  });
  const rejected = (Array.isArray(raw.rejected) ? raw.rejected : []).flatMap((entry) => {
    const current = parseSyncRecord((entry as { current?: unknown } | null)?.current);
    return current ? [{ table: current.table, id: current.id, current }] : [];
  });
  const invalid = Array.isArray(raw.invalid)
    ? (raw.invalid as SyncPushResult["invalid"])
    : undefined;
  return {
    rev: Number.isInteger(raw.rev) ? (raw.rev as number) : 0,
    applied,
    rejected,
    invalid,
  };
}

let postSyncTail: Promise<unknown> = Promise.resolve();

function exclusivePostSync(run: () => Promise<void>): Promise<void> {
  const result = postSyncTail.then(run, run);
  postSyncTail = result.catch(() => undefined);
  return result;
}

/** One push-then-pull round for a single peer (pull first on first contact,
 * so local state never overwrites host state this machine has not read).
 * Project/rail capture always runs before group capture, so an assignment
 * for a path captured in this same cycle is queued immediately. */
export async function runSyncCycle(
  machineId: string,
  request: SyncRequest,
  environmentId?: string,
): Promise<void> {
  recordSyncStatus(machineId, { state: "syncing" });
  try {
    if (environmentId && !adoptPeerEnvironment(machineId, environmentId))
      throw new Error("Library sync progress could not be saved. Free storage and retry.");
    await runSyncCycleInner(machineId, request);
  } catch (error) {
    console.warn("[sync]", machineId, error);
    recordSyncStatus(machineId, {
      state: "error",
      lastError: remoteErrorText(error),
      pendingOps: pendingCount(machineId),
    });
    throw error;
  }
  // Needs the records just pulled; an unreachable machine is retried later
  // and never fails the cycle.
  // One machine at a time: these add rail entries and open remote folders, so
  // two machines' cycles running them together would repeat each other's work.
  await exclusivePostSync(async () => {
    const adopted = await adoptLocalProjects().catch(() => []);
    const added = await autoAddRemoteProjects().catch(() => []);
    // After this cycle's apply step, so a label that came with it wins.
    duringSyncWrite(() => nameAutoAddedProjects(machineId, [...adopted, ...added]));
  });
  recordSyncStatus(machineId, {
    state: "ok",
    lastSyncAt: Date.now(),
    lastError: undefined,
    pendingOps: pendingCount(machineId),
  });
}

async function pullAndApply(machineId: string, request: SyncRequest): Promise<void> {
  let untilRev: number | undefined;
  let initial = !hasPulled(machineId);
  let restarted = false;
  for (;;) {
    const sinceRev = peerRev(machineId);
    const pullRaw = asObject(
      await request("sync.pull", {
        sinceRev,
        paginated: true,
        ...(untilRev === undefined ? {} : { untilRev }),
      }),
      "sync.pull",
    );
    if (!Number.isSafeInteger(pullRaw.rev))
      throw new Error("sync.pull returned an invalid revision");
    if (Number(pullRaw.rev) < sinceRev) {
      // The machine's host was replaced or its database recreated: its
      // revisions restarted below what this desktop last saw. Start over once
      // as a first contact instead of refusing to sync with it forever.
      if (restarted || !resetPeerHistory(machineId))
        throw new Error("sync.pull returned an invalid revision");
      restarted = true;
      initial = true;
      untilRev = undefined;
      continue;
    }
    if (pullRaw.more === true && Number(pullRaw.rev) <= sinceRev)
      throw new Error("sync.pull did not advance its cursor");
    if (
      pullRaw.more === true &&
      (!Number.isSafeInteger(pullRaw.untilRev) ||
        Number(pullRaw.untilRev) < Number(pullRaw.rev) ||
        (untilRev !== undefined && Number(pullRaw.untilRev) !== untilRev))
    )
      throw new Error("sync.pull returned an invalid page boundary");
    const records = (Array.isArray(pullRaw.records) ? pullRaw.records : []).flatMap((entry) => {
      const record = parseSyncRecord(entry);
      return record ? [record] : [];
    });
    const pending = new Set(takeOutbox(machineId).map((op) => `${op.table}:${op.id}`));
    if (records.length > 0) {
      applyIncoming(
        machineId,
        records.filter((record) => !pending.has(`${record.table}:${record.id}`)),
      );
    }
    if (
      !markPulled(machineId, records, {
        rev: Number(pullRaw.rev),
        complete: false,
      })
    )
      throw new Error("Library sync progress could not be saved. Free storage and retry.");
    if (pullRaw.more !== true) break;
    untilRev = Number(pullRaw.untilRev);
  }
  // A layout/assignment can arrive before the groups or folders it references.
  // Reapply dependency records from the durable peer cache after all pages,
  // including when an earlier pass stopped between pages.
  if (initial || untilRev !== undefined) {
    const state = loadPeerState(machineId);
    const pending = new Set(state.outbox.map((op) => `${op.table}:${op.id}`));
    const dependencies = Object.entries(state.recordValues).flatMap(([key, json]) => {
      const split = key.indexOf(":");
      const table = key.slice(0, split);
      if (
        !["groupOrder", "railLayout", "assignment", "appearance"].includes(table) ||
        pending.has(key)
      )
        return [];
      try {
        const record = parseSyncRecord({
          table,
          id: key.slice(split + 1),
          rev: state.recordRevs[key],
          value: JSON.parse(json),
        });
        return record ? [record] : [];
      } catch {
        return [];
      }
    });
    if (dependencies.length) applyIncoming(machineId, dependencies);
  }
  markPullCompleted(machineId);
  if (!hasPulled(machineId))
    throw new Error("Library sync completion could not be saved. Free storage and retry.");
}

async function runSyncCycleInner(machineId: string, request: SyncRequest): Promise<void> {
  if (!hasPulled(machineId)) await pullAndApply(machineId, request);

  duringSyncWrite(() => {
    captureLocalProjectChanges(machineId);
    const projectIds = localProjectIdsByPath();
    captureLocalGroupChanges(machineId, projectIds);
    captureLocalAppearanceChanges(machineId, projectIds);
    captureLocalLockChanges(machineId);
  });

  const outbox = takeOutbox(machineId);
  const { batches, invalid } = syncPushBatches(outbox);
  let invalidOps = invalid.length;
  for (const batch of batches) {
    const pushResult = parsePushResult(await request("sync.push", { ops: batch }));
    const toAdopt = applyPushResult(machineId, pushResult, batch);
    if (toAdopt.length > 0) {
      const overwrote = toAdopt.some((record) => {
        const sent = batch.find((op) => op.table === record.table && op.id === record.id);
        return !!sent && canonicalJson(sent.value) !== canonicalJson(record.value);
      });
      applyIncoming(machineId, toAdopt);
      if (overwrote) for (const listener of [...mergedListeners]) listener();
    }
    invalidOps += pushResult.invalid?.length ?? 0;
  }
  // Invalid outgoing values stay pending, but cannot starve unrelated incoming
  // edits or deletions. pullAndApply protects every pending local record.
  await pullAndApply(machineId, request);
  if (invalidOps)
    throw new Error(
      "Some library changes exceed the sync limit or are invalid. They remain pending on this computer.",
    );
}

export const CYCLE_INTERVAL_MS = 30_000;
/** Rounds never start closer together than this; requests inside the window collapse into one trailing round. */
export const MIN_CYCLE_SPACING_MS = 3_000;
/** At most this many machines sync at once, so one slow host cannot hold the rest back. */
export const MAX_PARALLEL_SYNCS = 3;
export const SYNC_BACKOFF_BASE_MS = 60_000;
export const SYNC_BACKOFF_MAX_MS = 10 * 60_000;

/** How long a machine is left out of background rounds after its nth
 * consecutive failed sync: exponential with a cap, +-20% jitter so machines
 * that failed together do not retry together. */
export function syncBackoffMs(failures: number, random: () => number = Math.random): number {
  if (failures <= 0) return 0;
  const base = Math.min(SYNC_BACKOFF_MAX_MS, SYNC_BACKOFF_BASE_MS * 2 ** (failures - 1));
  return Math.min(SYNC_BACKOFF_MAX_MS, Math.round(base * (0.8 + random() * 0.4)));
}

let activeSyncNow: ((machineId?: string) => Promise<void>) | undefined;

/** Syncs now through the running loop (all machines, or one); resolves once a
 * sync of each requested machine that started after this call has finished.
 * No-op if the loop isn't started. A machine the loop does not sync is marked
 * unsupported instead of being left with whatever status it showed before. */
export function syncNow(machineId?: string): Promise<void> {
  return activeSyncNow ? activeSyncNow(machineId) : Promise.resolve();
}

type SyncJob = {
  promise: Promise<void>;
  resolve: () => void;
  /** A user asked for it: ignores the machine's failure backoff and the spacing. */
  explicit: boolean;
};

type MachineSlot = {
  id: string;
  phase: "idle" | "queued" | "running";
  /** The sync waiting for a free slot, or the one running. */
  job?: SyncJob;
  /** At most one follow-up, for requests that arrived while a sync was running. */
  next?: SyncJob;
  failures: number;
  /** Background rounds skip the machine until then. */
  nextAt: number;
  endedAt: number;
};

function makeJob(explicit: boolean): SyncJob {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve, explicit };
}

/**
 * Syncs every currently known peer, on an interval and whenever `nudge()`
 * (returned alongside the stop function) is called. Each machine has its own
 * in-flight guard and failure backoff, and up to `MAX_PARALLEL_SYNCS` machines
 * sync at once. Interval ticks and nudges respect `MIN_CYCLE_SPACING_MS`; an
 * explicit `syncNow` does not.
 */
export function startSyncLoop(
  listMachineIds: () => readonly string[],
  requestFor: (machineId: string) => SyncRequest,
  environmentFor?: (machineId: string) => string | undefined,
): { stop: () => void; nudge: () => void; recover: (machineId: string) => void } {
  let stopped = false;
  let lastRoundAt = Number.NEGATIVE_INFINITY;
  let lastEndedAt = Number.NEGATIVE_INFINITY;
  let trailing: ReturnType<typeof setTimeout> | undefined;
  let active = 0;
  const waiting: MachineSlot[] = [];
  const slots = new Map<string, MachineSlot>();

  const slotFor = (id: string): MachineSlot => {
    let slot = slots.get(id);
    if (!slot) {
      slot = { id, phase: "idle", failures: 0, nextAt: 0, endedAt: 0 };
      slots.set(id, slot);
    }
    return slot;
  };

  const pump = (): void => {
    while (!stopped && active < MAX_PARALLEL_SYNCS && waiting.length > 0) {
      void runSlot(waiting.shift() as MachineSlot);
    }
  };

  const enqueue = (slot: MachineSlot, job: SyncJob): void => {
    slot.phase = "queued";
    slot.job = job;
    waiting.push(slot);
    pump();
  };

  const runSlot = async (slot: MachineSlot): Promise<void> => {
    const job = slot.job as SyncJob;
    slot.phase = "running";
    active += 1;
    try {
      await runSyncCycle(slot.id, requestFor(slot.id), environmentFor?.(slot.id));
      slot.failures = 0;
      slot.nextAt = 0;
    } catch {
      slot.failures += 1;
      slot.nextAt = Date.now() + syncBackoffMs(slot.failures);
    }
    active -= 1;
    slot.endedAt = lastEndedAt = Date.now();
    slot.phase = "idle";
    slot.job = undefined;
    job.resolve();
    const next = slot.next;
    slot.next = undefined;
    if (next) {
      if (stopped || (!next.explicit && Date.now() < slot.nextAt)) {
        next.resolve();
      } else {
        const wait = next.explicit
          ? 0
          : Math.max(0, slot.endedAt + MIN_CYCLE_SPACING_MS - Date.now());
        if (wait === 0) enqueue(slot, next);
        else {
          // Queued meanwhile, so a request now joins this follow-up.
          slot.phase = "queued";
          slot.job = next;
          setTimeout(() => {
            if (stopped) {
              slot.phase = "idle";
              slot.job = undefined;
              next.resolve();
            } else {
              waiting.push(slot);
              pump();
            }
          }, wait);
        }
      }
    }
    pump();
  };

  /** Resolves when a sync of the machine that started after this call is done. */
  const request = (id: string, explicit: boolean): Promise<void> => {
    if (stopped) return Promise.resolve();
    const slot = slotFor(id);
    if (slot.phase === "queued" && slot.job) {
      if (explicit) slot.job.explicit = true;
      return slot.job.promise;
    }
    if (slot.phase === "running") {
      if (!slot.next) slot.next = makeJob(explicit);
      else if (explicit) slot.next.explicit = true;
      return slot.next.promise;
    }
    if (!explicit && Date.now() < slot.nextAt) return Promise.resolve();
    const job = makeJob(explicit);
    enqueue(slot, job);
    return job.promise;
  };

  const round = (): void => {
    lastRoundAt = Date.now();
    if (trailing !== undefined) {
      clearTimeout(trailing);
      trailing = undefined;
    }
    const eligible = listMachineIds();
    for (const [id, slot] of slots) {
      if (slot.phase === "idle" && !eligible.includes(id)) slots.delete(id);
    }
    for (const id of eligible) void request(id, false);
  };
  const schedule = (): void => {
    if (stopped || trailing !== undefined) return;
    const wait = Math.max(
      0,
      Math.max(lastRoundAt, lastEndedAt) + MIN_CYCLE_SPACING_MS - Date.now(),
    );
    trailing = setTimeout(() => {
      trailing = undefined;
      requestRun();
    }, wait);
  };
  const requestRun = (): void => {
    if (stopped) return;
    if (Date.now() - Math.max(lastRoundAt, lastEndedAt) < MIN_CYCLE_SPACING_MS) schedule();
    else round();
  };
  const runNow = (only?: string): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (!only && trailing !== undefined) {
      clearTimeout(trailing);
      trailing = undefined;
    }
    const eligible = listMachineIds();
    if (only && !eligible.includes(only)) {
      const state = getSyncStatus(only).state;
      if (state !== "unsupported" && state !== "unlinked") {
        recordSyncStatus(only, {
          state: "unsupported",
          lastError: SYNC_UNSUPPORTED_MESSAGE,
        });
      }
    }
    const targets = only ? eligible.filter((id) => id === only) : eligible;
    return Promise.all(targets.map((id) => request(id, true))).then(() => undefined);
  };
  const timer = setInterval(requestRun, CYCLE_INTERVAL_MS);
  requestRun();
  activeSyncNow = runNow;
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
      if (trailing !== undefined) clearTimeout(trailing);
      trailing = undefined;
      if (activeSyncNow === runNow) activeSyncNow = undefined;
      for (const slot of waiting.splice(0)) {
        slot.phase = "idle";
        slot.job?.resolve();
        slot.job = undefined;
      }
    },
    nudge: requestRun,
    recover: (id) => {
      if (stopped || !listMachineIds().includes(id)) return;
      const slot = slots.get(id);
      if (slot) {
        slot.failures = 0;
        slot.nextAt = 0;
      }
      // A verified host recovery supersedes failure backoff, while retaining
      // normal coalescing, spacing and the per-machine in-flight guard.
      requestRun();
    },
  };
}
