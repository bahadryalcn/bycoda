import { createHash } from "node:crypto";
import type { StoreDatabase } from "../store-db";
import type { CommandReceipt } from "../../src/features/connections/model/protocol";

const signatureHash = (signature: string) => createHash("sha256").update(signature).digest("hex");

/** Keep replay answers forever; retire only the potentially large original request signature. */
export async function initializeCommandReceiptRetention(db: StoreDatabase): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS compact_command_receipts (
      id TEXT PRIMARY KEY, signature_hash TEXT NOT NULL, receipt TEXT NOT NULL, created_at INTEGER
    );
    CREATE TRIGGER IF NOT EXISTS compact_command_receipt_no_reuse
    BEFORE INSERT ON receipts
    WHEN EXISTS (SELECT 1 FROM compact_command_receipts WHERE id=NEW.id)
    BEGIN SELECT RAISE(ABORT, 'Command ID was already used'); END;
    CREATE TABLE IF NOT EXISTS compact_workspace_receipts (
      scope TEXT NOT NULL, idempotency_key TEXT NOT NULL, signature_hash TEXT NOT NULL,
      response TEXT NOT NULL, created_at INTEGER, PRIMARY KEY(scope,idempotency_key)
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
  }
}

export async function readWorkspaceReceipt<T>(
  db: StoreDatabase,
  scope: string,
  key: string,
  signature: string,
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
  if (!full && !compact) return null;
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
  if (!row) return undefined;
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
    await db
      .prepare(
        "INSERT INTO compact_command_receipts(id,signature_hash,receipt,created_at) VALUES(?,?,?,?)",
      )
      .run(
        String(row.id),
        signatureHash(String(row.signature)),
        String(row.receipt),
        Number(row.created_at),
      );
    await db.prepare("DELETE FROM receipts WHERE id=?").run(String(row.id));
  }
  const workspaceRows = await db
    .prepare(`SELECT scope,idempotency_key,signature,response,created_at
    FROM workspace_mutation_receipts WHERE created_at < ? ORDER BY created_at LIMIT 512`)
    .all(cutoff);
  for (const row of workspaceRows) {
    await db
      .prepare(
        "INSERT INTO compact_workspace_receipts(scope,idempotency_key,signature_hash,response,created_at) VALUES(?,?,?,?,?)",
      )
      .run(
        String(row.scope),
        String(row.idempotency_key),
        signatureHash(String(row.signature)),
        String(row.response),
        Number(row.created_at),
      );
    await db
      .prepare("DELETE FROM workspace_mutation_receipts WHERE scope=? AND idempotency_key=?")
      .run(String(row.scope), String(row.idempotency_key));
  }
}

/**
 * Replay answers are kept for the compact retention window, then deleted. Only compacted
 * (already settled) rows are eligible; pending effects and full receipts are never touched.
 * Caller holds the critical writer transaction.
 */
export async function pruneCompactReceipts(db: StoreDatabase, cutoff: number): Promise<void> {
  db.assertCriticalScope();
  await db
    .prepare(
      `DELETE FROM compact_command_receipts WHERE rowid IN (
        SELECT rowid FROM compact_command_receipts WHERE created_at < ? ORDER BY created_at LIMIT 512)`,
    )
    .run(cutoff);
  await db
    .prepare(
      `DELETE FROM compact_workspace_receipts WHERE rowid IN (
        SELECT rowid FROM compact_workspace_receipts WHERE created_at < ? ORDER BY created_at LIMIT 512)`,
    )
    .run(cutoff);
}
