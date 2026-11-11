import { isoTimestamp } from "../../src/shared/lib/time/timestamps";
import type { HostStore } from "../store";
import { withShortBusyTimeout } from "./short-busy-timeout";

/** VACUUM gates: free pages are reused, so only a mostly empty file is worth a rewrite. */
export const HOST_DB_COMPACTION_MIN_FREE_RATIO = 0.25;
export const HOST_DB_COMPACTION_MIN_UPTIME_MS = 10 * 60 * 1000;
export const HOST_DB_COMPACTION_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Metadata row with the ISO time of the last VACUUM. */
export const HOST_DB_COMPACTION_MARKER = "hostDbCompactedAt";

async function pragmaNumber(store: HostStore, name: string) {
  const row = await store.db.prepare(`PRAGMA ${name}`).get();
  return Number(row && Object.values(row)[0]);
}

const truncateWal = (store: HostStore) =>
  withShortBusyTimeout(store.db, () => store.db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get());

/**
 * Rewrites the database file when more than a quarter of its pages are free, at most
 * once a day, only while no session or shell is running and the Host has been up long
 * enough, and switches it to incremental auto-vacuum. VACUUM holds the store for the
 * whole rewrite, hence the idle gate. Returns the file sizes when it ran.
 */
export async function compactHostDatabase(
  store: HostStore,
  options: { uptimeMs?: () => number; now?: () => number; stopped?: () => boolean } = {},
): Promise<{ before: number; after: number } | undefined> {
  if (options.stopped?.()) return undefined;
  const uptime = options.uptimeMs?.() ?? process.uptime() * 1000;
  if (uptime < HOST_DB_COMPACTION_MIN_UPTIME_MS) return undefined;
  const now = options.now?.() ?? Date.now();
  return store.db.storeScope(async () => {
    const pages = await pragmaNumber(store, "page_count");
    const free = await pragmaNumber(store, "freelist_count");
    if (!pages || free / pages <= HOST_DB_COMPACTION_MIN_FREE_RATIO) return undefined;
    const last = await store.db
      .prepare("SELECT value FROM metadata WHERE key = ?")
      .get(HOST_DB_COMPACTION_MARKER);
    const lastMs = Date.parse(String(last?.value ?? ""));
    if (Math.abs(now - lastMs) < HOST_DB_COMPACTION_MIN_INTERVAL_MS) return undefined;
    await truncateWal(store);
    const busy = await store.db
      .prepare(
        "SELECT COUNT(*) AS n FROM session_state WHERE status = 'running' OR shell_running = 1",
      )
      .get();
    if (Number(busy?.n ?? 1) > 0) return undefined;
    const pageSize = await pragmaNumber(store, "page_size");
    // Only a VACUUM can switch an existing file to incremental auto-vacuum; from then on
    // the maintenance pass releases free pages in bounded steps and this rewrite is rare.
    await store.db.exec("PRAGMA auto_vacuum=INCREMENTAL");
    await store.db.exec("VACUUM");
    await store.db
      .prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)")
      .run(HOST_DB_COMPACTION_MARKER, isoTimestamp(now) ?? new Date().toISOString());
    // In WAL mode the rewrite goes through the WAL; the file shrinks at this checkpoint.
    await truncateWal(store);
    return {
      before: pages * pageSize,
      after: (await pragmaNumber(store, "page_count")) * pageSize,
    };
  });
}
