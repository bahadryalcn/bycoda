import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "./store";
import { DatabaseSync } from "node:sqlite";
import { AttachmentOwnership, ATTACHMENT_GRACE_MS } from "./attachment-ownership";
import { attachmentPath, writeAttachmentChunk } from "./attachments";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.useRealTimers();
});
const ids = [
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
];
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "attachment-ownership-"));
  const store = new HostStore(join(directory, "host.db"));
  const clock = { now: Date.now() };
  const ownership = new AttachmentOwnership(store, () => clock.now);
  cleanups.push(() => {
    ownership.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const upload = async (id = ids[0], ownerId: string | null = "draft-A", complete = true) => {
    const input = {
      id,
      ownerId: ownerId ?? undefined,
      offset: 0,
      size: 6,
      data: Buffer.from(complete ? "abcdef" : "abc").toString("base64"),
    };
    ownership.touch("device-A", input);
    const result = await writeAttachmentChunk(store, input);
    ownership.uploaded(input, result.offset);
  };
  return { store, clock, ownership, upload };
}

it("automatically expires abandoned partial uploads, preserving complete offline drafts indefinitely", async () => {
  const { ownership, clock, upload, store } = setup();
  await upload(ids[0], "partial", false);
  await upload(ids[1], "offline-draft", true);
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  expect(await ownership.collect()).toEqual([ids[0]]);
  clock.now += 365 * 24 * 60 * 60 * 1000;
  expect(await ownership.collect()).toEqual([]);
  expect(existsSync(attachmentPath(store, ids[1]))).toBe(true);
});

it("requires exact authenticated draft ownership release and a fresh persisted grace", async () => {
  const { ownership, clock, upload, store } = setup();
  await upload();
  ownership.claim("device-A", { ids: [ids[0]], ownerId: "draft-B" });
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  ownership.release("device-B", { ids: [ids[0]], ownerId: "draft-A" });
  ownership.release("device-A", { ids: [ids[0]], ownerId: "draft-A" });
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  expect(await ownership.collect()).toEqual([]);
  ownership.release("device-A", { ids: [ids[0]], ownerId: "draft-B" });
  expect(await ownership.collect()).toEqual([]);
  const restarted = new AttachmentOwnership(store, () => clock.now);
  try {
    clock.now += ATTACHMENT_GRACE_MS + 10000;
    expect(await restarted.collect()).toEqual([ids[0]]);
    restarted.release("device-A", { ids: [ids[0]], ownerId: "draft-B" });
    expect(existsSync(attachmentPath(store, ids[0]))).toBe(false);
  } finally {
    restarted.close();
  }
});

it("protects queue, session-shaped and future consumer references after draft release", async () => {
  const { ownership, clock, upload, store } = setup();
  for (const id of ids) {
    await upload(id);
    ownership.release("device-A", { ids: [id], ownerId: "draft-A" });
  }
  store.db.exec(
    "CREATE TABLE session_queues (session_id TEXT PRIMARY KEY,payload TEXT); CREATE TABLE future_consumer(payload TEXT)",
  );
  store.db
    .prepare("INSERT INTO session_queues VALUES('queue',?)")
    .run(JSON.stringify({ messages: [{ attachments: [{ id: ids[0] }] }] }));
  store.db
    .prepare("INSERT INTO future_consumer VALUES(?)")
    .run(JSON.stringify({ session: { blocks: [{ attachments: [{ id: ids[1] }] }] } }));
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  expect(await ownership.collect()).toEqual([ids[2]]);
  store.db.exec("DELETE FROM session_queues; DELETE FROM future_consumer");
  expect(await ownership.collect()).toEqual([ids[0], ids[1]]);
});

it("never reclaims unknown files or uploads used by legacy clients", async () => {
  const { ownership, clock, upload, store } = setup();
  await upload(ids[0], null, false);
  mkdirSync(store.attachmentDir, { recursive: true });
  writeFileSync(attachmentPath(store, ids[1]), "legacy-file");
  ownership.claim("device-A", { ids: [ids[1]], ownerId: "draft" });
  ownership.release("device-A", { ids: [ids[1]], ownerId: "draft" });
  await upload(ids[2]);
  ownership.touch("legacy-device", { id: ids[2] });
  ownership.release("device-A", { ids: [ids[2]], ownerId: "draft-A" });
  clock.now += ATTACHMENT_GRACE_MS * 10;
  expect(await ownership.collect()).toEqual([]);
  for (const id of ids) expect(existsSync(attachmentPath(store, id))).toBe(true);
});

it("runs startup and hourly collection, then removes its timer on close", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const { ownership, clock, upload, store } = setup();
  await upload(ids[0], "partial", false);
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  ownership.start();
  expect(await ownership.collect()).toEqual([ids[0]]);
  await upload(ids[1], "partial", false);
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  vi.advanceTimersByTime(60 * 60 * 1000);
  await ownership.collect();
  expect(existsSync(attachmentPath(store, ids[1]))).toBe(false);
  ownership.close();
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds validation and defers deletion when a reference scan is incomplete", async () => {
  const { ownership, clock, upload, store } = setup();
  expect(() => ownership.claim("device-A", { ids, ownerId: "x".repeat(129) })).toThrow("owner ID");
  expect(() => ownership.claim("device-A", { ids, ownerId: "draft\nother" })).toThrow("owner ID");
  expect(() =>
    ownership.claim("device-A", { ids, ownerId: "draft", claimId: "generation\u007f" }),
  ).toThrow("claim ID");
  expect(() => ownership.release("device-A", { ids: ["../outside"], ownerId: "draft" })).toThrow(
    "attachment ID",
  );
  await upload(ids[0], "partial", false);
  store.db.exec("CREATE TABLE opaque_consumer(payload BLOB)");
  store.db.prepare("INSERT INTO opaque_consumer VALUES(?)").run(Buffer.from("unknown"));
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  expect(await ownership.collect()).toEqual([]);
  expect(existsSync(attachmentPath(store, ids[0]))).toBe(true);
});

