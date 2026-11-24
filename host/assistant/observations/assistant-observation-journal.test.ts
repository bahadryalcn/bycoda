import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "../../store";
import { AssistantObservationJournal } from "./assistant-observation-journal";
import type { SQLInputValue } from "node:sqlite";

/** Narrows a journal read to its `ok` page. */
const ok = <T extends { status: string }>(page: T) => page as Extract<T, { status: "ok" }>;

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
it("keeps a Host closing during setup from becoming an unhandled rejection", async () => {
  const unhandled = vi.fn();
  process.on("unhandledRejection", unhandled);
  try {
    const journal = new AssistantObservationJournal({
      ready: Promise.resolve(),
      db: { exec: () => Promise.reject(new Error("closing")) },
    } as unknown as HostStore);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(unhandled).not.toHaveBeenCalled();
    await expect(journal.ready).rejects.toThrow("closing");
  } finally {
    process.off("unhandledRejection", unhandled);
  }
});

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "assistant-observations-"));
  const store = new HostStore(join(dir, "host.db"));
  const journal = new AssistantObservationJournal(store);
  await journal.ready;
  cleanup.push(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, journal };
}
const event = {
  source: "task" as const,
  sourceId: "task-a",
  sourceRevision: "1",
  change: "updated" as const,
  projectIds: ["project-a"],
  occurredAt: 1,
};
const scope = { projectId: "project-a" };
it("keeps the Chief task cursor independent from other source types", async () => {
  const { store, journal } = await fixture();
  await store.transaction(async () => {
    await journal.append({
      ...event,
      source: "social",
      sourceId: "private-social",
      accountId: "account",
    });
    await journal.append({ ...event, sourceId: "task-visible" });
  });
  const page = await journal.read(
    "chief:task",
    scope,
    async () => true,
    async (item) => item.source === "task",
    () => true,
    3,
    3000,
    "task",
  );
  expect(page.events.map((item) => item.sourceId)).toEqual(["task-visible"]);
  await journal.acknowledge(
    "chief:task",
    scope,
    ok(page).nextCursor,
    async () => true,
    () => true,
  );
  expect(
    (
      await journal.read(
        "other-consumer",
        scope,
        async () => true,
        async () => true,
        () => true,
      )
    ).events,
  ).toHaveLength(2);
});
it("commits source and observation together; replay, ack and dedupe use durable identity", async () => {
  const { store, journal } = await fixture();
  await expect(
    store.transaction(async () => {
      await journal.append(event);
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  expect(
    (
      await journal.read(
        "chief",
        scope,
        async () => true,
        async () => true,
        () => true,
      )
    ).events,
  ).toEqual([]);
  const first = await store.transaction(() => journal.append(event));
  expect(await store.transaction(() => journal.append(event))).toEqual(first);
  await expect(
    store.transaction(() => journal.append({ ...event, change: "deleted" })),
  ).rejects.toThrow("different metadata");
  const page = await journal.read(
    "chief",
    scope,
    async () => true,
    async () => true,
    () => true,
  );
  expect(page.events).toHaveLength(1);
  expect(
    (
      await journal.read(
        "chief",
        scope,
        async () => true,
        async () => true,
        () => true,
      )
    ).events,
  ).toEqual(page.events);
  await expect(
    journal.acknowledge(
      "chief",
      scope,
      ok(page).nextCursor + 1,
      async () => true,
      () => true,
    ),
  ).rejects.toThrow("not offered");
  await journal.acknowledge(
    "chief",
    scope,
    ok(page).nextCursor,
    async () => true,
    () => true,
  );
  expect(
    (
      await journal.read(
        "chief",
        scope,
        async () => true,
        async () => true,
        () => true,
      )
    ).events,
  ).toEqual([]);
});
it("fails closed on revoked scope and requires resnapshot after retention gap", async () => {
  const { store, journal } = await fixture();
  const first = await store.transaction(() => journal.append(event));
  await expect(
    journal.read(
      "other",
      scope,
      async () => true,
      async () => false,
      () => true,
    ),
  ).rejects.toThrow("revoked");
  await journal.pruneBefore(first.sequence);
  expect(
    await journal.read(
      "other",
      scope,
      async () => true,
      async () => true,
      () => true,
    ),
  ).toMatchObject({ status: "gap", retainedAfter: first.sequence });
  await expect(
    journal.resumeAfterResnapshot(
      "other",
      scope,
      first.sequence,
      async () => false,
      () => true,
    ),
  ).rejects.toThrow("revoked");
  await journal.resumeAfterResnapshot(
    "other",
    scope,
    first.sequence,
    async () => true,
    () => true,
  );
  expect(
    (
      await journal.read(
        "other",
        scope,
        async () => true,
        async () => true,
        () => true,
      )
    ).status,
  ).toBe("ok");
});

it("survives restart, concurrent producers and separates Hosts and scopes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "assistant-observations-restart-"));
  const path = join(dir, "host.db");
  let store = new HostStore(path);
  let journal = new AssistantObservationJournal(store);
  await journal.ready;
  await Promise.all(
    ["a", "b", "c"].map((id) =>
      store.transaction(() => journal.append({ ...event, sourceId: id })),
    ),
  );
  await store.transaction(() =>
    journal.append({ ...event, sourceId: "private", projectIds: [], accountId: "account-a" }),
  );
  const before = await journal.read(
    "observer",
    scope,
    async () => true,
    async () => true,
    () => true,
    2,
  );
  expect(before.events).toHaveLength(2);
  await journal.acknowledge(
    "observer",
    scope,
    ok(before).nextCursor,
    async () => true,
    () => true,
  );
  const host = store.environmentId;
  await store.close();
  store = new HostStore(path);
  journal = new AssistantObservationJournal(store);
  await journal.ready;
  const after = await journal.read(
    "observer",
    scope,
    async () => true,
    async () => true,
    () => true,
  );
  expect(after.events).toHaveLength(1);
  expect(after.events[0].environmentId).toBe(host);
  expect(
    (
      await journal.read(
        "observer",
        { accountId: "account-b" },
        async () => true,
        async () => true,
        () => true,
      )
    ).events,
  ).toEqual([]);
  expect(
    (
      await journal.read(
        "observer",
        { accountId: "account-a" },
        async () => true,
        async () => true,
        () => true,
      )
    ).events,
  ).toHaveLength(1);
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

it("rechecks captured authorization after async source validation before offering a cursor", async () => {
  const { store, journal } = await fixture();
  await store.transaction(() => journal.append(event));
  let current = true;
  await expect(
    journal.read(
      "chief",
      scope,
      async () => true,
      async () => {
        current = false;
        return true;
      },
      () => current,
    ),
  ).rejects.toThrow("revoked");
  current = true;
  const page = await journal.read(
    "chief",
    scope,
    async () => true,
    async () => true,
    () => current,
  );
  expect(page.events).toHaveLength(1);
  current = false;
  await expect(
    journal.acknowledge(
      "chief",
      scope,
      ok(page).nextCursor,
      async () => true,
      () => current,
    ),
  ).rejects.toThrow("revoked");
});

it("expires retained records and reports a gap before any stale replay", async () => {
  const { store, journal } = await fixture();
  const first = await store.transaction(() => journal.append(event));
  await store.db
    .prepare("UPDATE assistant_observation_events SET expires_at=? WHERE sequence=?")
    .run(1, first.sequence);
  const page = await journal.read(
    "late",
    scope,
    async () => true,
    async () => true,
    () => true,
  );
  expect(page).toMatchObject({ status: "gap", retainedAfter: first.sequence, events: [] });
  expect(
    (await store.db.prepare("SELECT COUNT(*) AS n FROM assistant_observation_events").get())?.n,
  ).toBe(0);
});

it("indexes the expiry lookup used by retention and keeps retained rows when upgrading", async () => {
  const { store, journal } = await fixture();
  const kept = await store.transaction(() => journal.append(event));
  const plan = async (sql: string, ...args: unknown[]) =>
    (await store.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(args as SQLInputValue[])))
      .map((row) => String(row.detail))
      .join("\n");
  // `+` keeps SQLite's rowid min/max shortcut from bypassing the index, as in the retention SQL.
  const expiryLookup =
    "SELECT MAX(+sequence) FROM assistant_observation_events WHERE expires_at<=?";
  expect(await plan(expiryLookup, Date.now())).toContain("assistant_observation_expiry");

  await store.db.exec("DROP INDEX assistant_observation_expiry");
  const upgraded = new AssistantObservationJournal(store);
  await upgraded.ready;
  expect(await plan(expiryLookup, Date.now())).toContain("assistant_observation_expiry");
  expect(
    (await store.db.prepare("SELECT sequence FROM assistant_observation_events").all()).map((row) =>
      Number(row.sequence),
    ),
  ).toEqual([kept.sequence]);
  // The retention trigger uses the index-friendly form, also when reopening an older database.
  expect(
    (
      await store.db
        .prepare("SELECT sql FROM sqlite_master WHERE name='assistant_observation_retention'")
        .get()
    )?.sql,
  ).toContain("MAX(+sequence)");
});
