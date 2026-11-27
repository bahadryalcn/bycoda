import { StoreDatabase } from "../store-db";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import { syncDbTiming } from "../diagnostics/perf-metrics";
import { rememberSerializedResponse } from "./sync-transfer";
type SyncDatabase = DatabaseSync | StoreDatabase;
import type { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../../src/features/sync/model/canonicalJson";
import { SYNC_TABLES } from "../../src/features/sync/model/syncProtocol";
import type {
  SyncOp,
  SyncPullResult,
  SyncPushResult,
  SyncRecord,
  SyncRecordValue,
  SyncTable,
} from "../../src/features/sync/model/syncProtocol";

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

/** Pulls skip corrupt rows. A push can replace one at its existing revision. */
function rowToRecord(row: SyncRow, corruptAsTombstone = false): SyncRecord | undefined {
  let value: SyncRecordValue | null = null;
  if (row.value !== null) {
    try {
      value = JSON.parse(String(row.value)) as SyncRecordValue;
    } catch {
      if (!corruptAsTombstone) return undefined;
    }
  }
  return {
    table: String(row.table_name) as SyncTable,
    id: String(row.id),
    rev: Number(row.rev),
    value,
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
  return row && rowToRecord(row, true);
}

/** Every record the host has accepted since `sinceRev`, oldest first. */
export async function syncPull(
  db: SyncDatabase,
  sinceRev: number,
  page?: { untilRev?: number; maxBytes?: number },
): Promise<SyncPullResult> {
  const timing = syncDbTiming.getStore();
  const queuedAt = monotonicNow();
  const work = async () => {
    if (timing) timing.dbWaitMs = elapsedSince(queuedAt);
    const latest = await currentRev(db);
    const untilRev = Math.min(page?.untilRev ?? latest, latest);
    const maxBytes = Math.max(128 * 1024, Math.min(page?.maxBytes ?? 1024 * 1024, 8 * 1024 * 1024));
    const records: SyncRecord[] = [];
    const encodedRecords: string[] = [];
    let bytes = 256;
    let revisionStart = 0;
    function finishPage(rev: number, more: boolean): SyncPullResult {
      const result = { rev, records, more, untilRev, workspaceLayout: true };
      rememberSerializedResponse(
        result,
        `{"rev":${JSON.stringify(rev)},"records":[${encodedRecords.join(",")}],"more":${more},"untilRev":${JSON.stringify(untilRev)},"workspaceLayout":true}`,
      );
      return result;
    }
    for await (const batch of pullBatches(db, sinceRev, untilRev)) {
      for (const row of batch) {
        const record = rowToRecord(row);
        if (!record) continue;
        if (page) {
          const text = JSON.stringify(record);
          const size = Buffer.byteLength(text) + 1;
          if (size + 256 > 8 * 1024 * 1024)
            throw new Error("Sync record exceeds the transfer limit");
          if (records.at(-1)?.rev !== record.rev) revisionStart = records.length;
          if (bytes + size > maxBytes && revisionStart > 0) {
            // Clients resume after a revision. Move a shared legacy revision to
            // the next page in full, even if some of its rows fit here.
            records.length = revisionStart;
            encodedRecords.length = revisionStart;
            return finishPage(records[revisionStart - 1].rev, true);
          }
          if (bytes + size > 8 * 1024 * 1024)
            throw new Error("Sync revision exceeds the transfer limit");
          encodedRecords.push(text);
          bytes += size;
        }
        records.push(record);
      }
    }
    return page ? finishPage(untilRev, false) : { rev: untilRev, records };
  };
  // A pull only reads committed records: it runs on one read snapshot beside the writer queue.
  return db instanceof StoreDatabase ? db.readScope(work) : work();
}

const PULL_BATCH_ROWS = 256;
/** Rows in `(sinceRev, untilRev]`, oldest first, read in bounded keyset batches. */
async function* pullBatches(db: SyncDatabase, sinceRev: number, untilRev: number) {
  if (sinceRev >= untilRev) return;
  // Every accepted write gets its own rev; rowid keeps a shared legacy rev from being skipped.
  const first = db.prepare(
    `SELECT rowid AS row_key, table_name, id, value, rev FROM sync_records WHERE rev > ? AND rev <= ? ORDER BY rev, rowid LIMIT ${PULL_BATCH_ROWS + 1}`,
  );
  const next = db.prepare(
    `SELECT rowid AS row_key, table_name, id, value, rev FROM sync_records WHERE (rev, rowid) > (?, ?) AND rev <= ? ORDER BY rev, rowid LIMIT ${PULL_BATCH_ROWS + 1}`,
  );
  let rows = await first.all(sinceRev, untilRev);
  for (;;) {
    if (rows.length <= PULL_BATCH_ROWS) {
      yield rows;
      return;
    }
    // The lookahead proves another batch exists, including rows sharing a revision.
    rows.pop();
    yield rows;
    const last = rows[PULL_BATCH_ROWS - 1];
    rows = await next.all(last.rev, last.row_key, untilRev);
  }
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
