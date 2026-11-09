import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { HostStore } from "../store";
import { capEventsGlobally, eventBudget, trimSessionEvents } from "./event-retention";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function storeWithEvents(sessions: Record<string, { rows: number; bytes: number }>) {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-event-retention-"));
  const store = new HostStore(join(directory, "host.db"));
  await store.ready;
  cleanups.push(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  // Event rows only; the replay table's session foreign key is not under test here.
  await store.db.exec("PRAGMA foreign_keys=OFF");
  for (const [id, { rows, bytes }] of Object.entries(sessions))
    await store.db.runMany(
      "INSERT INTO events VALUES (?, ?, ?)",
      Array.from({ length: rows }, (_, index) => [id, index + 1, "x".repeat(bytes)]),
    );
  return store;
}
const revisions = async (store: HostStore, id: string) =>
  (
    await store.db
      .prepare("SELECT revision FROM events WHERE session_id=? ORDER BY revision")
      .all(id)
  ).map((row) => Number(row.revision));
const checkpoint =
  (store: HostStore) =>
  <T>(work: () => Promise<T>) =>
    store.transaction(work, "checkpoint");

it("computes a water-filling budget that only cuts the largest sessions", () => {
  expect(eventBudget([10, 20, 30], 60)).toBeNull();
  expect(eventBudget([100, 10, 10], 60)).toBe(40);
  expect(eventBudget([100, 90, 10], 110)).toBe(50);
  expect(eventBudget([5, 5], 0)).toBe(0);
});

it("keeps the newest suffix and the requested revision floor", async () => {
  const store = await storeWithEvents({ s: { rows: 10, bytes: 100 } });
  expect(await trimSessionEvents(store.db, "s", 350)).toBe(7);
  expect(await revisions(store, "s")).toEqual([8, 9, 10]);
  // A zero budget still keeps the newest revision (per-session cap semantics)...
  expect(await trimSessionEvents(store.db, "s", 0)).toBe(2);
  expect(await revisions(store, "s")).toEqual([10]);
  const floor = await storeWithEvents({ t: { rows: 60, bytes: 10 } });
  // ...and the global cap keeps the newest 50.
  expect(await trimSessionEvents(floor.db, "t", 0, 50)).toBe(10);
  expect((await revisions(floor, "t"))[0]).toBe(11);
  expect(await trimSessionEvents(floor.db, "t", 0, 50)).toBe(0);
});

it("caps total event bytes by trimming the largest sessions' oldest revisions", async () => {
  const store = await storeWithEvents({
    big: { rows: 200, bytes: 1000 },
    mid: { rows: 100, bytes: 1000 },
    small: { rows: 20, bytes: 1000 },
  });
  const result = await capEventsGlobally(store.db, checkpoint(store), {
    cap: 150_000,
    keep: 50,
  });
  expect(result.totalBytes).toBe(320_000);
  // Budget L=65_000: big and mid each keep their newest 65 revisions; small is untouched.
  expect(result).toMatchObject({ deletedRows: 135 + 35, sessions: 2 });
  expect(await revisions(store, "big")).toEqual(Array.from({ length: 65 }, (_, i) => 136 + i));
  expect((await revisions(store, "mid")).length).toBe(65);
  expect((await revisions(store, "small")).length).toBe(20);
  expect(await capEventsGlobally(store.db, checkpoint(store), { cap: 150_000 })).toMatchObject({
    totalBytes: 150_000,
    deletedRows: 0,
  });
});

it("lets the revision floor win over the cap", async () => {
  const store = await storeWithEvents({ a: { rows: 80, bytes: 1000 } });
  const result = await capEventsGlobally(store.db, checkpoint(store), { cap: 1000, keep: 50 });
  expect(result.deletedRows).toBe(30);
  expect((await revisions(store, "a")).length).toBe(50);
});
