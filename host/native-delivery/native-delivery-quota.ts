import type { StoreDatabase } from "../store-db";

/**
 * Incremental byte/row quota counters for native_delivery_receipts.
 *
 * Counters live beside the receipts and move only inside receipt triggers, so every
 * INSERT, release, record, retire and epoch compaction DELETE commits or rolls back
 * with its receipt. Startup never rescans: one atomic backfill runs only when no
 * established metadata row exists; later opens verify the marker and triggers.
 */
export const NATIVE_DELIVERY_QUOTA_VERSION = 1;
/** Reservation charged for a NULL reserved_bytes. Must equal native-delivery-store MAX_RESULT_BYTES. */
export const NATIVE_DELIVERY_QUOTA_NULL_RESERVED_BYTES = 32 * 1024 * 1024;

const FORMAT_KIND = "native.services.workspace.format";
const KINDS = ["buffer", "native.services.conversation.desktop.finish", FORMAT_KIND] as const;
const STATES = ["admitted", "recorded", "retired"] as const;
const QUOTA_TRIGGERS = [
  "native_delivery_quota_insert",
  "native_delivery_quota_update",
  "native_delivery_quota_delete",
] as const;
const RECEIPT_COLUMNS = [
  "environment_id",
  "principal_id",
  "kind",
  "state",
  "reserved_bytes",
  "result_bytes",
] as const;

export type NativeDeliveryQuota = {
  /** Every retained receipt in the journal, including retired rows. */
  total: number;
  /** Receipts for this environment and principal. */
  own: number;
  /** Format byte budget across all scopes. */
  bytes: number;
  /** Format byte budget for this environment and principal. */
  ownBytes: number;
};

function quotaFailure(detail: string) {
  return new Error(`NATIVE_DELIVERY_QUOTA_UNAVAILABLE: ${detail}; retained originals remain held`);
}

/** Bytes one receipt charges to the format budget. Mirrors the former aggregate exactly:
 * NULL reservation falls back to the fixed maximum; retired rows keep only their reservation. */
const charge = (row: "NEW" | "OLD" | "r") =>
  `(CASE WHEN ${row}.kind='${FORMAT_KIND}' THEN COALESCE(${row}.reserved_bytes,(SELECT null_reserved_bytes FROM native_delivery_quota_state WHERE id=1))+CASE WHEN ${row}.state='retired' THEN 0 ELSE COALESCE(${row}.result_bytes,0) END ELSE 0 END)`;
const guard = (condition: string, code: string) =>
  `SELECT CASE WHEN ${condition} THEN RAISE(ABORT,'${code}') END;`;
const scopeMissing = (row: "NEW" | "OLD") =>
  `NOT EXISTS(SELECT 1 FROM native_delivery_quota_scopes WHERE environment_id=${row}.environment_id AND principal_id=${row}.principal_id)`;
const totalsMissing = "NOT EXISTS(SELECT 1 FROM native_delivery_quota_totals WHERE id=1)";

/** Called only inside the receipt initializer's critical transaction, after legacy
 * reservation migration and epoch setup. Creates counters and triggers, and backfills
 * the exact aggregate once when no established metadata exists. */
