import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "../store";
import {
  NATIVE_BUFFER_LEGACY_TABLES,
  releaseNativeBufferLegacyBatches,
} from "../native-buffer/native-buffer-legacy-release";
import { createNativeBufferPersistenceStore } from "../native-buffer/native-buffer-persistence-store";
import {
  dryRunHostDbMaintenance,
  runHostDbMaintenance,
  scheduleHostDbMaintenance,
} from "./host-db-maintenance";

const currentKey = `native-activity/buffers/${"d".repeat(64)}.json`;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
});

/** The mutable head moves from A to B without a certificate, so A is the one orphan. */
async function storeWithOrphan(prepare?: (path: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-db-maintenance-"));
  const path = join(directory, "host.db");
  prepare?.(path);
  const store = new HostStore(path);
  cleanups.push(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const device = await store.issueDevice("maintenance fixture");
  const authorize = async () => {
    if (!(await store.authenticated(device.token))) throw new Error("revoked");
  };
  const persistence = createNativeBufferPersistenceStore(store);
  for (const bytes of [Buffer.alloc(200_000, 1), Buffer.from("B")])
    await persistence.complete({
      writes: [{ key: currentKey, bytes, immutable: false }],
      certificates: [],
      authorize,
    });
  return { store, persistence };
}
const autoVacuum = async (store: HostStore) =>
  Number(Object.values((await store.db.prepare("PRAGMA auto_vacuum").get()) ?? {})[0]);

it("collects, checkpoints the WAL and leaves auto_vacuum of a default database alone", async () => {
  const { store, persistence } = await storeWithOrphan();
  expect(await dryRunHostDbMaintenance(store)).toMatchObject({
    orphanBlobs: 1,
    orphanBlobBytes: 200_000,
    eventBytesOverCap: 0,
  });
  const result = await runHostDbMaintenance(store);
  expect(result.blobs).toMatchObject({ deletedBlobs: 1, deletedBytes: 200_000 });
  expect(result.events.deletedRows).toBe(0);
  expect(result.incrementalVacuum).toBe(false);
  expect(result.checkpoint).toMatchObject({ busy: 0 });
  expect(await autoVacuum(store)).toBe(0);
  expect(await persistence.read(currentKey, 16)).toEqual(Buffer.from("B"));
  // Nothing left to delete: no checkpoint either.
  expect((await runHostDbMaintenance(store)).checkpoint).toBeUndefined();
});

it("runs incremental_vacuum only when the database already uses it", async () => {
  const { store } = await storeWithOrphan((path) => {
    const db = new DatabaseSync(path);
    db.exec("PRAGMA auto_vacuum=INCREMENTAL; CREATE TABLE fixture_marker (id INTEGER)");
    db.close();
  });
  expect(await autoVacuum(store)).toBe(2);
  const result = await runHostDbMaintenance(store);
  expect(result).toMatchObject({ incrementalVacuum: true, blobs: { deletedBlobs: 1 } });
  expect(await autoVacuum(store)).toBe(2);
  expect(
    Number(Object.values((await store.db.prepare("PRAGMA freelist_count").get()) ?? {})[0]),
  ).toBe(0);
});

it("runs on its timer off the request path and stops cleanly", async () => {
  const { store } = await storeWithOrphan();
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const scheduled = scheduleHostDbMaintenance(store, { first: 1, every: 60_000 });
  await vi.waitFor(() => expect(info).toHaveBeenCalledOnce(), { timeout: 5000 });
  expect(String(info.mock.calls[0][0])).toMatch(/removed 1 native buffer blobs/);
  scheduled.stop();
  expect((await dryRunHostDbMaintenance(store)).orphanBlobs).toBe(0);
});

it("is stopped by HostStore.close()", async () => {
  const { store } = await storeWithOrphan();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  store.startMaintenance();
  store.startMaintenance();
  await store.close();
  expect(warn).not.toHaveBeenCalled();
});

it("runs the native buffer git gc after the retention steps and survives its failure", async () => {
  const { store } = await storeWithOrphan();
  const gc = vi.fn(async () => {
    throw new Error("gc failed");
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const result = await runHostDbMaintenance(store, () => false, { gc });
  expect(gc).toHaveBeenCalledTimes(1);
  expect(result.blobs.deletedBlobs).toBe(1);
  expect(String(warn.mock.calls[0][0])).toMatch(/git gc failed/);
});

const bigKey = `native-activity/buffers/${"e".repeat(64)}.json`;
const rowCount = async (store: HostStore, table: string) =>
  Number((await store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get())?.n);
const marker = async (store: HostStore) =>
  await store.db.prepare("SELECT 1 AS n FROM metadata WHERE key='nativeBufferLegacyVacuum'").get();

it("releases legacy rows in bounded batches across passes and keeps clocks and other tables", async () => {
  const { store } = await storeWithOrphan();
  await store.db.exec(
    "INSERT INTO native_buffer_clocks VALUES ('r','{}'); INSERT INTO metadata VALUES ('keepme','1')",
  );
  let total = 0;
  for (const table of NATIVE_BUFFER_LEGACY_TABLES) total += await rowCount(store, table);
  const first = await releaseNativeBufferLegacyBatches(store, { batchRows: 1, maxBatches: 2 });
  expect(first).toEqual({ deletedRows: 2, done: false });
  expect(await rowCount(store, "native_buffer_blob_chunks")).toBeGreaterThan(0);
  const second = await releaseNativeBufferLegacyBatches(store, { batchRows: 1 });
  expect(second.done).toBe(true);
  expect(first.deletedRows + second.deletedRows).toBe(total);
  for (const table of NATIVE_BUFFER_LEGACY_TABLES) expect(await rowCount(store, table)).toBe(0);
  expect(await rowCount(store, "native_buffer_clocks")).toBe(1);
  expect(await rowCount(store, "metadata")).toBeGreaterThan(1);
});

it("leaves the SQL clock store usable after the legacy release", async () => {
  const { store } = await storeWithOrphan();
  expect((await releaseNativeBufferLegacyBatches(store)).done).toBe(true);
  const device = await store.issueDevice("after release");
  // A clock for a new native report still initializes in the SQL store after the
  // released artifacts are gone; a stale directory marker must not fence it.
  await expect(
    createNativeBufferPersistenceStore(store).complete({
      writes: [{ key: currentKey, bytes: Buffer.from("C"), immutable: false }],
      certificates: [],
      authorize: async () => {
        if (!(await store.authenticated(device.token))) throw new Error("revoked");
      },
    }),
  ).resolves.not.toThrow();
});

it("does not touch legacy rows without a git store", async () => {
  const { store } = await storeWithOrphan();
  const before = await rowCount(store, "native_buffer_artifacts");
  await runHostDbMaintenance(store);
  expect(await rowCount(store, "native_buffer_artifacts")).toBe(before);
});

it("vacuums once after the release, only when idle, mostly free and up long enough", async () => {
  const { store, persistence } = await storeWithOrphan();
  const device = await store.issueDevice("vacuum fixture");
  await persistence.complete({
    writes: [{ key: bigKey, bytes: Buffer.alloc(3_000_000, 7), immutable: false }],
    certificates: [],
    authorize: async () => {
      if (!(await store.authenticated(device.token))) throw new Error("revoked");
    },
  });
  const git = { gc: vi.fn(async () => undefined) };
  await store.db.exec(
    `INSERT INTO projects VALUES ('p','/tmp/p','p');
     INSERT INTO sessions (id, project_id, snapshot) VALUES ('s','p','{}');
     INSERT OR IGNORE INTO session_state (id, project_id, status, shell_running) VALUES ('s','p','running',0);
     UPDATE session_state SET status='running' WHERE id='s'`,
  );
  // Too early: rows are released, no VACUUM.
  const early = await runHostDbMaintenance(store, () => false, git, { uptimeMs: () => 1000 });
  expect(early.legacyRowsDeleted).toBeGreaterThan(0);
  expect(early.legacyVacuum).toBeUndefined();
  // Up long enough but a session is running.
  const busy = await runHostDbMaintenance(store, () => false, git, { uptimeMs: () => 3_600_000 });
  expect(busy.legacyVacuum).toBeUndefined();
  expect(await marker(store)).toBeUndefined();
  // Idle: VACUUM runs and shrinks the file.
  await store.db.exec("UPDATE session_state SET status='idle'");
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const idle = await runHostDbMaintenance(store, () => false, git, { uptimeMs: () => 3_600_000 });
  expect(idle.legacyVacuum).toBeDefined();
  expect(idle.legacyVacuum!.after).toBeLessThan(idle.legacyVacuum!.before);
  expect(await marker(store)).toBeDefined();
  info.mockRestore();
  // Never repeats.
  const again = await runHostDbMaintenance(store, () => false, git, { uptimeMs: () => 3_600_000 });
  expect(again.legacyVacuum).toBeUndefined();
});
