import type { StoreDatabase } from "../store-db";

/** Background maintenance waits briefly for an external SQLite locker and gives up
 * instead of holding the in-process SQL queue for the default 5 s. Call inside one
 * scope: the setting belongs to the shared connection and is restored afterwards. */
export async function withShortBusyTimeout<T>(
  db: StoreDatabase,
  work: () => Promise<T>,
  timeoutMs = 200,
): Promise<T> {
  const row = await db.prepare("PRAGMA busy_timeout").get();
  const previous = Number(row && Object.values(row)[0]) || 5000;
  await db.exec(`PRAGMA busy_timeout=${timeoutMs}`);
  try {
    return await work();
  } finally {
    await db.exec(`PRAGMA busy_timeout=${previous}`);
  }
}
