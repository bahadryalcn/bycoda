import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { HostStore } from "../store";
import { withShortBusyTimeout } from "../storage/short-busy-timeout";

/** Content tables of the legacy SQL native buffer store, in deletion order; the clock
 * tables are kept. The directory index marker goes last: it names the highest indexed
 * artifact, and a marker above the emptied artifact table fences every later clock
 * initialization (new native buffer reports) as corrupt retention. */
export const NATIVE_BUFFER_LEGACY_TABLES = [
  "native_buffer_blob_chunks",
  "native_buffer_blobs",
  "native_buffer_artifacts",
  "native_buffer_directory_children",
  "native_buffer_certificates",
  "native_buffer_directory_index",
] as const;
/** Automatic release (maintenance pass): rows per transaction and per-pass caps. */
export const NATIVE_BUFFER_LEGACY_BATCH_ROWS = 20_000;
export const NATIVE_BUFFER_LEGACY_PASS_MAX_BATCHES = 200;
export const NATIVE_BUFFER_LEGACY_PASS_MAX_MS = 2 * 60 * 1000;
/** One-time VACUUM gates after the release. */
export const NATIVE_BUFFER_LEGACY_VACUUM_MIN_FREE_RATIO = 0.25;
export const NATIVE_BUFFER_LEGACY_VACUUM_MIN_UPTIME_MS = 10 * 60 * 1000;
export const NATIVE_BUFFER_LEGACY_VACUUM_MARKER = "nativeBufferLegacyVacuum";

export type NativeBufferLegacyTableStat = { table: string; rows: number; bytes: number };
export type NativeBufferLegacyRelease = {
  tables: NativeBufferLegacyTableStat[];
  dropped: boolean;
  /** Main file plus WAL, before and after; present only when dropped. */
  sizeBefore: number;
  sizeAfter?: number;
};

const fileBytes = (path: string) => (existsSync(path) ? statSync(path).size : 0);
const databaseBytes = (path: string) => fileBytes(path) + fileBytes(`${path}-wal`);
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
/** Whole table when `limit` is absent (CLI), otherwise at most `limit` rows. */
const deleteSql = (table: string, limit?: number) =>
  limit === undefined
    ? `DELETE FROM ${quote(table)}`
    : `DELETE FROM ${quote(table)} WHERE rowid IN (SELECT rowid FROM ${quote(table)} LIMIT ${Math.trunc(limit)})`;

/**
 * Owner-run, Host stopped (the caller verifies). Without `apply` only reports; with it
 * deletes all rows in one transaction, then VACUUM reclaims the file.
 */
export function releaseNativeBufferLegacy(
  dataDir: string,
  options: { apply: boolean },
): NativeBufferLegacyRelease {
  const path = join(dataDir, "host.db");
  if (!existsSync(path)) throw new Error(`No host.db in ${dataDir}`);
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const present = new Set(
      (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
          name: string;
        }[]
      ).map((row) => row.name),
    );
    const tables = NATIVE_BUFFER_LEGACY_TABLES.filter((table) => present.has(table)).map(
      (table) => {
        const columns = (
          db.prepare(`PRAGMA table_info(${quote(table)})`).all() as { name: string; type: string }[]
        )
          .filter((column) => /BLOB|TEXT/i.test(column.type))
          .map((column) => `COALESCE(LENGTH(CAST(${quote(column.name)} AS BLOB)),0)`);
        const row = db
          .prepare(
            `SELECT COUNT(*) AS rows, ${columns.length ? `SUM(${columns.join("+")})` : "0"} AS bytes FROM ${quote(table)}`,
          )
          .get() as { rows: number; bytes: number | null };
        return { table, rows: Number(row.rows), bytes: Number(row.bytes ?? 0) };
      },
    );
    const sizeBefore = databaseBytes(path);
    if (!options.apply) return { tables, dropped: false, sizeBefore };
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const { table } of tables) db.exec(deleteSql(table));
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    db.exec("VACUUM");
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return { tables, dropped: true, sizeBefore, sizeAfter: databaseBytes(path) };
  } finally {
    db.close();
  }
}

