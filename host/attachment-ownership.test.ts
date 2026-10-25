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
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
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
  cleanups.push(async () => {
    await ownership.close();
    await store.close();
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
    await ownership.touch("device-A", input);
    const result = await writeAttachmentChunk(store, input);
    await ownership.uploaded(input, result.offset);
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
  await ownership.claim("device-A", { ids: [ids[0]], ownerId: "draft-B" });
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  await ownership.release("device-B", { ids: [ids[0]], ownerId: "draft-A" });
  await ownership.release("device-A", { ids: [ids[0]], ownerId: "draft-A" });
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  expect(await ownership.collect()).toEqual([]);
  await ownership.release("device-A", { ids: [ids[0]], ownerId: "draft-B" });
  expect(await ownership.collect()).toEqual([]);
  const restarted = new AttachmentOwnership(store, () => clock.now);
  try {
    clock.now += ATTACHMENT_GRACE_MS + 10000;
    expect(await restarted.collect()).toEqual([ids[0]]);
    await restarted.release("device-A", { ids: [ids[0]], ownerId: "draft-B" });
    expect(existsSync(attachmentPath(store, ids[0]))).toBe(false);
  } finally {
    await restarted.close();
  }
});
it("protects queue, session-shaped and future consumer references after draft release", async () => {
  const { ownership, clock, upload, store } = setup();
  for (const id of ids) {
    await upload(id);
    await ownership.release("device-A", { ids: [id], ownerId: "draft-A" });
  }
  await store.db.exec(
    "CREATE TABLE session_queues (session_id TEXT PRIMARY KEY,payload TEXT); CREATE TABLE future_consumer(payload TEXT)",
  );
  await store.db
    .prepare("INSERT INTO session_queues VALUES('queue',?)")
    .run(JSON.stringify({ messages: [{ attachments: [{ id: ids[0] }] }] }));
  await store.db
    .prepare("INSERT INTO future_consumer VALUES(?)")
    .run(JSON.stringify({ session: { blocks: [{ attachments: [{ id: ids[1] }] }] } }));
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  expect(await ownership.collect()).toEqual([ids[2]]);
  await store.db.exec("DELETE FROM session_queues; DELETE FROM future_consumer");
  expect(await ownership.collect()).toEqual([ids[0], ids[1]]);
});
it("never reclaims unknown files or uploads used by legacy clients", async () => {
  const { ownership, clock, upload, store } = setup();
  await upload(ids[0], null, false);
  mkdirSync(store.attachmentDir, { recursive: true });
  writeFileSync(attachmentPath(store, ids[1]), "legacy-file");
  await ownership.claim("device-A", { ids: [ids[1]], ownerId: "draft" });
  await ownership.release("device-A", { ids: [ids[1]], ownerId: "draft" });
  await upload(ids[2]);
  await ownership.touch("legacy-device", { id: ids[2] });
  await ownership.release("device-A", { ids: [ids[2]], ownerId: "draft-A" });
  clock.now += ATTACHMENT_GRACE_MS * 10;
  expect(await ownership.collect()).toEqual([]);
  for (const id of ids) expect(existsSync(attachmentPath(store, id))).toBe(true);
});
it("runs startup and hourly collection, then removes its timer on close", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const { ownership, clock, upload, store } = setup();
  await upload(ids[0], "partial", false);
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  await ownership.start();
  expect(await ownership.collect()).toEqual([ids[0]]);
  await upload(ids[1], "partial", false);
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
  await ownership.collect();
  expect(existsSync(attachmentPath(store, ids[1]))).toBe(false);
  await ownership.close();
  expect(vi.getTimerCount()).toBe(0);
});
it("bounds validation and defers deletion when a reference scan is incomplete", async () => {
  const { ownership, clock, upload, store } = setup();
  await expect(
    (async () => await ownership.claim("device-A", { ids, ownerId: "x".repeat(129) }))(),
  ).rejects.toThrow("owner ID");
  await expect(
    (async () => await ownership.claim("device-A", { ids, ownerId: "draft\nother" }))(),
  ).rejects.toThrow("owner ID");
  await expect(
    (async () =>
      await ownership.claim("device-A", { ids, ownerId: "draft", claimId: "generation\u007f" }))(),
  ).rejects.toThrow("claim ID");
  await expect(
    (async () => await ownership.release("device-A", { ids: ["../outside"], ownerId: "draft" }))(),
  ).rejects.toThrow("attachment ID");
  await upload(ids[0], "partial", false);
  await store.db.exec("CREATE TABLE opaque_consumer(payload BLOB)");
  await store.db.prepare("INSERT INTO opaque_consumer VALUES(?)").run(Buffer.from("unknown"));
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  expect(await ownership.collect()).toEqual([]);
  expect(existsSync(attachmentPath(store, ids[0]))).toBe(true);
});
it("a delayed release cannot remove a newly acquired claim generation", async () => {
  const { ownership, clock, upload } = setup();
  await upload();
  await ownership.release("device-A", { ids: [ids[0]], ownerId: "draft-A" });
  await ownership.claim("device-A", {
    ids: [ids[0]],
    ownerId: "draft-A",
    claimId: "generation-one",
  });
  await ownership.release("device-A", {
    ids: [ids[0]],
    ownerId: "draft-A",
    claimId: "generation-one",
  });
  await ownership.claim("device-A", {
    ids: [ids[0]],
    ownerId: "draft-A",
    claimId: "generation-two",
  });
  await ownership.release("device-A", {
    ids: [ids[0]],
    ownerId: "draft-A",
    claimId: "generation-one",
  });
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  expect(await ownership.collect()).toEqual([]);
  await ownership.release("device-A", {
    ids: [ids[0]],
    ownerId: "draft-A",
    claimId: "generation-two",
  });
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  expect(await ownership.collect()).toEqual([ids[0]]);
});
it("reclaims unrelated orphans beside a transcript over 16 MiB and detects writes during yielded scanning", async () => {
  const { ownership, clock, upload, store } = setup();
  for (const id of ids) {
    await upload(id);
    await ownership.release("device-A", { ids: [id], ownerId: "draft-A" });
  }
  await store.db.exec(
    "CREATE TABLE large_transcript(snapshot TEXT); CREATE TABLE concurrent_consumer(payload TEXT)",
  );
  // Split a UUID across the 256 KiB string scan boundary.
  const text = "x".repeat(256 * 1024 - 15) + ids[0] + "x".repeat(17 * 1024 * 1024);
  await store.db.prepare("INSERT INTO large_transcript VALUES(?)").run(text);
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  const other = new DatabaseSync(join(store.attachmentDir, "..", "host.db"));
  const original = store.db.prepare.bind(store.db);
  let changed = false;
  const scanning = vi.spyOn(store.db, "prepare").mockImplementation((sql) => {
    if (sql.includes('FROM "large_transcript"') && !changed) {
      changed = true;
      other.prepare("INSERT INTO concurrent_consumer VALUES(?)").run(ids[1]);
    }
    return original(sql);
  });
  try {
    expect(await ownership.collect()).toEqual([]);
    expect(changed).toBe(true);
  } finally {
    scanning.mockRestore();
    await other.close();
  }
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
    await ownership.claim("device-A", { ids: missing.slice(at, at + 20), ownerId: "abandoned" });
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  await ownership.collect();
  expect(
    (await store.db.prepare("SELECT count(*) AS count FROM attachment_ownership_files").get())
      ?.count,
  ).toBe(50);
  await ownership.collect();
  expect(
    (await store.db.prepare("SELECT count(*) AS count FROM attachment_ownership_files").get())
      ?.count,
  ).toBe(0);
  expect(
    (await store.db.prepare("SELECT count(*) AS count FROM attachment_ownership_claims").get())
      ?.count,
  ).toBe(0);
});
it("cancels a yielded maintenance pass on shutdown before touching files or a closed database", async () => {
  const { ownership, clock, upload, store } = setup();
  await upload(ids[0], "partial", false);
  await store.db.exec("CREATE TABLE shutdown_transcript(payload TEXT)");
  await store.db
    .prepare("INSERT INTO shutdown_transcript VALUES(?)")
    .run("x".repeat(2 * 1024 * 1024));
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  const original = store.db.prepare.bind(store.db);
  let stoppedDuringScan = false;
  const scanning = vi.spyOn(store.db, "prepare").mockImplementation((sql) => {
    if (sql.includes('FROM "shutdown_transcript"'))
      setImmediate(() => {
        ownership.close();
        stoppedDuringScan = true;
      });
    return original(sql);
  });
  try {
    await expect(ownership.collect()).resolves.toEqual([]);
  } finally {
    scanning.mockRestore();
  }
  expect(stoppedDuringScan).toBe(true);
  expect(existsSync(attachmentPath(store, ids[0]))).toBe(true);
  await expect(ownership.collect()).resolves.toEqual([]);
});