it("a delayed release cannot remove a newly acquired claim generation", async () => {
  const { ownership, clock, upload } = setup();
  await upload();
  ownership.release("device-A", { ids: [ids[0]], ownerId: "draft-A" });
  ownership.claim("device-A", { ids: [ids[0]], ownerId: "draft-A", claimId: "generation-one" });
  ownership.release("device-A", { ids: [ids[0]], ownerId: "draft-A", claimId: "generation-one" });
  ownership.claim("device-A", { ids: [ids[0]], ownerId: "draft-A", claimId: "generation-two" });
  ownership.release("device-A", { ids: [ids[0]], ownerId: "draft-A", claimId: "generation-one" });
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  expect(await ownership.collect()).toEqual([]);
  ownership.release("device-A", { ids: [ids[0]], ownerId: "draft-A", claimId: "generation-two" });
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  expect(await ownership.collect()).toEqual([ids[0]]);
});

it("reclaims unrelated orphans beside a transcript over 16 MiB and detects writes during yielded scanning", async () => {
  const { ownership, clock, upload, store } = setup();
  for (const id of ids) {
    await upload(id);
    ownership.release("device-A", { ids: [id], ownerId: "draft-A" });
  }
  store.db.exec(
    "CREATE TABLE large_transcript(snapshot TEXT); CREATE TABLE concurrent_consumer(payload TEXT)",
  );
  // Split a UUID across the 256 KiB string scan boundary.
  const text = "x".repeat(256 * 1024 - 15) + ids[0] + "x".repeat(17 * 1024 * 1024);
  store.db.prepare("INSERT INTO large_transcript VALUES(?)").run(text);
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  const changingPass = ownership.collect();
  const other = new DatabaseSync(join(store.attachmentDir, "..", "host.db"));
  try {
    other.prepare("INSERT INTO concurrent_consumer VALUES(?)").run(ids[1]);
  } finally {
    other.close();
  }
  expect(await changingPass).toEqual([]);
  expect(await ownership.collect()).toEqual([ids[2]]);
  expect(existsSync(attachmentPath(store, ids[0]))).toBe(true);
  expect(existsSync(attachmentPath(store, ids[1]))).toBe(true);
});

