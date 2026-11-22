import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { HostStore } from "../store";
import { withShortBusyTimeout } from "./short-busy-timeout";

// One-time cleanup of the retired Host native buffer store (owner reports are no longer
// persisted). Idempotent: every step does nothing once its target is gone. Remove this
// module one release after it shipped everywhere (see temp/local/2026-11-22-remove-buffer-ownership).

/** Large content tables first; the indexes of a table go with `DROP TABLE`. */
export const RETIRED_NATIVE_BUFFER_TABLES = [
  "native_buffer_blob_chunks",
  "native_buffer_blobs",
  "native_buffer_artifacts",
  "native_buffer_directory_children",
  "native_buffer_certificates",
  "native_buffer_directory_index",
  "native_buffer_clock_witnesses",
  "native_buffer_clocks",
] as const;

export const RETIRED_NATIVE_BUFFER_BATCH_ROWS = 20_000;
export const RETIRED_NATIVE_BUFFER_PASS_MAX_BATCHES = 200;
export const RETIRED_NATIVE_BUFFER_PASS_MAX_MS = 2 * 60 * 1000;

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const yieldToQueue = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Exact retired paths only. `native-activity/processes/` and everything else stays. */
export function retiredNativeBufferPaths(dataDir: string, managedRoot: string) {
  return [
    join(managedRoot, "native-activity", "buffers"),
    join(managedRoot, "native-activity", "buffer-history"),
    join(dataDir, "native-buffer-store.git"),
  ];
}

/** Removes the retired directories. A failure is logged and retried on the next start. */
export async function removeRetiredNativeBufferFiles(
  dataDir: string,
  managedRoot: string,
  warn: (message: string, error: unknown) => void = console.warn,
): Promise<number> {
  let removed = 0;
  for (const path of retiredNativeBufferPaths(dataDir, managedRoot))
    try {
      await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      removed++;
    } catch (error) {
      warn(`Retired native buffer files were not removed (${path}); retrying next start:`, error);
    }
  return removed;
}

export type RetiredNativeBufferTablesResult = { deletedRows: number; done: boolean };

/**
 * Maintenance pass: delete rows of the retired tables in bounded transactions through the
 * store worker, yielding between batches, then `DROP TABLE` each emptied table. `done`
 * means no retired table remains; otherwise the next pass continues. Compaction reclaims
 * the file afterwards, so no single statement holds the writer lock on a large database.
 */
export async function releaseRetiredNativeBufferTables(
  store: HostStore,
  options: {
    stopped?: () => boolean;
    now?: () => number;
    batchRows?: number;
    maxBatches?: number;
  } = {},
): Promise<RetiredNativeBufferTablesResult> {
  const now = options.now ?? Date.now;
  const deadline = now() + RETIRED_NATIVE_BUFFER_PASS_MAX_MS;
  const names = await store.db.storeScope(() =>
    store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all(),
  );
  const present = new Set(names.map((row) => String(row.name)));
  const limit = Math.trunc(options.batchRows ?? RETIRED_NATIVE_BUFFER_BATCH_ROWS);
  let deletedRows = 0;
  let batches = 0;
  for (const table of RETIRED_NATIVE_BUFFER_TABLES) {
    if (!present.has(table)) continue;
    for (;;) {
      if (
        options.stopped?.() ||
        batches >= (options.maxBatches ?? RETIRED_NATIVE_BUFFER_PASS_MAX_BATCHES) ||
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
                    .prepare(
                      `DELETE FROM ${quote(table)} WHERE rowid IN (SELECT rowid FROM ${quote(table)} LIMIT ${limit})`,
                    )
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
    await store.db.storeScope(() =>
      withShortBusyTimeout(store.db, () =>
        store.transaction(async () => {
          await store.db.exec(`DROP TABLE IF EXISTS ${quote(table)}`);
        }, "checkpoint"),
      ),
    );
  }
  return { deletedRows, done: true };
}
