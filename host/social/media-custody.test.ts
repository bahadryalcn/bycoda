import { afterEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../store";
import { SocialMediaCustody } from "./media-custody";
import { SocialMediaQuarantine } from "./media-quarantine";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});
/** A reconciliation pause that stays closed until `release`, so a test controls batch timing. */
function createGate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { pause: () => opened, release: () => open() };
}
async function fixture(pause?: () => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "social-custody-"));
  const store = new HostStore(join(directory, "host.db"));
  await store.ready;
  await store.db
    .exec(`CREATE TABLE social_records(kind TEXT,id TEXT,value TEXT,PRIMARY KEY(kind,id));
    CREATE TABLE social_jobs(id TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE social_jobs_cold(id TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE social_programs(id TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE social_occurrences(id TEXT PRIMARY KEY,value TEXT);`);
  const custody = new SocialMediaCustody(store, directory, pause);
  await custody.initialize();
  if (!pause) await custody.reconciled();
  cleanup.push(async () => {
    // A still-running rebuild must finish (or fail) before the store closes.
    await custody.reconciled().catch(() => undefined);
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, store, custody };
}

it("registers owned bytes and retains upload claim before disclosure", async () => {
  const f = await fixture(),
    id = randomUUID(),
    data = Buffer.from("image contents");
  await f.custody.registerManagedUpload({ accountId: "owner:a" }, id, data);
  const file = await f.store.db.prepare("SELECT * FROM social_media_files WHERE id=?").get(id);
  expect(file).toMatchObject({ id, account_id: "owner:a", state: "active", revision: 1 });
  expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(await readFile(file.path)).toEqual(data);
  expect(
    await f.store.db.prepare("SELECT * FROM social_media_claims WHERE media_id=?").get(id),
  ).toMatchObject({ owner_kind: "upload", owner_id: "owner:a", claim_id: id, state: "active" });
});

it("enforces exact owner and revision and transfers claims atomically without deleting bytes", async () => {
  const f = await fixture(),
    id = randomUUID(),
    scope = { accountId: "owner:a" };
  await f.custody.registerManagedUpload(scope, id, Buffer.from("bytes"));
  const upload = { ownerKind: "upload", ownerId: "owner:a", claimId: id };
  const draft = { ownerKind: "draft", ownerId: "draft-1", claimId: "claim-1" };
  await expect(f.custody.retain({ accountId: "owner:b" }, id, draft, 1)).rejects.toThrow("owner");
  await expect(f.custody.retain(scope, id, draft, 2)).rejects.toThrow("revision");
  expect(await f.custody.claimOwnerTransfer(scope, id, upload, draft, 1)).toBe(2);
  expect(await f.custody.releaseLogicalClaim(scope, id, draft, 2)).toBe(3);
  expect(await readFile(join(f.directory, "media", id), "utf8")).toBe("bytes");
  expect(
    await f.store.db
      .prepare("SELECT state FROM social_media_claims WHERE media_id=? AND claim_id=?")
      .get(id, draft.claimId),
  ).toEqual({ state: "released" });
});

it("refuses quarantined and unregistered media without touching legacy bytes", async () => {
  const f = await fixture(),
    id = randomUUID(),
    legacy = randomUUID(),
    scope = { accountId: "owner:a" };
  await f.custody.registerManagedUpload(scope, id, Buffer.from("managed"));
  const legacyPath = join(f.directory, "media", legacy);
  await writeFile(legacyPath, "legacy");
  const claim = { ownerKind: "draft", ownerId: "d", claimId: "c" };
  await f.store.db.prepare("UPDATE social_media_files SET state='quarantined' WHERE id=?").run(id);
  await expect(f.custody.retain(scope, id, claim, 1)).rejects.toThrow("not active");
  await expect(f.custody.retain(scope, legacy, claim, 1)).rejects.toThrow("unavailable");
  expect(await readFile(legacyPath, "utf8")).toBe("legacy");
});

