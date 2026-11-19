import { afterEach, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "../../store";
import {
  CHIEF_READ_RECEIPT_ROWS,
  VOICE_VERSION_RETENTION_MS,
  pruneChiefReadReceipts,
  pruneVoiceContextVersions,
  purgeJobSessionReceipts,
} from "./assistant-receipt-retention";

const stores: HostStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
});
async function fixture() {
  const store = new HostStore(join(mkdtempSync(join(tmpdir(), "bycoda-receipt-retention-")), "h.db"));
  stores.push(store);
  await store.ready;
  return store;
}
const NOW = 1_000 * VOICE_VERSION_RETENTION_MS;
const OLD = NOW - VOICE_VERSION_RETENTION_MS - 1;

async function voiceFixture() {
  const store = await fixture();
  await store.db.exec(
    `CREATE TABLE assistant_voice_contexts(id TEXT PRIMARY KEY,value TEXT NOT NULL);
     CREATE TABLE assistant_voice_context_versions(context_id TEXT NOT NULL,version INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(context_id,version));
     CREATE TABLE assistant_runtime(id TEXT PRIMARY KEY,value TEXT NOT NULL);
     CREATE TABLE assistant_owner_questions(id TEXT PRIMARY KEY,source TEXT NOT NULL);`,
  );
  const context = async (id: string, head: number, updatedAt: number) => {
    await store.db
      .prepare("INSERT INTO assistant_voice_contexts(id,value) VALUES(?,?)")
      .run(id, JSON.stringify({ id, version: head, updatedAt }));
    for (let version = 1; version <= head; version++)
      await store.db
        .prepare("INSERT INTO assistant_voice_context_versions(context_id,version,value) VALUES(?,?,?)")
        .run(id, version, JSON.stringify({ id, version, updatedAt }));
  };
  const versions = async (id: string) =>
    (
      await store.db
        .prepare("SELECT version FROM assistant_voice_context_versions WHERE context_id=? ORDER BY version")
        .all(id)
    ).map((row) => Number(row.version));
  return { store, context, versions };
}

it("keeps heads, referenced and recent voice versions and drops only superseded unreferenced ones", async () => {
  const { store, context, versions } = await voiceFixture();
  await context("plain", 3, OLD);
  await context("proved", 3, OLD);
  await context("asked", 2, OLD);
  await context("asked-pinned", 3, OLD);
  await context("recent", 3, NOW);
  await store.db
    .prepare("INSERT INTO assistant_runtime(id,value) VALUES(?,?)")
    .run(
      "messageScopeVoice:m1",
      JSON.stringify({ value: { contextId: "proved", version: 1, threadId: "t" } }),
    );
  await store.db
    .prepare("INSERT INTO assistant_owner_questions(id,source) VALUES(?,?)")
    .run("q1", JSON.stringify({ causalContextId: "asked" }));
  await store.db
    .prepare("INSERT INTO assistant_owner_questions(id,source) VALUES(?,?)")
    .run("q2", JSON.stringify({ causalContextId: "asked-pinned", causalContextVersion: 2 }));

  await pruneVoiceContextVersions(store, NOW);

  expect(await versions("plain")).toEqual([3]);
  expect(await versions("proved")).toEqual([1, 3]);
  expect(await versions("asked")).toEqual([1, 2]);
  expect(await versions("asked-pinned")).toEqual([2, 3]);
  expect(await versions("recent")).toEqual([1, 2, 3]);
});

it("does not prune voice versions when a reference cannot be read", async () => {
  const { store, context, versions } = await voiceFixture();
  await context("plain", 3, OLD);
  await store.db
    .prepare("INSERT INTO assistant_runtime(id,value) VALUES(?,?)")
    .run("messageScopeVoice:m1", "not json");

  expect(await pruneVoiceContextVersions(store, NOW)).toBe(0);
  expect(await versions("plain")).toEqual([1, 2, 3]);
});

it("keeps the latest read, the newest receipt rows and the pending operation's rows", async () => {
  const store = await fixture();
  await store.db.exec("CREATE TABLE assistant_chief_reads(id TEXT PRIMARY KEY,value TEXT NOT NULL);");
  const put = (id: string) =>
    store.db.prepare("INSERT INTO assistant_chief_reads(id,value) VALUES(?,?)").run(id, "{}");
  await put("latest");
  await put("pending:batch");
  await put("pending:0");
  for (let index = 0; index < CHIEF_READ_RECEIPT_ROWS + 5; index++) await put(`old-${index}:0`);

  await pruneChiefReadReceipts(store, ["pending"]);

  const ids = (await store.db.prepare("SELECT id FROM assistant_chief_reads").all()).map((row) =>
    String(row.id),
  );
  expect(ids).toContain("latest");
  expect(ids).toContain("pending:batch");
  expect(ids).toContain("pending:0");
  expect(ids).not.toContain("old-0:0");
  expect(ids).not.toContain("old-4:0");
  expect(ids).toContain(`old-${CHIEF_READ_RECEIPT_ROWS + 4}:0`);
});

it("purges only the purged job's session receipts and nudge counters", async () => {
  const store = await fixture();
  await store.db.exec(
    `CREATE TABLE assistant_session_receipts(id TEXT PRIMARY KEY,value TEXT NOT NULL);
     CREATE TABLE assistant_session_counts(id TEXT PRIMARY KEY,nudges INTEGER NOT NULL);`,
  );
  for (const id of ["job-1:s:r", "job-10:s:r", "manual:job-1:s:r"])
    await store.db.prepare("INSERT INTO assistant_session_receipts(id,value) VALUES(?,?)").run(id, "{}");
  for (const id of ["job-1:s", "job-10:s"])
    await store.db.prepare("INSERT INTO assistant_session_counts(id,nudges) VALUES(?,1)").run(id);

  await purgeJobSessionReceipts(store, "job-1");

  expect(
    (await store.db.prepare("SELECT id FROM assistant_session_receipts ORDER BY id").all()).map(
      (row) => row.id,
    ),
  ).toEqual(["job-10:s:r", "manual:job-1:s:r"]);
  expect(
    (await store.db.prepare("SELECT id FROM assistant_session_counts").all()).map((row) => row.id),
  ).toEqual(["job-10:s"]);
});