it("prunes missing expired files in bounded rotating batches", async () => {
  const { ownership, clock, store } = setup();
  const missing = Array.from(
    { length: 250 },
    (_, index) => `eeeeeeee-eeee-4eee-8eee-${index.toString(16).padStart(12, "0")}`,
  );
  for (let at = 0; at < missing.length; at += 20)
    ownership.claim("device-A", { ids: missing.slice(at, at + 20), ownerId: "abandoned" });
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  await ownership.collect();
  expect(
    store.db.prepare("SELECT count(*) AS count FROM attachment_ownership_files").get()?.count,
  ).toBe(50);
  await ownership.collect();
  expect(
    store.db.prepare("SELECT count(*) AS count FROM attachment_ownership_files").get()?.count,
  ).toBe(0);
  expect(
    store.db.prepare("SELECT count(*) AS count FROM attachment_ownership_claims").get()?.count,
  ).toBe(0);
});

it("cancels a yielded maintenance pass on shutdown before touching files or a closed database", async () => {
  const { ownership, clock, upload, store } = setup();
  await upload(ids[0], "partial", false);
  store.db.exec("CREATE TABLE shutdown_transcript(payload TEXT)");
  store.db.prepare("INSERT INTO shutdown_transcript VALUES(?)").run("x".repeat(2 * 1024 * 1024));
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  const pending = ownership.collect();
  ownership.close();
  await expect(pending).resolves.toEqual([]);
  expect(existsSync(attachmentPath(store, ids[0]))).toBe(true);
  await expect(ownership.collect()).resolves.toEqual([]);
});

it("holds managed queue exports offline after another client removes the server row", async () => {
  const { ownership, clock, upload } = setup();
  await upload();
  ownership.expose("device-B", [ids[0]], { ownerId: "queue-view", claimId: "offline-generation" });
  ownership.release("device-A", { ids: [ids[0]], ownerId: "draft-A" });
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  expect(await ownership.collect()).toEqual([]);
  ownership.release("device-B", {
    ids: [ids[0]],
    ownerId: "queue-view",
    claimId: "offline-generation",
  });
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  expect(await ownership.collect()).toEqual([ids[0]]);
});
it("pins legacy queue exports instead of guessing whether their offline editor still owns them", async () => {
  const { ownership, clock, upload } = setup();
  await upload();
  ownership.expose("legacy-reader", [ids[0]], {});
  ownership.release("device-A", { ids: [ids[0]], ownerId: "draft-A" });
  clock.now += ATTACHMENT_GRACE_MS * 100;
  expect(await ownership.collect()).toEqual([]);
});
it("requires canonical IDs for managed claims while preserving legacy uppercase upload compatibility", async () => {
  const { ownership, upload } = setup();
  expect(() =>
    ownership.claim("device", { ids: [ids[0].toUpperCase()], ownerId: "draft" }),
  ).toThrow("lowercase UUIDs");
  await upload(ids[0].toUpperCase(), null, false);
  expect(() => ownership.touch("device", { id: ids[0].toUpperCase(), ownerId: "managed" })).toThrow(
    "lowercase UUIDs",
  );
});

