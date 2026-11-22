import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "../store";
import {
  dryRunHostDbMaintenance,
  runHostDbMaintenance,
  scheduleHostDbMaintenance,
} from "./host-db-maintenance";
import { storeWithRetiredNativeBuffers, tableNames } from "./retired-native-buffer.test-support";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
});

async function plainStore(prepare?: (path: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-db-maintenance-"));
  const path = join(directory, "host.db");
  prepare?.(path);
  const store = new HostStore(path);
  cleanups.push(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return store;
}
const autoVacuum = async (store: HostStore) =>
  Number(Object.values((await store.db.prepare("PRAGMA auto_vacuum").get()) ?? {})[0]);
const hasRetiredTables = async (store: HostStore) =>
  (await tableNames(store)).some((name) => name.startsWith("native_buffer_"));

it("releases the retired tables, checkpoints the WAL and leaves auto_vacuum of a default database alone", async () => {
  const { store } = await storeWithRetiredNativeBuffers(cleanups);
  expect(await dryRunHostDbMaintenance(store)).toMatchObject({ eventBytesOverCap: 0 });
  const result = await runHostDbMaintenance(store);
  expect(result.retiredRowsDeleted).toBe(12);
  expect(result.events.deletedRows).toBe(0);
  expect(result.incrementalVacuum).toBe(false);
  expect(result.checkpoint).toMatchObject({ busy: 0 });
  expect(await autoVacuum(store)).toBe(0);
  expect(await hasRetiredTables(store)).toBe(false);
  // Nothing left to delete: no checkpoint either.
  expect((await runHostDbMaintenance(store)).checkpoint).toBeUndefined();
});

it("runs incremental_vacuum only when the database already uses it", async () => {
  const store = await plainStore((path) => {
    const db = new DatabaseSync(path);
    db.exec("PRAGMA auto_vacuum=INCREMENTAL; CREATE TABLE fixture_marker (id INTEGER)");
    db.close();
  });
  await store.db.exec(
    "CREATE TABLE native_buffer_clocks (report_id TEXT); INSERT INTO native_buffer_clocks VALUES ('r')",
  );
  expect(await autoVacuum(store)).toBe(2);
  const result = await runHostDbMaintenance(store);
  expect(result).toMatchObject({ incrementalVacuum: true, retiredRowsDeleted: 1 });
  expect(await autoVacuum(store)).toBe(2);
});

it("runs on its timer off the request path and stops cleanly", async () => {
  const { store } = await storeWithRetiredNativeBuffers(cleanups);
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const scheduled = scheduleHostDbMaintenance(store, { first: 1, every: 60_000 });
  await vi.waitFor(
    () =>
      expect(info.mock.calls.map((call) => String(call[0])).join("\n")).toMatch(
        /Released 12 retired native buffer rows/,
      ),
    { timeout: 5000 },
  );
  scheduled.stop();
  expect(await hasRetiredTables(store)).toBe(false);
});

it("is stopped by HostStore.close()", async () => {
  const store = await plainStore();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  store.startMaintenance();
  store.startMaintenance();
  await store.close();
  expect(warn).not.toHaveBeenCalled();
});

it("releases rows in bounded batches across passes and keeps other tables", async () => {
  const { store } = await storeWithRetiredNativeBuffers(cleanups);
  const first = await runHostDbMaintenance(store, () => false, { batchRows: 1 });
  // The 200-batch cap is far away; a 1-row batch still finishes this small fixture.
  expect(first.retiredRowsDeleted).toBe(12);
  expect(
    (await store.db.prepare("SELECT value FROM metadata WHERE key='keepme'").get())?.value,
  ).toBe("1");
});

const DAY_MS = 24 * 60 * 60 * 1000;
const marker = async (store: HostStore) =>
  await store.db.prepare("SELECT 1 AS n FROM metadata WHERE key='hostDbCompactedAt'").get();
const freeRatio = async (store: HostStore) => {
  const pragma = async (name: string) =>
    Number(Object.values((await store.db.prepare(`PRAGMA ${name}`).get()) ?? {})[0]);
  return (await pragma("freelist_count")) / (await pragma("page_count"));
};

it("vacuums a mostly free database only when idle and up long enough, at most once a day", async () => {
  const { store } = await storeWithRetiredNativeBuffers(cleanups, { chunks: 3000 });
  await store.db.exec(
    `INSERT INTO projects VALUES ('p','/tmp/p','p');
     INSERT INTO sessions (id, project_id, snapshot) VALUES ('s','p','{}');
     INSERT OR IGNORE INTO session_state (id, project_id, status, shell_running) VALUES ('s','p','running',0);
     UPDATE session_state SET status='running' WHERE id='s'`,
  );
  const at = (now: number, uptime = 3_600_000) => ({ uptimeMs: () => uptime, now: () => now });
  // Too early: rows are released, no VACUUM.
  const early = await runHostDbMaintenance(store, () => false, at(0, 1000));
  expect(early.retiredRowsDeleted).toBeGreaterThan(0);
  expect(early.vacuum).toBeUndefined();
  // Up long enough but a session is running.
  expect((await runHostDbMaintenance(store, () => false, at(0))).vacuum).toBeUndefined();
  expect(await marker(store)).toBeUndefined();
  // Idle: VACUUM runs and shrinks the file.
  await store.db.exec("UPDATE session_state SET status='idle'");
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const idle = await runHostDbMaintenance(store, () => false, at(0));
  expect(idle.vacuum).toBeDefined();
  expect(idle.vacuum!.after).toBeLessThan(idle.vacuum!.before);
  expect(await marker(store)).toBeDefined();
  expect(await freeRatio(store)).toBe(0);
  // The rewrite switches the file to incremental auto-vacuum.
  expect(await autoVacuum(store)).toBe(2);
  // Nothing free: no rewrite, however long ago the last one was.
  expect((await runHostDbMaintenance(store, () => false, at(2 * DAY_MS))).vacuum).toBeUndefined();
  // Mostly free again: waits out the day, then runs.
  await store.db.exec(
    "CREATE TABLE filler (b BLOB); INSERT INTO filler VALUES (zeroblob(3000000)); DROP TABLE filler",
  );
  expect(await freeRatio(store)).toBeGreaterThan(0.25);
  expect((await runHostDbMaintenance(store, () => false, at(DAY_MS - 1))).vacuum).toBeUndefined();
  expect((await runHostDbMaintenance(store, () => false, at(DAY_MS))).vacuum).toBeDefined();
  expect(await freeRatio(store)).toBe(0);
  info.mockRestore();
});
