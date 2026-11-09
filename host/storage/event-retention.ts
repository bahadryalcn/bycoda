import type { StoreDatabase } from "../store-db";
import { withShortBusyTimeout } from "./short-busy-timeout";

/** All sessions' replay events together; the per-session cap alone let ~100 busy
 * sessions keep 400 MB. Clients behind the kept suffix get the snapshot instead. */
export const EVENT_BYTES_TOTAL = 256 * 1024 * 1024;
/** The global cap never trims a session below its newest revisions. */
export const EVENT_REVISIONS_KEPT = 50;

/** Drops a session's oldest events until the newest suffix fits `maxBytes`, always
 * keeping the newest `keep` revisions. Only a contiguous newest suffix stays, which is
 * what `HostStore.events()` replays. Returns the deleted row count. */
export async function trimSessionEvents(
  db: StoreDatabase,
  id: string,
  maxBytes: number,
  keep = 1,
): Promise<number> {
  const over = await db
    .prepare(
      `SELECT revision FROM (
         SELECT revision, SUM(octet_length(payload)) OVER (ORDER BY revision DESC) AS bytes
         FROM events WHERE session_id=?1
       ) WHERE bytes>?2 AND revision<(
         SELECT revision FROM events WHERE session_id=?1 ORDER BY revision DESC LIMIT 1 OFFSET ?3)
       ORDER BY revision DESC LIMIT 1`,
    )
    .get(id, maxBytes, Math.max(0, keep - 1));
  if (!over) return 0;
  const result = await db
    .prepare("DELETE FROM events WHERE session_id=? AND revision<=?")
    .run(id, Number(over.revision));
  return Number(result.changes ?? 0);
}

/** Largest per-session byte budget `L` with sum(min(bytes, L)) <= cap (water-filling),
 * so only the largest sessions lose their oldest events. */
export function eventBudget(sizes: number[], cap: number): number | null {
  const sorted = [...sizes].sort((a, b) => b - a);
  let rest = sorted.reduce((sum, size) => sum + size, 0);
  if (rest <= cap) return null;
  for (let index = 0; index < sorted.length; index++) {
    rest -= sorted[index];
    const budget = Math.floor((cap - rest) / (index + 1));
    if (index + 1 === sorted.length || budget >= sorted[index + 1]) return Math.max(0, budget);
  }
  return 0;
}

export type EventRetentionResult = { totalBytes: number; deletedRows: number; sessions: number };

type Transaction = <T>(work: () => Promise<T>) => Promise<T>;

/** Enforces `EVENT_BYTES_TOTAL` across sessions, one short transaction per trimmed
 * session. Kept revisions win over the cap: the result can stay slightly above it. */
export async function capEventsGlobally(
  db: StoreDatabase,
  transaction: Transaction,
  options: { cap?: number; keep?: number; stopped?: () => boolean } = {},
): Promise<EventRetentionResult> {
  const rows = await db.storeScope(() =>
    db
      .prepare(
        "SELECT session_id, SUM(octet_length(payload)) AS bytes FROM events GROUP BY session_id",
      )
      .all(),
  );
  const sizes = rows.map((row) => Number(row.bytes));
  const totalBytes = sizes.reduce((sum, size) => sum + size, 0);
  const budget = eventBudget(sizes, options.cap ?? EVENT_BYTES_TOTAL);
  const result = { totalBytes, deletedRows: 0, sessions: 0 };
  if (budget === null) return result;
  for (const row of rows) {
    if (Number(row.bytes) <= budget) continue;
    if (options.stopped?.()) break;
    const deleted = await db.storeScope(() =>
      withShortBusyTimeout(db, () =>
        transaction(() =>
          trimSessionEvents(
            db,
            String(row.session_id),
            budget,
            options.keep ?? EVENT_REVISIONS_KEPT,
          ),
        ),
      ),
    );
    result.deletedRows += deleted;
    if (deleted) result.sessions++;
  }
  return result;
}