export async function initializeNativeDeliveryQuota(db: StoreDatabase): Promise<void> {
  db.assertCriticalScope();
  const columns = await db.prepare("PRAGMA table_info(native_delivery_receipts)").all();
  for (const name of RECEIPT_COLUMNS)
    if (!columns.some((column) => column.name === name))
      throw quotaFailure(`receipt column ${name} is missing`);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS native_delivery_quota_state (
      id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, null_reserved_bytes INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS native_delivery_quota_totals (
      id INTEGER PRIMARY KEY CHECK(id=1), receipts INTEGER NOT NULL CHECK(receipts>=0), bytes INTEGER NOT NULL CHECK(bytes>=0));
    CREATE TABLE IF NOT EXISTS native_delivery_quota_scopes (
      environment_id TEXT NOT NULL, principal_id TEXT NOT NULL,
      receipts INTEGER NOT NULL CHECK(receipts>=0), bytes INTEGER NOT NULL CHECK(bytes>=0),
      PRIMARY KEY(environment_id,principal_id));
  `);
  const state = await db
    .prepare("SELECT version,null_reserved_bytes FROM native_delivery_quota_state WHERE id=1")
    .get();
  const triggers = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM sqlite_master WHERE type='trigger' AND name IN (${QUOTA_TRIGGERS.map(() => "?").join(",")})`,
    )
    .get(...QUOTA_TRIGGERS);
  if (state) {
    // Established: verify only; never rescan the journal on open.
    if (
      Number(state.version) !== NATIVE_DELIVERY_QUOTA_VERSION ||
      Number(state.null_reserved_bytes) !== NATIVE_DELIVERY_QUOTA_NULL_RESERVED_BYTES
    )
      throw quotaFailure("quota metadata version or fallback changed");
    const totals = await db
      .prepare("SELECT receipts FROM native_delivery_quota_totals WHERE id=1")
      .get();
    if (!totals) throw quotaFailure("quota totals are missing");
    if (Number(triggers?.count) !== QUOTA_TRIGGERS.length)
      throw quotaFailure("quota triggers are missing");
    return;
  }
  // No marker: counters or triggers without a marker are unexplained state, not a fresh start.
  const leftovers = await db
    .prepare(
      `SELECT 1 AS present FROM native_delivery_quota_totals UNION ALL SELECT 1 FROM native_delivery_quota_scopes LIMIT 1`,
    )
    .get();
  if (leftovers || Number(triggers?.count) !== 0)
    throw quotaFailure("quota metadata is missing for an established journal");
  // Malformed legacy identity or bytes cannot be counted exactly: fail closed.
  const malformed = await db
    .prepare(`SELECT 1 FROM native_delivery_receipts WHERE
      typeof(environment_id)<>'text' OR typeof(principal_id)<>'text'
      OR kind NOT IN (${KINDS.map(() => "?").join(",")}) OR state NOT IN (${STATES.map(() => "?").join(",")})
      OR (reserved_bytes IS NOT NULL AND (typeof(reserved_bytes)<>'integer' OR reserved_bytes<0))
      OR (result_bytes IS NOT NULL AND (typeof(result_bytes)<>'integer' OR result_bytes<0))
      LIMIT 1`)
    .get(...KINDS, ...STATES);
  if (malformed) throw quotaFailure("receipt rows are malformed for quota backfill");
  // The state row must exist first: charge() reads the NULL fallback from it.
  await db
    .prepare(
      "INSERT INTO native_delivery_quota_state(id,version,null_reserved_bytes) VALUES (1,?,?)",
    )
    .run(NATIVE_DELIVERY_QUOTA_VERSION, NATIVE_DELIVERY_QUOTA_NULL_RESERVED_BYTES);
  await db.exec(`
    INSERT INTO native_delivery_quota_scopes(environment_id,principal_id,receipts,bytes)
      SELECT environment_id,principal_id,COUNT(*),COALESCE(SUM(${charge("r")}),0)
      FROM native_delivery_receipts r GROUP BY environment_id,principal_id;
    INSERT INTO native_delivery_quota_totals(id,receipts,bytes)
      SELECT 1,COUNT(*),COALESCE(SUM(${charge("r")}),0) FROM native_delivery_receipts r;
  `);
  // Additive triggers: they fire alongside the receipt protection triggers and rely on
  // their RAISE(ABORT) to roll the whole statement, counters included, back.
  await db.exec(`
    CREATE TRIGGER IF NOT EXISTS native_delivery_quota_insert AFTER INSERT ON native_delivery_receipts BEGIN
      ${guard(totalsMissing, "NATIVE_DELIVERY_QUOTA_MISSING")}
      INSERT OR IGNORE INTO native_delivery_quota_scopes(environment_id,principal_id,receipts,bytes) VALUES(NEW.environment_id,NEW.principal_id,0,0);
      UPDATE native_delivery_quota_scopes SET receipts=receipts+1,bytes=bytes+${charge("NEW")}
        WHERE environment_id=NEW.environment_id AND principal_id=NEW.principal_id;
      UPDATE native_delivery_quota_totals SET receipts=receipts+1,bytes=bytes+${charge("NEW")} WHERE id=1;
    END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_quota_update AFTER UPDATE OF environment_id,principal_id,kind,state,reserved_bytes,result_bytes ON native_delivery_receipts
      WHEN NEW.environment_id IS NOT OLD.environment_id OR NEW.principal_id IS NOT OLD.principal_id OR ${charge("NEW")} IS NOT ${charge("OLD")}
    BEGIN
      ${guard(totalsMissing, "NATIVE_DELIVERY_QUOTA_MISSING")}
      ${guard(scopeMissing("OLD"), "NATIVE_DELIVERY_QUOTA_DRIFT")}
      UPDATE native_delivery_quota_scopes SET receipts=receipts-1,bytes=bytes-${charge("OLD")}
        WHERE environment_id=OLD.environment_id AND principal_id=OLD.principal_id;
      INSERT OR IGNORE INTO native_delivery_quota_scopes(environment_id,principal_id,receipts,bytes) VALUES(NEW.environment_id,NEW.principal_id,0,0);
      UPDATE native_delivery_quota_scopes SET receipts=receipts+1,bytes=bytes+${charge("NEW")}
        WHERE environment_id=NEW.environment_id AND principal_id=NEW.principal_id;
      UPDATE native_delivery_quota_totals SET bytes=bytes-${charge("OLD")}+${charge("NEW")} WHERE id=1;
    END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_quota_delete AFTER DELETE ON native_delivery_receipts BEGIN
      ${guard(totalsMissing, "NATIVE_DELIVERY_QUOTA_MISSING")}
      ${guard(scopeMissing("OLD"), "NATIVE_DELIVERY_QUOTA_DRIFT")}
      UPDATE native_delivery_quota_scopes SET receipts=receipts-1,bytes=bytes-${charge("OLD")}
        WHERE environment_id=OLD.environment_id AND principal_id=OLD.principal_id;
      UPDATE native_delivery_quota_totals SET receipts=receipts-1,bytes=bytes-${charge("OLD")} WHERE id=1;
    END;
  `);
}

/** O(1) read of the counters; a scope without receipts reads as zero. */
export async function readNativeDeliveryQuota(
  db: StoreDatabase,
  environmentId: string,
  principal: string,
): Promise<NativeDeliveryQuota> {
  const quota = await db
    .prepare(`SELECT totals.receipts AS total,totals.bytes,
      COALESCE(own.receipts,0) AS own,COALESCE(own.bytes,0) AS own_bytes,
      CASE WHEN own.receipts IS NULL THEN EXISTS(
        SELECT 1 FROM native_delivery_receipts WHERE environment_id=? AND principal_id=?
      ) ELSE 0 END AS missing_scope
      FROM native_delivery_quota_totals totals
      LEFT JOIN native_delivery_quota_scopes own ON own.environment_id=? AND own.principal_id=?
      WHERE totals.id=1`)
    .get(environmentId, principal, environmentId, principal);
  if (!quota) throw quotaFailure("quota totals are missing");
  if (Number(quota.missing_scope) !== 0) throw quotaFailure("receipt scope counters are missing");
  return {
    total: Number(quota.total),
    own: Number(quota.own),
    bytes: Number(quota.bytes),
    ownBytes: Number(quota.own_bytes),
  };
}
