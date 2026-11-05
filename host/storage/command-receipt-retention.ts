import { createHash } from "node:crypto";
import type { StoreDatabase } from "../store-db";
import type { CommandReceipt } from "../../src/features/connections/model/protocol";
import { requestIssuedAt } from "../../src/shared/lib/id/requestId";
import {
  REQUEST_EXPIRED_ERROR_CODE,
  REQUEST_EXPIRED_MESSAGE,
} from "../../src/shared/model/host-contracts/schemas";

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * A UUIDv7 request id older than this with no receipt is refused, never run. Its fence is
 * deleted only one day later, so every id still inside the horizon keeps its fence.
 */
export const REPLAY_HORIZON_MS = 30 * DAY_MS;
/** Compact fences are deleted only after this margin past the replay horizon. */
const FENCE_DELETE_MARGIN_MS = DAY_MS;
const DELETE_BATCH = 512;

const signatureHash = (signature: string) => createHash("sha256").update(signature).digest("hex");

/** Refuses an id with no receipt whose embedded issue time is beyond the replay horizon. */
export function assertWithinReplayHorizon(id: string, now = Date.now()): void {
  const issuedAt = requestIssuedAt(id);
  if (issuedAt === undefined || issuedAt >= now - REPLAY_HORIZON_MS) return;
  throw Object.assign(new Error(REQUEST_EXPIRED_MESSAGE), { code: REQUEST_EXPIRED_ERROR_CODE });
}

/**
 * Full receipts are kept forever. Compact fences keep the answer (and the id's replay
 * fence) and retire only the potentially large original request signature. Compact rows
 * carry the id's issue time when it has one; legacy ids (issued_at NULL) are kept.
 */
