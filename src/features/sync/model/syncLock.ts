import {
  applyRemoteLockRecord,
  subscribeLockRecordChanges,
} from "../../group-lock/model/groupLock";
import { parseGroupLockSettings } from "../../group-lock/model/lockSettings";
import { parsePasswordRecord } from "../../group-lock/model/passwordRecord";
import { hasPendingOp, loadPeerState, queueLocalChange } from "./syncPeerState";
import type { SyncLockValue, SyncRecord } from "./syncProtocol";

const LOCK_RECORD_ID = "lock";

function currentRecord(): SyncLockValue["record"] {
  // `getGroupLockView` deliberately omits the record; read it the same way
  // `groupLock.ts` itself does, from its own settings key.
  const raw = (() => {
    try {
      return localStorage.getItem("bycoda.groupLock");
    } catch {
      return null;
    }
  })();
  return parseGroupLockSettings(raw).record;
}

/** Queues the current password record (or `null`) for the peer. Harmless
 * to call when nothing changed: the outbox already de-duplicates by id. */
export function captureLocalLockChanges(machineId: string): void {
  queueLockRecord(machineId, currentRecord());
}

/** A null record is only pushed as a deliberate removal: an unconfigured
 * machine must not overwrite a host lock it has never seen. */
function queueLockRecord(machineId: string, record: SyncLockValue["record"]): void {
  if (record === null) {
    const known = loadPeerState(machineId).recordValues[`lock:${LOCK_RECORD_ID}`];
    const knownNonNull = known !== undefined && known !== "null";
    if (!knownNonNull && !hasPendingOp(machineId, "lock", LOCK_RECORD_ID)) return;
  }
  queueLocalChange(machineId, "lock", LOCK_RECORD_ID, { record } as SyncLockValue);
}

export function applyRemoteLockRecords(machineId: string, records: readonly SyncRecord[]): void {
  void machineId;
  for (const record of records) {
    if (record.table !== "lock" || record.id !== LOCK_RECORD_ID) continue;
    const value = record.value as SyncLockValue | null;
    if (value === null || (typeof value === "object" && value.record === null)) {
      applyRemoteLockRecord(null);
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const parsed = parsePasswordRecord(value.record);
    if (parsed) applyRemoteLockRecord(parsed);
  }
}

/** Wires a local password change straight into the outbox for every peer
 * this machine syncs with, without waiting for the orchestration loop's
 * next cycle — losing or changing the lock password is worth pushing
 * immediately. Returns the unsubscribe function. */
export function watchLocalLockChanges(machineIds: () => readonly string[]): () => void {
  return subscribeLockRecordChanges((record) => {
    for (const machineId of machineIds()) {
      queueLockRecord(machineId, record);
    }
  });
}
