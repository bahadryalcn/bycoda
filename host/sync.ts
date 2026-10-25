import { StoreDatabase } from "./store-db";
type SyncDatabase = DatabaseSync | StoreDatabase;
import type { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../src/features/sync/model/canonicalJson";
import { SYNC_TABLES } from "../src/features/sync/model/syncProtocol";
import type {
  SyncOp,
  SyncPullResult,
  SyncPushResult,
  SyncRecord,
  SyncRecordValue,
  SyncTable,
} from "../src/features/sync/model/syncProtocol";

async function currentRev(db: SyncDatabase): Promise<number> {
  const row = await db.prepare("SELECT value FROM metadata WHERE key='syncRev'").get();
  return row ? Number(row.value) : 0;
}

/** Bumps and returns the store's global revision counter. Every accepted
 * write gets a fresh one, so a pull can ask for "everything after N". */
async function bumpRev(db: SyncDatabase): Promise<number> {
  await db
    .prepare(
      "INSERT INTO metadata VALUES ('syncRev', '1') ON CONFLICT(key) DO UPDATE SET value = CAST((CAST(value AS INTEGER) + 1) AS TEXT)",
    )
    .run();
  return await currentRev(db);
}

type SyncRow = Record<string, unknown>;

/** Maps a stored row to a record; a row whose JSON is corrupt reads as a
 * tombstone (value: null) so a push over it can still proceed. Returns
 * undefined only when `skipCorrupt` is set and the row is corrupt. */
function rowToRecord(row: SyncRow): SyncRecord & { corrupt: boolean } {
  let value: SyncRecordValue | null = null;
  let corrupt = false;
  if (row.value !== null) {
    try {
      value = JSON.parse(String(row.value)) as SyncRecordValue;
    } catch {
      corrupt = true;
    }
  }
  return {
    table: String(row.table_name) as SyncTable,
    id: String(row.id),
    rev: Number(row.rev),
    value,
    corrupt,
  };
}

async function readRecord(
  db: SyncDatabase,
  table: SyncTable,
  id: string,
): Promise<SyncRecord | undefined> {
  const row = await db
    .prepare("SELECT table_name, id, value, rev FROM sync_records WHERE table_name=? AND id=?")
    .get(table, id);
  if (!row) return undefined;
  const { corrupt: _corrupt, ...record } = rowToRecord(row);
  return record;
}

/** Every record the host has accepted since `sinceRev`, oldest first. */
export async function syncPull(
  db: SyncDatabase,
  sinceRev: number,
  page?: { untilRev?: number; maxBytes?: number },
): Promise<SyncPullResult> {
  const work = async () => {
    const untilRev = Math.min(page?.untilRev ?? (await currentRev(db)), await currentRev(db));
    const maxBytes = Math.max(128 * 1024, Math.min(page?.maxBytes ?? 1024 * 1024, 8 * 1024 * 1024));
    const rows = db
      .prepare(
        "SELECT table_name, id, value, rev FROM sync_records WHERE rev > ? AND rev <= ? ORDER BY rev",
      )
      .iterate(sinceRev, untilRev);
    const records: SyncRecord[] = [];
    let bytes = 256;
    let cursor = sinceRev;
    for await (const row of rows) {
      const { corrupt, ...record } = rowToRecord(row);
      if (!corrupt) {
        const size = Buffer.byteLength(JSON.stringify(record), "utf8") + 1;
        if (page && size + 256 > 8 * 1024 * 1024)
          throw new Error("Sync record exceeds the transfer limit");
        if (page && records.length && bytes + size > maxBytes)
          return { rev: cursor, records, more: true, untilRev };
        records.push(record);
        bytes += size;
      }
      cursor = record.rev;
    }
    return page ? { rev: untilRev, records, more: false, untilRev } : { rev: untilRev, records };
  };
  return db instanceof StoreDatabase ? db.scope(work) : work();
}

const MAX_VALUE_BYTES = 64 * 1024;

function isValidOp(op: unknown): op is SyncOp {
  if (typeof op !== "object" || op === null) return false;
  const { table, id, baseRev, value } = op as Record<string, unknown>;
  if (!(SYNC_TABLES as readonly unknown[]).includes(table)) return false;
  if (typeof id !== "string" || id.length === 0 || id.length > 200) return false;
  if (typeof baseRev !== "number" || !Number.isSafeInteger(baseRev) || baseRev < 0) return false;
  if (value === null) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_VALUE_BYTES;
  } catch {
    return false;
  }
}

/**
 * Applies each op whose `baseRev` matches the record's current revision
 * (optimistic concurrency); an op based on a stale revision is rejected and
 * returned with the record's current value, so the caller can adopt it.
 * Ops for different records in one call are independent of each other.
 * An op that would not change the stored value is reported as applied at
 * the record's existing revision, without a write or a revision bump.
 * Malformed ops are skipped and never throw; identifiable ones are reported
 * as invalid so the desktop can retain them and show a useful sync error.
 */
export async function syncPush(db: SyncDatabase, ops: SyncOp[]): Promise<SyncPushResult> {
  const work = async () => {
    const applied: SyncPushResult["applied"] = [];
    const rejected: SyncPushResult["rejected"] = [];
    const invalid: NonNullable<SyncPushResult["invalid"]> = [];
    for (const op of ops) {
      if (!isValidOp(op)) {
        const raw = op as unknown as Record<string, unknown> | null;
        if (raw && typeof raw.table === "string" && typeof raw.id === "string")
          invalid.push({
            table: raw.table,
            id: raw.id,
            error: "Invalid sync value or value exceeds 64 KiB",
          });
        continue;
      }
      const existing = await readRecord(db, op.table, op.id);
      if ((existing?.rev ?? 0) !== op.baseRev) {
        rejected.push({
          table: op.table,
          id: op.id,
          current: existing ?? {
            table: op.table,
            id: op.id,
            rev: 0,
            value: null,
          },
        });
        continue;
      }
      // Compared key-order-insensitively: the desktop transport re-sorts object keys.
      if (existing && canonicalJson(existing.value) === canonicalJson(op.value)) {
        applied.push({ table: op.table, id: op.id, rev: existing.rev });
        continue;
      }
      if (!existing && op.value === null) {
        applied.push({ table: op.table, id: op.id, rev: 0 });
        continue;
      }
      const rev = await bumpRev(db);
      await db
        .prepare(
          "INSERT INTO sync_records (table_name, id, value, rev, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(table_name, id) DO UPDATE SET value=excluded.value, rev=excluded.rev, updated_at=excluded.updated_at",
        )
        .run(op.table, op.id, op.value === null ? null : JSON.stringify(op.value), rev, Date.now());
      applied.push({ table: op.table, id: op.id, rev });
    }
    return {
      rev: await currentRev(db),
      applied,
      rejected,
      ...(invalid.length ? { invalid } : {}),
    };
  };
  return db instanceof StoreDatabase ? db.scope(work) : work();
}
