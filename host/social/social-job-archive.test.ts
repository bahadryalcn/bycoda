import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../store";
import { SocialJobArchive } from "./social-job-archive";
import { SocialMediaCustody } from "./media-custody";
import { randomUUID } from "node:crypto";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "social-history-"));
  const store = new HostStore(join(dir, "host.db"));
  await store.ready;
  await store.db.exec(
    "CREATE TABLE social_jobs(id TEXT PRIMARY KEY,dedupe_key TEXT NOT NULL UNIQUE,account_id TEXT NOT NULL,status TEXT NOT NULL,scheduled_at INTEGER NOT NULL,value TEXT NOT NULL)",
  );
  const archive = new SocialJobArchive(store);
  await archive.initialize();
  await store.db
    .exec(`CREATE TABLE social_records(kind TEXT,id TEXT,value TEXT,PRIMARY KEY(kind,id));
    CREATE TABLE social_programs(id TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE social_occurrences(id TEXT PRIMARY KEY,value TEXT);`);
  const custody = new SocialMediaCustody(store, dir);
  await custody.initialize();
  cleanup.push(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const insert = async (id: string, status: string, extra: Record<string, unknown> = {}) => {
    const job = { id, status, dedupeKey: `dedupe-${id}`, accountId: "a", scheduledAt: 1, ...extra };
    await store.db
      .prepare("INSERT INTO social_jobs VALUES (?,?,?,?,?,?)")
      .run(id, job.dedupeKey, job.accountId, status, 1, JSON.stringify(job));
    return job;
  };
  return { store, archive, insert, custody };
}

it("archives settled work without losing history, exact IDs, or dedupe evidence", async () => {
  const f = await fixture();
  const complete = await f.insert("done", "succeeded", { platformId: "post" });
  await f.insert("cancel", "cancelled");
  await f.insert("unknown", "review", { dispatchedAt: 5 });
  await f.insert("pending", "queued");
  await f.insert("uncertain-failure", "failed", { dispatchedAt: 5 });
  expect(
    await f.archive.archive(["done", "cancel", "unknown", "pending", "uncertain-failure"]),
  ).toEqual({
    archived: ["done", "cancel"],
    retained: ["unknown", "pending", "uncertain-failure"],
  });
  expect(
    JSON.parse(
      String(
        (await f.store.db.prepare("SELECT value FROM social_jobs_all WHERE id=?").get("done"))!
          .value,
      ),
    ),
  ).toEqual(complete);
  expect(
    await f.store.db
      .prepare("SELECT id FROM social_jobs_all WHERE dedupe_key=?")
      .get("dedupe-done"),
  ).toEqual({ id: "done" });
  expect(await f.store.db.prepare("SELECT id FROM social_jobs WHERE id=?").get("unknown")).toEqual({
    id: "unknown",
  });
});

it("bounds the hot settled set while retaining cold pages and all unknown outcomes", async () => {
  const f = await fixture();
  await f.store.transaction(async () => {
    for (let i = 0; i < 1002; i++)
      await f.insert(`done-${i}`, "succeeded", { platformId: `post-${i}` });
    await f.insert("unknown", "review", { dispatchedAt: 1 });
  });
  await f.archive.compact();
  expect(
    Number(
      (await f.store.db
        .prepare("SELECT count(*) AS n FROM social_jobs WHERE status='succeeded'")
        .get())!.n,
    ),
  ).toBe(1000);
  expect(
    Number((await f.store.db.prepare("SELECT count(*) AS n FROM social_jobs_all").get())!.n),
  ).toBe(1003);
  expect(await f.store.db.prepare("SELECT id FROM social_jobs WHERE id='unknown'").get()).toEqual({
    id: "unknown",
  });
});

it("moves media claims with archived jobs without exposing a zero-owner window", async () => {
  const f = await fixture(),
    id = randomUUID(),
    scope = { accountId: "owner:a" };
  await f.custody.registerManagedUpload(scope, id, Buffer.from("image"));
  await f.insert("done", "succeeded", {
    platformId: "post",
    payload: { media: [{ uploadId: id }] },
  });
  const revision = Number(
    (await f.store.db.prepare("SELECT revision FROM social_media_files WHERE id=?").get(id))!
      .revision,
  );
  await f.custody.releaseLogicalClaim(
    scope,
    id,
    { ownerKind: "upload", ownerId: scope.accountId, claimId: id },
    revision,
  );
  await f.archive.archive(["done"]);
  const claims = await f.store.db
    .prepare(
      "SELECT owner_kind,owner_id FROM social_media_claims WHERE media_id=? AND state='active'",
    )
    .all(id);
  expect(claims).toEqual([{ owner_kind: "job-cold", owner_id: "done" }]);
});
