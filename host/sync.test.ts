import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HostStore } from "./store";
import { syncPull, syncPush } from "./sync";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-sync-test-"));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return store;
}

describe("syncPush / syncPull", () => {
  it("enforces UTF-8 bytes for ASCII, Turkish, CJK and emoji without losing valid neighbors", async () => {
    const store = await setup();
    for (const [index, char] of ["a", "ğ", "漢", "😀"].entries()) {
      const fitting = char.repeat(Math.floor(60_000 / Buffer.byteLength(char, "utf8")));
      const tooBig = char.repeat(Math.ceil(66_000 / Buffer.byteLength(char, "utf8")));
      const result = await syncPush(store.db, [
        {
          table: "group",
          id: `ok${index}`,
          baseRev: 0,
          value: { id: `ok${index}`, name: fitting },
        },
        {
          table: "group",
          id: `bad${index}`,
          baseRev: 0,
          value: { id: `bad${index}`, name: tooBig },
        },
      ]);
      expect(result.applied.map((record) => record.id)).toEqual([`ok${index}`]);
      expect(result.invalid?.map((record) => record.id)).toEqual([`bad${index}`]);
    }
  });

  it("pages a library beyond 16 MiB and resumes around concurrent writes without skipping revisions", async () => {
    const store = await setup();
    await store.transaction(
      async () =>
        await syncPush(
          store.db,
          Array.from({ length: 300 }, (_, i) => ({
            table: "group" as const,
            id: `large${i}`,
            baseRev: 0,
            value: { id: `large${i}`, name: "x".repeat(60_000) },
          })),
        ),
    );
    let cursor = 0;
    let untilRev: number | undefined;
    const ids = new Set<string>();
    let pages = 0;
    for (;;) {
      const page = await syncPull(store.db, cursor, { untilRev });
      expect(Buffer.byteLength(JSON.stringify(page), "utf8")).toBeLessThan(1024 * 1024);
      for (const record of page.records) {
        expect(ids.has(record.id)).toBe(false);
        ids.add(record.id);
      }
      cursor = page.rev;
      untilRev = page.untilRev;
      if (++pages === 1)
        await syncPush(store.db, [
          {
            table: "group",
            id: "arrived-later",
            baseRev: 0,
            value: { id: "arrived-later", name: "New" },
          },
        ]);
      if (!page.more) break;
    }
    expect(pages).toBeGreaterThan(1);
    expect(ids.size).toBe(300);
    expect((await syncPull(store.db, cursor, {})).records.map((record) => record.id)).toEqual([
      "arrived-later",
    ]);
  });
  it("accepts a brand-new record and reports it as applied", async () => {
    const store = await setup();
    const result = await syncPush(store.db, [
      {
        table: "group",
        id: "g1",
        baseRev: 0,
        value: { id: "g1", name: "Work", collapsed: false },
      },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.applied).toEqual([{ table: "group", id: "g1", rev: result.rev }]);
  });

  it("accepts a groupOrder op", async () => {
    const store = await setup();
    const result = await syncPush(store.db, [
      {
        table: "groupOrder",
        id: "groups",
        baseRev: 0,
        value: { order: ["g1", "g2"] },
      },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.applied).toHaveLength(1);
  });

  it("accepts an appearance op and its tombstone", async () => {
    const store = await setup();
    const value = {
      projectId: "loc:env-w:g:/projects/web-portal",
      label: "ai ui-portal",
      colorIndex: 3,
    };
    const result = await syncPush(store.db, [
      {
        table: "appearance",
        id: "loc:env-w:g:/projects/web-portal",
        baseRev: 0,
        value,
      },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.applied).toEqual([
      {
        table: "appearance",
        id: "loc:env-w:g:/projects/web-portal",
        rev: result.rev,
      },
    ]);
    expect((await syncPull(store.db, 0)).records).toEqual([
      {
        table: "appearance",
        id: "loc:env-w:g:/projects/web-portal",
        rev: result.rev,
        value,
      },
    ]);
    const cleared = await syncPush(store.db, [
      {
        table: "appearance",
        id: "loc:env-w:g:/projects/web-portal",
        baseRev: result.rev,
        value: null,
      },
    ]);
    expect(cleared.applied).toHaveLength(1);
    expect((await syncPull(store.db, result.rev)).records[0].value).toBeNull();
  });

  it("rejects a push based on a stale revision and returns the current value", async () => {
    const store = await setup();
    const first = await syncPush(store.db, [
      {
        table: "group",
        id: "g1",
        baseRev: 0,
        value: { id: "g1", name: "Work", collapsed: false },
      },
    ]);
    const firstRev = first.applied[0].rev;
    // A second push based on revision 0 again, after the record moved to firstRev.
    const second = await syncPush(store.db, [
      {
        table: "group",
        id: "g1",
        baseRev: 0,
        value: { id: "g1", name: "Renamed", collapsed: false },
      },
    ]);
    expect(second.applied).toEqual([]);
    expect(second.rejected).toEqual([
      {
        table: "group",
        id: "g1",
        current: {
          table: "group",
          id: "g1",
          rev: firstRev,
          value: { id: "g1", name: "Work", collapsed: false },
        },
      },
    ]);
  });

  it("accepts a push based on the current revision, bumping it further", async () => {
    const store = await setup();
    const first = await syncPush(store.db, [
      {
        table: "group",
        id: "g1",
        baseRev: 0,
        value: { id: "g1", name: "Work", collapsed: false },
      },
    ]);
    const second = await syncPush(store.db, [
      {
        table: "group",
        id: "g1",
        baseRev: first.applied[0].rev,
        value: { id: "g1", name: "Renamed", collapsed: false },
      },
    ]);
    expect(second.rejected).toEqual([]);
    expect(second.applied[0].rev).toBeGreaterThan(first.applied[0].rev);
  });

  it("a push that would not change the value neither bumps the revision nor rewrites the row", async () => {
    const store = await setup();
    const first = await syncPush(store.db, [
      {
        table: "group",
        id: "g1",
        baseRev: 0,
        value: { id: "g1", name: "Work", lockable: true },
      },
      {
        table: "lock",
        id: "lock",
        baseRev: 0,
        value: { record: { v: 1, alg: "x" } },
      },
    ]);
    const [groupRev, lockRev] = first.applied.map((entry) => entry.rev);
    const updatedAt = async () =>
      (
        await store.db
          .prepare("SELECT updated_at FROM sync_records WHERE table_name='group' AND id='g1'")
          .get()
      )?.updated_at;
    await store.db.prepare("UPDATE sync_records SET updated_at = 1").run();

    // Same values with every object's keys in a different order.
    const again = await syncPush(store.db, [
      {
        table: "group",
        id: "g1",
        baseRev: groupRev,
        value: { lockable: true, name: "Work", id: "g1" },
      },
      {
        table: "lock",
        id: "lock",
        baseRev: lockRev,
        value: { record: { alg: "x", v: 1 } },
      },
    ]);
    expect(again.rejected).toEqual([]);
    expect(again.applied).toEqual([
      { table: "group", id: "g1", rev: groupRev },
      { table: "lock", id: "lock", rev: lockRev },
    ]);
    expect(again.rev).toBe(first.rev);
    expect(await updatedAt()).toBe(1);
    expect((await syncPull(store.db, first.rev)).records).toEqual([]);
  });

  it("redundant tombstones are free, a stale redundant push is still rejected, and a real change still bumps", async () => {
    const store = await setup();
    const missing = await syncPush(store.db, [
      { table: "assignment", id: "p1", baseRev: 0, value: null },
    ]);
    expect(missing).toEqual({
      rev: 0,
      applied: [{ table: "assignment", id: "p1", rev: 0 }],
      rejected: [],
    });
    expect((await syncPull(store.db, 0)).records).toEqual([]);

    const created = await syncPush(store.db, [
      {
        table: "assignment",
        id: "p1",
        baseRev: 0,
        value: { projectId: "p1", groupId: "g1" },
      },
    ]);
    const deleted = await syncPush(store.db, [
      { table: "assignment", id: "p1", baseRev: created.rev, value: null },
    ]);
    const deletedAgain = await syncPush(store.db, [
      { table: "assignment", id: "p1", baseRev: deleted.rev, value: null },
    ]);
    expect(deletedAgain.applied).toEqual([{ table: "assignment", id: "p1", rev: deleted.rev }]);
    expect(deletedAgain.rev).toBe(deleted.rev);

    const stale = await syncPush(store.db, [
      { table: "assignment", id: "p1", baseRev: created.rev, value: null },
    ]);
    expect(stale.applied).toEqual([]);
    expect(stale.rejected).toHaveLength(1);

    const changed = await syncPush(store.db, [
      {
        table: "railLayout",
        id: "rail",
        baseRev: 0,
        value: { order: ["a", "b"], pinned: [] },
      },
    ]);
    const reordered = await syncPush(store.db, [
      {
        table: "railLayout",
        id: "rail",
        baseRev: changed.rev,
        value: { order: ["b", "a"], pinned: [] },
      },
    ]);
    expect(reordered.applied[0].rev).toBeGreaterThan(changed.rev);
  });

  it("a tombstone (value: null) deletes the record", async () => {
    const store = await setup();
    const first = await syncPush(store.db, [
      {
        table: "group",
        id: "g1",
        baseRev: 0,
        value: { id: "g1", name: "Work", collapsed: false },
      },
    ]);
    await syncPush(store.db, [
      { table: "group", id: "g1", baseRev: first.applied[0].rev, value: null },
    ]);
    const pulled = await syncPull(store.db, 0);
    expect(pulled.records.at(-1)).toMatchObject({
      table: "group",
      id: "g1",
      value: null,
    });
  });

  it("syncPull returns only records newer than the given revision, in order", async () => {
    const store = await setup();
    await syncPush(store.db, [
      {
        table: "group",
        id: "g1",
        baseRev: 0,
        value: { id: "g1", name: "A", collapsed: false },
      },
    ]);
    const after = (await syncPull(store.db, 0)).rev;
    await syncPush(store.db, [
      {
        table: "group",
        id: "g2",
        baseRev: 0,
        value: { id: "g2", name: "B", collapsed: false },
      },
    ]);
    const pulled = await syncPull(store.db, after);
    expect(pulled.records).toHaveLength(1);
    expect(pulled.records[0].id).toBe("g2");
  });

  it("two different records can be pushed in one call independently of each other", async () => {
    const store = await setup();
    const result = await syncPush(store.db, [
      {
        table: "group",
        id: "g1",
        baseRev: 0,
        value: { id: "g1", name: "A", collapsed: false },
      },
      {
        table: "assignment",
        id: "p1",
        baseRev: 0,
        value: { projectId: "p1", groupId: "g1" },
      },
    ]);
    expect(result.applied).toHaveLength(2);
  });

  it("skips malformed ops without throwing while valid ops in the batch still apply", async () => {
    const store = await setup();
    const group = { id: "g1", name: "A", collapsed: false };
    const ops = [
      null,
      { table: "nope", id: "x", baseRev: 0, value: null },
      { table: "group", id: "", baseRev: 0, value: null },
      { table: "group", id: "x".repeat(201), baseRev: 0, value: null },
      { table: "group", id: "g", baseRev: -1, value: null },
      { table: "group", id: "g", baseRev: 1.5, value: null },
      { table: "group", id: "g", baseRev: 0, value: [] },
      { table: "group", id: "g", baseRev: 0, value: "str" },
      {
        table: "group",
        id: "g",
        baseRev: 0,
        value: { big: "x".repeat(70 * 1024) },
      },
      { table: "group", id: "g1", baseRev: 0, value: group },
    ] as unknown as Parameters<typeof syncPush>[1];
    const result = await syncPush(store.db, ops);
    expect(result.rejected).toEqual([]);
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0].id).toBe("g1");
  });

  it("a corrupt stored row does not break pull and can be overwritten by a push", async () => {
    const store = await setup();
    await store.db
      .prepare(
        "INSERT INTO sync_records (table_name, id, value, rev, updated_at) VALUES ('group', 'bad', '{bad', 7, 0)",
      )
      .run();
    await syncPush(store.db, [
      {
        table: "group",
        id: "g1",
        baseRev: 0,
        value: { id: "g1", name: "A", collapsed: false },
      },
    ]);
    const pulled = await syncPull(store.db, 0);
    expect(pulled.records.map((record) => record.id)).toEqual(["g1"]);
    const result = await syncPush(store.db, [
      {
        table: "group",
        id: "bad",
        baseRev: 7,
        value: { id: "bad", name: "Fixed", collapsed: false },
      },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.applied).toHaveLength(1);
    expect((await syncPull(store.db, 0)).records.map((record) => record.id)).toContain("bad");
  });
});