it("defers reclamation when a new reference writer is queued behind the inventory scope", async () => {
  const { ownership, clock, upload, store } = setup();
  await upload(ids[0], "partial", false);
  await store.db.exec(
    "CREATE TABLE scan_body(payload TEXT); CREATE TABLE queued_references(payload TEXT)",
  );
  await store.db.prepare("INSERT INTO scan_body VALUES(?)").run("x".repeat(2 * 1024 * 1024));
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  const original = store.db.prepare.bind(store.db);
  let queued: Promise<unknown> | undefined;
  const scanning = vi.spyOn(store.db, "prepare").mockImplementation((sql) => {
    if (sql.includes('FROM "scan_body"') && !queued)
      queued = store.db.outsideScope(() =>
        store.db.prepare("INSERT INTO queued_references VALUES(?)").run(ids[0]),
      );
    return original(sql);
  });
  try {
    expect(await ownership.collect()).toEqual([]);
  } finally {
    scanning.mockRestore();
    await queued;
  }
  expect(queued).toBeDefined();
  expect(existsSync(attachmentPath(store, ids[0]))).toBe(true);
  expect((await store.db.prepare("SELECT count(*) AS n FROM queued_references").get())?.n).toBe(1);
});
it("holds managed queue exports offline after another client removes the server row", async () => {
  const { ownership, clock, upload } = setup();
  await upload();
  await ownership.expose("device-B", [ids[0]], {
    ownerId: "queue-view",
    claimId: "offline-generation",
  });
  await ownership.release("device-A", { ids: [ids[0]], ownerId: "draft-A" });
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  expect(await ownership.collect()).toEqual([]);
  await ownership.release("device-B", {
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
  await ownership.expose("legacy-reader", [ids[0]], {});
  await ownership.release("device-A", { ids: [ids[0]], ownerId: "draft-A" });
  clock.now += ATTACHMENT_GRACE_MS * 100;
  expect(await ownership.collect()).toEqual([]);
});
it("requires canonical IDs for managed claims while preserving legacy uppercase upload compatibility", async () => {
  const { ownership, upload } = setup();
  await expect(
    (async () =>
      await ownership.claim("device", { ids: [ids[0].toUpperCase()], ownerId: "draft" }))(),
  ).rejects.toThrow("lowercase UUIDs");
  await upload(ids[0].toUpperCase(), null, false);
  await expect(
    (async () =>
      await ownership.touch("device", { id: ids[0].toUpperCase(), ownerId: "managed" }))(),
  ).rejects.toThrow("lowercase UUIDs");
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
    await ownership.claim("offline", { ids: held.slice(at, at + 20), ownerId: "saved-draft" });
  await store.db.exec("UPDATE attachment_ownership_files SET complete=1");
  await upload();
  await ownership.release("device-A", { ids: [ids[0]], ownerId: "draft-A" });
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  expect(await ownership.collect()).toEqual([]);
  expect(await ownership.collect()).toEqual([ids[0]]);
  expect(
    (await store.db.prepare("SELECT count(*) AS count FROM attachment_ownership_files").get())
      ?.count,
  ).toBe(1000);
});
it("paginates a read-only principal/owner inventory by exact ID and generation, including empty legacy generations", async () => {
  const { ownership, store } = setup();
  const owned = Array.from(
    { length: 201 },
    (_, index) => `11111111-1111-4111-8111-${index.toString(16).padStart(12, "0")}`,
  );
  for (const claimId of ["generation-A", "generation-B"])
    for (let at = 0; at < owned.length; at += 20)
      await ownership.claim("device-A", {
        ids: owned.slice(at, at + 20),
        ownerId: "recovery",
        claimId,
      });
  await ownership.claim("device-A", { ids: [owned[0]], ownerId: "recovery", claimId: "" });
  await ownership.claim("device-B", { ids: [owned[0]], ownerId: "recovery", claimId: "private" });
  await ownership.claim("device-A", {
    ids: [owned[0]],
    ownerId: "another-owner",
    claimId: "private",
  });
  const before = (await store.db.prepare("SELECT total_changes() AS changes").get())?.changes;
  const found: Array<{
    id: string;
    claimId: string;
  }> = [];
  let after:
    | {
        id: string;
        claimId: string;
      }
    | undefined;
  do {
    const page = await ownership.claims("device-A", { ownerId: "recovery", after });
    expect(page.claims.length).toBeLessThanOrEqual(200);
    found.push(...page.claims);
    after = page.next;
  } while (after);
  expect(found).toHaveLength(403);
  expect(new Set(found.map((claim) => JSON.stringify(claim))).size).toBe(403);
  expect(found[0]).toEqual({ id: owned[0], claimId: "" });
  expect(found.some((claim) => claim.claimId === "private")).toBe(false);
  expect((await store.db.prepare("SELECT total_changes() AS changes").get())?.changes).toBe(before);
  await ownership.release("device-A", { ids: [owned[0]], ownerId: "recovery", claimId: "" });
  expect((await ownership.claims("device-A", { ownerId: "recovery" })).claims[0]).toEqual({
    id: owned[0],
    claimId: "generation-A",
  });
  await expect(
    (async () =>
      await ownership.claims("device-A", {
        ownerId: "recovery",
        after: { id: "../outside", claimId: "" },
      }))(),
  ).rejects.toThrow("claims cursor");
  await expect(
    (async () =>
      await ownership.claims("device-A", {
        ownerId: "recovery",
        after: { id: owned[0], claimId: "x".repeat(129) },
      }))(),
  ).rejects.toThrow("claims cursor");
});
it("recovers and releases a queue claim after its response was lost before the client adopted its IDs", async () => {
  const { ownership, clock, upload } = setup();
  await upload();
  await ownership.expose("reader", [ids[0]], {
    ownerId: "lost-response",
    claimId: "persisted-generation",
  });
  // No client-side held-ID ledger ever receives the exported response.
  await ownership.release("device-A", { ids: [ids[0]], ownerId: "draft-A" });
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  expect(await ownership.collect()).toEqual([]);
  const recovered = await ownership.claims("reader", { ownerId: "lost-response" });
  expect(recovered.claims).toEqual([{ id: ids[0], claimId: "persisted-generation" }]);
  for (const claim of recovered.claims)
    await ownership.release("reader", {
      ownerId: "lost-response",
      ids: [claim.id],
      claimId: claim.claimId,
    });
  clock.now += ATTACHMENT_GRACE_MS + 10000;
  expect(await ownership.collect()).toEqual([ids[0]]);
});
