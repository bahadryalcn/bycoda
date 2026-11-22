import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../store";
import { WorkStorage } from "./storage";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

it("lists the pending and reserved queue beside the writer", async () => {
  const directory = mkdtempSync(join(tmpdir(), "work-storage-"));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const storage = new WorkStorage(store, Date.now);
  await storage.ready;
  const read = vi.spyOn(store.db, "readScope");
  const write = vi.spyOn(store.db, "storeScope");
  expect(await storage.listPending()).toEqual([]);
  expect(await storage.listReserved()).toEqual([]);
  expect(read).toHaveBeenCalledTimes(2);
  expect(write).not.toHaveBeenCalled();
  // Inside a writer scope the same read runs on the writer.
  expect(await store.db.storeScope(() => storage.listPending())).toEqual([]);
});