it("never follows an attachment-directory junction during collection", async () => {
  const { ownership, clock, upload, store } = setup();
  await upload(ids[0], "partial", false);
  const outside = join(store.attachmentDir, "..", "junction-target");
  renameSync(store.attachmentDir, outside);
  symlinkSync(outside, store.attachmentDir, "junction");
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  expect(await ownership.collect()).toEqual([]);
  expect(existsSync(join(outside, ids[0]))).toBe(true);
});
it("rotates past a bounded page of non-expiring offline claims without starving later orphans", async () => {
  const { ownership, clock, upload, store } = setup();
  const held = Array.from(
    { length: 1000 },
    (_, index) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
  );
  for (let at = 0; at < held.length; at += 20)
    ownership.claim("offline", { ids: held.slice(at, at + 20), ownerId: "saved-draft" });
  store.db.exec("UPDATE attachment_ownership_files SET complete=1");
  await upload();
  ownership.release("device-A", { ids: [ids[0]], ownerId: "draft-A" });
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  expect(await ownership.collect()).toEqual([]);
  expect(await ownership.collect()).toEqual([ids[0]]);
  expect(
    store.db.prepare("SELECT count(*) AS count FROM attachment_ownership_files").get()?.count,
  ).toBe(1000);
});

it("paginates a read-only principal/owner inventory by exact ID and generation, including empty legacy generations", () => {
  const { ownership, store } = setup();
  const owned = Array.from(
    { length: 201 },
    (_, index) => `11111111-1111-4111-8111-${index.toString(16).padStart(12, "0")}`,
  );
  for (const claimId of ["generation-A", "generation-B"])
    for (let at = 0; at < owned.length; at += 20)
      ownership.claim("device-A", { ids: owned.slice(at, at + 20), ownerId: "recovery", claimId });
  ownership.claim("device-A", { ids: [owned[0]], ownerId: "recovery", claimId: "" });
  ownership.claim("device-B", { ids: [owned[0]], ownerId: "recovery", claimId: "private" });
  ownership.claim("device-A", { ids: [owned[0]], ownerId: "another-owner", claimId: "private" });
  const before = store.db.prepare("SELECT total_changes() AS changes").get()?.changes;
  const found: Array<{ id: string; claimId: string }> = [];
  let after: { id: string; claimId: string } | undefined;
  do {
    const page = ownership.claims("device-A", { ownerId: "recovery", after });
    expect(page.claims.length).toBeLessThanOrEqual(200);
    found.push(...page.claims);
    after = page.next;
  } while (after);
  expect(found).toHaveLength(403);
  expect(new Set(found.map((claim) => JSON.stringify(claim))).size).toBe(403);
  expect(found[0]).toEqual({ id: owned[0], claimId: "" });
  expect(found.some((claim) => claim.claimId === "private")).toBe(false);
  expect(store.db.prepare("SELECT total_changes() AS changes").get()?.changes).toBe(before);
  ownership.release("device-A", { ids: [owned[0]], ownerId: "recovery", claimId: "" });
  expect(ownership.claims("device-A", { ownerId: "recovery" }).claims[0]).toEqual({
    id: owned[0],
    claimId: "generation-A",
  });
  expect(() =>
    ownership.claims("device-A", { ownerId: "recovery", after: { id: "../outside", claimId: "" } }),
  ).toThrow("claims cursor");
  expect(() =>
    ownership.claims("device-A", {
      ownerId: "recovery",
      after: { id: owned[0], claimId: "x".repeat(129) },
    }),
  ).toThrow("claims cursor");
});

it("recovers and releases a queue claim after its response was lost before the client adopted its IDs", async () => {
  const { ownership, clock, upload } = setup();
  await upload();
  ownership.expose("reader", [ids[0]], {
    ownerId: "lost-response",
    claimId: "persisted-generation",
  });
  // No client-side held-ID ledger ever receives the exported response.
  ownership.release("device-A", { ids: [ids[0]], ownerId: "draft-A" });
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  expect(await ownership.collect()).toEqual([]);
  const recovered = ownership.claims("reader", { ownerId: "lost-response" });
  expect(recovered.claims).toEqual([{ id: ids[0], claimId: "persisted-generation" }]);
  for (const claim of recovered.claims)
    ownership.release("reader", {
      ownerId: "lost-response",
      ids: [claim.id],
      claimId: claim.claimId,
    });
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  expect(await ownership.collect()).toEqual([ids[0]]);
});