export function formatNativeBufferLegacyRelease(result: NativeBufferLegacyRelease): string {
  const lines = result.tables.map(
    (t) => `  ${t.table}: ${t.rows} rows, ${t.bytes} bytes of content`,
  );
  lines.unshift(result.dropped ? "Dropped legacy native buffer rows:" : "Would drop:");
  lines.push(
    result.dropped
      ? `host.db: ${result.sizeBefore} -> ${result.sizeAfter} bytes`
      : `host.db is ${result.sizeBefore} bytes. Re-run with --yes to drop these rows (irreversible; back up host.db first).`,
  );
  return lines.join("\n");
}

export type NativeBufferLegacyPassResult = { deletedRows: number; done: boolean };
const yieldToQueue = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Maintenance pass: delete legacy rows in bounded transactions through the store worker,
 * yielding between batches. `done` means no legacy row remains; otherwise the next pass
 * continues. Only call when the Host runs on the git store.
 */
export async function releaseNativeBufferLegacyBatches(
  store: HostStore,
  options: {
    stopped?: () => boolean;
    now?: () => number;
    batchRows?: number;
    maxBatches?: number;
  } = {},
): Promise<NativeBufferLegacyPassResult> {
  const now = options.now ?? Date.now;
  const deadline = now() + NATIVE_BUFFER_LEGACY_PASS_MAX_MS;
  const names = await store.db.storeScope(() =>
    store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all(),
  );
  const present = new Set(names.map((row) => String(row.name)));
  let deletedRows = 0;
  let batches = 0;
  for (const table of NATIVE_BUFFER_LEGACY_TABLES) {
    if (!present.has(table)) continue;
    for (;;) {
      if (
        options.stopped?.() ||
        batches >= (options.maxBatches ?? NATIVE_BUFFER_LEGACY_PASS_MAX_BATCHES) ||
        now() >= deadline
      )
        return { deletedRows, done: false };
      const changes = await store.db.storeScope(() =>
        withShortBusyTimeout(store.db, () =>
          store.transaction(
            async () =>
              Number(
                (
                  await store.db
                    .prepare(deleteSql(table, options.batchRows ?? NATIVE_BUFFER_LEGACY_BATCH_ROWS))
                    .run()
                ).changes,
              ),
            "checkpoint",
          ),
        ),
      );
      if (!changes) break;
      batches++;
      deletedRows += changes;
      await yieldToQueue();
    }
  }
  return { deletedRows, done: true };
}

async function pragmaNumber(store: HostStore, name: string) {
  const row = await store.db.prepare(`PRAGMA ${name}`).get();
  return Number(row && Object.values(row)[0]);
}

/**
 * After the release finished: WAL truncate, then a single VACUUM, only while no session
 * is running, more than a quarter of the pages are free and the Host has been up long
 * enough. Returns the sizes when it ran. The marker row makes it never repeat.
 */
export async function vacuumAfterNativeBufferLegacyRelease(
  store: HostStore,
  options: { uptimeMs?: () => number; stopped?: () => boolean } = {},
): Promise<{ before: number; after: number } | undefined> {
  if (options.stopped?.()) return undefined;
  const uptime = options.uptimeMs?.() ?? process.uptime() * 1000;
  return store.db.storeScope(async () => {
    const marker = await store.db
      .prepare("SELECT 1 AS found FROM metadata WHERE key = ?")
      .get(NATIVE_BUFFER_LEGACY_VACUUM_MARKER);
    if (marker || uptime < NATIVE_BUFFER_LEGACY_VACUUM_MIN_UPTIME_MS) return undefined;
    await withShortBusyTimeout(store.db, () =>
      store.db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get(),
    );
    const busy = await store.db
      .prepare(
        "SELECT COUNT(*) AS n FROM session_state WHERE status = 'running' OR shell_running = 1",
      )
      .get();
    if (Number(busy?.n ?? 1) > 0) return undefined;
    const pages = await pragmaNumber(store, "page_count");
    const free = await pragmaNumber(store, "freelist_count");
    const pageSize = await pragmaNumber(store, "page_size");
    if (!pages || free / pages <= NATIVE_BUFFER_LEGACY_VACUUM_MIN_FREE_RATIO) return undefined;
    await store.db.exec("VACUUM");
    await store.db
      .prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)")
      .run(NATIVE_BUFFER_LEGACY_VACUUM_MARKER, new Date().toISOString());
    return {
      before: pages * pageSize,
      after: (await pragmaNumber(store, "page_count")) * pageSize,
    };
  });
}