it("tracks copied durable owners atomically and preserves job evidence", async () => {
  const f = await fixture(),
    id = randomUUID();
  await f.custody.registerManagedUpload({ accountId: "owner:a" }, id, Buffer.from("bytes"));
  const payload = JSON.stringify({ media: [{ uploadId: id }] });
  await f.store.db
    .prepare("INSERT INTO social_records VALUES (?,?,?)")
    .run("draft", "first", payload);
  await f.store.db
    .prepare("INSERT INTO social_records VALUES (?,?,?)")
    .run("draft", "copy", payload);
  await f.store.db.prepare("INSERT INTO social_jobs VALUES (?,?)").run("unknown", payload);
  await f.store.db
    .prepare("DELETE FROM social_records WHERE kind=? AND id=?")
    .run("draft", "first");
  const claims = await f.store.db
    .prepare(
      "SELECT owner_kind,owner_id FROM social_media_claims WHERE media_id=? AND state='active' ORDER BY owner_kind,owner_id",
    )
    .all(id);
  expect(claims).toEqual([
    { owner_kind: "job", owner_id: "unknown" },
    { owner_kind: "record:draft", owner_id: "copy" },
    { owner_kind: "upload", owner_id: "owner:a" },
  ]);
  await f.store.db.prepare("UPDATE social_media_files SET state='quarantined' WHERE id=?").run(id);
  await expect(
    f.store.db.prepare("INSERT INTO social_programs VALUES (?,?)").run("new", payload),
  ).rejects.toThrow("not active");
});

