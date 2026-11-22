import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  RETIRED_NATIVE_BUFFER_TABLES,
  releaseRetiredNativeBufferTables,
  removeRetiredNativeBufferFiles,
} from "./retired-native-buffer-cleanup";
import {
  RETIRED_NATIVE_BUFFER_TABLE_NAMES,
  retiredNativeBufferDirectories,
  storeWithRetiredNativeBuffers,
  tableNames,
} from "./retired-native-buffer.test-support";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
});

it("lists every table the old Host created", () => {
  expect([...RETIRED_NATIVE_BUFFER_TABLES].sort()).toEqual(
    [...RETIRED_NATIVE_BUFFER_TABLE_NAMES].sort(),
  );
});

it("drops the retired tables in bounded batches across passes and keeps other tables", async () => {
  const { store } = await storeWithRetiredNativeBuffers(cleanups);
  const first = await releaseRetiredNativeBufferTables(store, { batchRows: 2, maxBatches: 2 });
  expect(first).toEqual({ deletedRows: 4, done: false });
  // Large blob chunks are not finished yet, so that table still exists.
  expect(await tableNames(store)).toContain("native_buffer_blob_chunks");
  const second = await releaseRetiredNativeBufferTables(store, { batchRows: 2 });
  expect(second.done).toBe(true);
  expect(first.deletedRows + second.deletedRows).toBe(5 + 7);
  const names = await tableNames(store);
  expect(names.filter((name) => name.startsWith("native_buffer_"))).toEqual([]);
  expect(names).toContain("metadata");
  expect(
    (await store.db.prepare("SELECT value FROM metadata WHERE key='keepme'").get())?.value,
  ).toBe("1");
});

it("is idempotent", async () => {
  const { store } = await storeWithRetiredNativeBuffers(cleanups);
  expect((await releaseRetiredNativeBufferTables(store)).done).toBe(true);
  const before = await tableNames(store);
  expect(await releaseRetiredNativeBufferTables(store)).toEqual({ deletedRows: 0, done: true });
  expect(await tableNames(store)).toEqual(before);
});

it("stops between batches when asked", async () => {
  const { store } = await storeWithRetiredNativeBuffers(cleanups);
  expect(await releaseRetiredNativeBufferTables(store, { stopped: () => true })).toEqual({
    deletedRows: 0,
    done: false,
  });
  expect(await tableNames(store)).toContain("native_buffer_clocks");
});

it("removes exactly the retired directories and nothing else, repeatedly", async () => {
  const { dataDir } = await storeWithRetiredNativeBuffers(cleanups);
  const managedRoot = retiredNativeBufferDirectories(dataDir);
  expect(await removeRetiredNativeBufferFiles(dataDir, managedRoot)).toBe(3);
  expect(existsSync(join(managedRoot, "native-activity", "buffers"))).toBe(false);
  expect(existsSync(join(managedRoot, "native-activity", "buffer-history"))).toBe(false);
  expect(existsSync(join(dataDir, "native-buffer-store.git"))).toBe(false);
  expect(existsSync(join(managedRoot, "native-activity", "processes", "file.json"))).toBe(true);
  expect(existsSync(join(managedRoot, "recovery", "file.json"))).toBe(true);
  expect(existsSync(join(dataDir, "attachments", "file.json"))).toBe(true);
  expect(existsSync(join(dataDir, "host.db"))).toBe(true);
  // Second run: nothing to remove, nothing breaks.
  expect(await removeRetiredNativeBufferFiles(dataDir, managedRoot)).toBe(3);
  expect(existsSync(join(managedRoot, "native-activity", "processes", "file.json"))).toBe(true);
});