export async function initializeCommandReceiptRetention(db: StoreDatabase): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS compact_command_receipts (
      id TEXT PRIMARY KEY, signature_hash TEXT NOT NULL, receipt TEXT NOT NULL, created_at INTEGER,
      issued_at INTEGER
    );
    CREATE TRIGGER IF NOT EXISTS compact_command_receipt_no_reuse
    BEFORE INSERT ON receipts
    WHEN EXISTS (SELECT 1 FROM compact_command_receipts WHERE id=NEW.id)
    BEGIN SELECT RAISE(ABORT, 'Command ID was already used'); END;
    CREATE TABLE IF NOT EXISTS compact_workspace_receipts (
      scope TEXT NOT NULL, idempotency_key TEXT NOT NULL, signature_hash TEXT NOT NULL,
      response TEXT NOT NULL, created_at INTEGER, issued_at INTEGER, PRIMARY KEY(scope,idempotency_key)
    );
    CREATE TRIGGER IF NOT EXISTS compact_workspace_receipt_no_reuse
    BEFORE INSERT ON workspace_mutation_receipts
    WHEN EXISTS (SELECT 1 FROM compact_workspace_receipts WHERE scope=NEW.scope AND idempotency_key=NEW.idempotency_key)
    BEGIN SELECT RAISE(ABORT, 'Workspace idempotency key was already used'); END;
  `);
  // Databases created before compact rows carried a timestamp. Legacy rows get a full window.
  for (const table of ["compact_command_receipts", "compact_workspace_receipts"]) {
    const columns = await db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((column) => column.name === "created_at"))
      await db.exec(`ALTER TABLE ${table} ADD COLUMN created_at INTEGER`);
    await db.prepare(`UPDATE ${table} SET created_at=? WHERE created_at IS NULL`).run(Date.now());
    if (!columns.some((column) => column.name === "issued_at"))
      await db.exec(`ALTER TABLE ${table} ADD COLUMN issued_at INTEGER`);
  }
  await db.exec(`
    CREATE INDEX IF NOT EXISTS compact_command_receipts_issued_at ON compact_command_receipts(issued_at);
    CREATE INDEX IF NOT EXISTS compact_workspace_receipts_issued_at ON compact_workspace_receipts(issued_at);
  `);
}

export async function readWorkspaceReceipt<T>(
  db: StoreDatabase,
  scope: string,
  key: string,
  signature: string,
  options: { admit?: boolean; now?: number } = {},
): Promise<T | null> {
  const full = await db
    .prepare(
      "SELECT signature,response FROM workspace_mutation_receipts WHERE scope=? AND idempotency_key=?",
    )
    .get(scope, key);
  const compact = full
    ? undefined
    : await db
        .prepare(
          "SELECT signature_hash,response FROM compact_workspace_receipts WHERE scope=? AND idempotency_key=?",
        )
        .get(scope, key);
  if (!full && !compact) {
    if (options.admit) assertWithinReplayHorizon(key, options.now);
    return null;
  }
  if (full ? full.signature !== signature : compact!.signature_hash !== signatureHash(signature))
    throw Object.assign(new Error("Idempotency key was already used with a different request"), {
      code: "WORKSPACE_IDEMPOTENCY_CONFLICT",
    });
  return JSON.parse(String((full ?? compact)!.response)) as T;
}

export async function readCommandReceipt(
  db: StoreDatabase,
  id: string,
  signature?: string,
  options: { admit?: boolean; now?: number } = {},
): Promise<CommandReceipt | undefined> {
  if (await db.prepare("SELECT id FROM desktop_command_delivery WHERE id=?").get(id)) {
    if (signature !== undefined) throw new Error("Command ID belongs to a desktop control.");
    return undefined;
  }
  const full = await db.prepare("SELECT signature,receipt FROM receipts WHERE id=?").get(id);
  const compact = full
    ? undefined
    : await db
        .prepare("SELECT signature_hash,receipt FROM compact_command_receipts WHERE id=?")
        .get(id);
  const row = full ?? compact;
  if (!row) {
    if (options.admit) assertWithinReplayHorizon(id, options.now);
    return undefined;
  }
  if (
    signature !== undefined &&
    (full ? full.signature !== signature : compact!.signature_hash !== signatureHash(signature))
  )
    throw new Error("Command ID was already used with a different payload");
  return JSON.parse(String(row.receipt)) as CommandReceipt;
}

/** Caller holds the critical writer transaction. No pending effects or response bytes are removed. */
export async function compactCommandReceipts(db: StoreDatabase, cutoff: number): Promise<void> {
  db.assertCriticalScope();
  const rows = await db
    .prepare(`SELECT id,signature,receipt,created_at FROM receipts
    WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM desktop_command_delivery d WHERE d.id=receipts.id)
    ORDER BY created_at LIMIT 512`)
    .all(cutoff);
  for (const row of rows) {
    const issuedAt = requestIssuedAt(String(row.id)) ?? null;
    await db
      .prepare(
        "INSERT INTO compact_command_receipts(id,signature_hash,receipt,created_at,issued_at) VALUES(?,?,?,?,?)",
      )
      .run(
        String(row.id),
        signatureHash(String(row.signature)),
        String(row.receipt),
        Number(row.created_at),
        issuedAt,
      );
    await db.prepare("DELETE FROM receipts WHERE id=?").run(String(row.id));
  }
  const workspaceRows = await db
    .prepare(`SELECT scope,idempotency_key,signature,response,created_at
    FROM workspace_mutation_receipts WHERE created_at < ? ORDER BY created_at LIMIT 512`)
    .all(cutoff);
  for (const row of workspaceRows) {
    const issuedAt = requestIssuedAt(String(row.idempotency_key)) ?? null;
    await db
      .prepare(
        "INSERT INTO compact_workspace_receipts(scope,idempotency_key,signature_hash,response,created_at,issued_at) VALUES(?,?,?,?,?,?)",
      )
      .run(
        String(row.scope),
        String(row.idempotency_key),
        signatureHash(String(row.signature)),
        String(row.response),
        Number(row.created_at),
        issuedAt,
      );
    await db
      .prepare("DELETE FROM workspace_mutation_receipts WHERE scope=? AND idempotency_key=?")
      .run(String(row.scope), String(row.idempotency_key));
  }
}

/**
 * Deletes compact fences whose issue time is older than the replay horizon plus a margin.
 * Caller holds the critical writer transaction. Legacy rows (issued_at NULL) are never deleted.
 */
export async function deleteExpiredReceiptFences(db: StoreDatabase, now: number): Promise<void> {
  db.assertCriticalScope();
  const cutoff = now - REPLAY_HORIZON_MS - FENCE_DELETE_MARGIN_MS;
  for (const table of ["compact_command_receipts", "compact_workspace_receipts"]) {
    for (;;) {
      const result = await db
        .prepare(
          `DELETE FROM ${table} WHERE rowid IN (
            SELECT rowid FROM ${table} WHERE issued_at IS NOT NULL AND issued_at < ?
            ORDER BY issued_at LIMIT ${DELETE_BATCH})`,
        )
        .run(cutoff);
      if (Number(result.changes) < DELETE_BATCH) break;
    }
  }
}