it("rolls back the owner and claim together and rebuilds older durable references", async () => {
  // Rebuilds run in the background; the test waits for the rebuild it triggers.
  const f = await fixture(),
    id = randomUUID();
  await f.custody.registerManagedUpload({ accountId: "owner:a" }, id, Buffer.from("bytes"));
  const payload = JSON.stringify({ variants: [{ media: [{ uploadId: id }] }] });
  await expect(
    f.store.transaction(async () => {
      await f.store.db
        .prepare("INSERT INTO social_occurrences VALUES (?,?)")
        .run("occurrence", payload);
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  expect(
    await f.store.db
      .prepare("SELECT 1 FROM social_media_claims WHERE media_id=? AND owner_kind='occurrence'")
      .get(id),
  ).toBeUndefined();
  await f.store.db.prepare("INSERT INTO social_programs VALUES (?,?)").run("program", payload);
  await f.store.db
    .prepare("DELETE FROM social_media_claims WHERE media_id=? AND owner_kind='program'")
    .run(id);
  await f.custody.initialize();
  await f.custody.reconciled();
  expect(
    await f.store.db
      .prepare("SELECT state FROM social_media_claims WHERE media_id=? AND owner_kind='program'")
      .get(id),
  ).toEqual({ state: "active" });
});

it("initialize returns while the reference rebuild is still paused", async () => {
  const gate = createGate();
  const f = await fixture(gate.pause);
  cleanup.push(async () => gate.release());
  await f.store.db
    .prepare("INSERT INTO social_jobs VALUES (?,?)")
    .run("plain", JSON.stringify({ id: "plain" }));
  // The rebuild reaches the closed gate after its first batch; startup must not wait for it.
  await f.custody.initialize();
  let settled = false;
  const rebuilt = f.custody.reconciled().then(() => {
    settled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  expect(settled).toBe(false);
  gate.release();
  await rebuilt;
  expect(settled).toBe(true);
});

it("rebuilds claims missing from every batch of a large table", async () => {
  const f = await fixture();
  const id = randomUUID();
  await f.custody.registerManagedUpload({ accountId: "owner:a" }, id, Buffer.from("bytes"));
  const payload = JSON.stringify({ media: [{ uploadId: id }] });
  // 450 rows span several 200-row batches.
  for (let i = 0; i < 450; i++)
    await f.store.db.prepare("INSERT INTO social_jobs VALUES (?,?)").run(`job-${i}`, payload);
  await f.store.db
    .prepare("DELETE FROM social_media_claims WHERE media_id=? AND owner_kind='job'")
    .run(id);
  let pauses = 0;
  const rebuilt = new SocialMediaCustody(f.store, f.directory, async () => {
    pauses++;
  });
  await rebuilt.initialize();
  await rebuilt.reconciled();
  expect(pauses).toBeGreaterThan(1);
  expect(
    await f.store.db
      .prepare(
        "SELECT count(*) AS count FROM social_media_claims WHERE media_id=? AND owner_kind='job' AND state='active'",
      )
      .get(id),
  ).toEqual({ count: 450 });
});

it("transfers an upload claim once and replays the exact authenticated receipt", async () => {
  const f = await fixture(),
    mediaId = randomUUID(),
    editorId = randomUUID(),
    requestId = randomUUID();
  const scope = { accountId: "owner:a" };
  await f.custody.registerManagedUpload(scope, mediaId, Buffer.from("bytes"));
  const input = { mediaId, editorId, requestId, expectedRevision: 1 };
  expect(await f.custody.editorOperation(scope, "transfer", input)).toEqual({
    mediaId,
    editorId,
    revision: 2,
  });
  expect(await f.custody.editorOperation(scope, "transfer", input)).toEqual({
    mediaId,
    editorId,
    revision: 2,
  });
  await expect(f.custody.editorOperation(scope, "claim", input)).rejects.toThrow("already used");
  await expect(
    f.custody.editorOperation({ accountId: "owner:b" }, "claim", {
      ...input,
      requestId: randomUUID(),
      expectedRevision: 2,
    }),
  ).rejects.toThrow("owner");
  expect(
    await f.store.db
      .prepare("SELECT state FROM social_media_claims WHERE media_id=? AND owner_kind='upload'")
      .get(mediaId),
  ).toEqual({ state: "released" });
  expect(
    await f.store.db
      .prepare(
        "SELECT state FROM social_media_claims WHERE media_id=? AND owner_kind='editor' AND claim_id=?",
      )
      .get(mediaId, editorId),
  ).toEqual({ state: "active" });
});

it("quarantines only a verified zero-owner managed file and keeps recovery bytes", async () => {
  const f = await fixture(),
    id = randomUUID(),
    scope = { accountId: "owner:a" };
  await f.custody.registerManagedUpload(scope, id, Buffer.from("owned"));
  const file = await f.store.db
    .prepare("SELECT volume,file_id FROM social_media_files WHERE id=?")
    .get(id);
  if (!file?.volume || !file.file_id) return;
  const quarantine = new SocialMediaQuarantine(f.store, f.directory, f.custody);
  await expect(quarantine.quarantine(scope, id, 1)).rejects.toThrow("active owners");
  const claim = { ownerKind: "upload", ownerId: scope.accountId, claimId: id };
  await f.custody.releaseLogicalClaim(scope, id, claim, 1);
  expect(await quarantine.quarantine(scope, id, 2)).toMatchObject({
    state: "quarantined",
    activeClaims: 0,
  });
  const row = await f.store.db
    .prepare("SELECT quarantine_path FROM social_media_files WHERE id=?")
    .get(id);
  expect(await readFile(String(row!.quarantine_path), "utf8")).toBe("owned");
  await expect(
    f.custody.retain(scope, id, { ownerKind: "draft", ownerId: "d", claimId: "c" }, 4),
  ).rejects.toThrow("not active");
});

it("retains changed or legacy files rather than quarantining them", async () => {
  const f = await fixture(),
    id = randomUUID(),
    legacy = randomUUID(),
    scope = { accountId: "owner:a" };
  await f.custody.registerManagedUpload(scope, id, Buffer.from("before"));
  const file = await f.store.db
    .prepare("SELECT volume,file_id FROM social_media_files WHERE id=?")
    .get(id);
  if (!file?.volume || !file.file_id) return;
  const quarantine = new SocialMediaQuarantine(f.store, f.directory, f.custody);
  await f.custody.releaseLogicalClaim(
    scope,
    id,
    { ownerKind: "upload", ownerId: scope.accountId, claimId: id },
    1,
  );
  await writeFile(join(f.directory, "media", id), "changed");
  await expect(quarantine.quarantine(scope, id, 2)).rejects.toThrow("identity changed");
  expect(await readFile(join(f.directory, "media", id), "utf8")).toBe("changed");
  await writeFile(join(f.directory, "media", legacy), "legacy");
  await expect(quarantine.quarantine(scope, legacy, 1)).rejects.toThrow("unavailable");
  expect(await readFile(join(f.directory, "media", legacy), "utf8")).toBe("legacy");
});
