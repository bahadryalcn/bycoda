import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "../store";
import { createNativeBufferPersistenceStore } from "./native-buffer-persistence-store";
import {
  collectOrphanNativeBufferBlobs,
  countOrphanNativeBufferBlobs,
} from "./native-buffer-blob-gc";
import type {
  NativeBufferClockState,
  NativeBufferCompletionCertificate,
} from "../ports/native-buffer-persistence";

const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const reportId = "b".repeat(64);
const currentKey = `native-activity/buffers/${reportId}.json`;
const historyKey = `native-activity/buffer-history/reports/${reportId}/0000000000000001-${"c".repeat(64)}.json`;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
});

async function fixture() {
  const base = resolve("temp/verification/2026-11-07-host-db-retention/fixtures");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "gc-"));
  const store = new HostStore(join(root, "host.db"));
  const persistence = createNativeBufferPersistenceStore(store);
  const device = await store.issueDevice("blob gc fixture");
  const authorize = async () => {
    if (!(await store.authenticated(device.token))) throw new Error("Fixture authority revoked");
  };
  cleanups.push(async () => {
    await store.close();
    if (!resolve(root).startsWith(base + sep)) throw new Error("Unsafe fixture cleanup");
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  return { store, persistence, authorize };
}
function reservedClock(): [NativeBufferClockState, NativeBufferClockState] {
  const clockId = randomUUID();
  const initial = {
    version: 1 as const,
    reportId,
    clockId,
    base: 0,
    highWater: 0,
    digest: sha(`${"0".repeat(16)}|${clockId}|${"0".repeat(64)}`),
  };
  return [
    initial,
    {
      ...initial,
      highWater: 1,
      digest: sha(`${"1".padStart(16, "0")}|${clockId}|${initial.digest}`),
    },
  ];
}
const ref = (key: string, raw: Buffer) => ({ key, sha256: sha(raw), byteLength: raw.length });

/** Version 1 is certified with current=A; then the mutable key moves to B and C without
 * certificates. A stays reachable through the certificate only; B is the one orphan. */
async function seeded() {
  const f = await fixture();
  const [initial, next] = reservedClock();
  await f.persistence.initializeClock(initial, f.authorize);
  await f.persistence.advanceClock(initial, next, f.authorize);
  const a = Buffer.from('{"version":"A"}'),
    h = Buffer.from('{"manifest":"H"}'),
    b = Buffer.from('{"version":"B-orphan"}'),
    c = Buffer.from('{"version":"C"}');
  const certificate: NativeBufferCompletionCertificate = {
    reportId,
    reportVersion: 1,
    snapshotDigest: sha(a),
    byteLength: a.length,
    clockId: next.clockId,
    raw: a,
    artifacts: [ref(currentKey, a), ref(historyKey, h)],
  };
  await f.persistence.complete({
    writes: [
      { key: currentKey, bytes: a, immutable: false },
      { key: historyKey, bytes: h, immutable: true },
    ],
    certificates: [certificate],
    authorize: f.authorize,
  });
  for (const bytes of [b, c])
    await f.persistence.complete({
      writes: [{ key: currentKey, bytes, immutable: false }],
      certificates: [],
      authorize: f.authorize,
    });
  return { ...f, a, b, c, h, certificate };
}
const blobCount = async (store: HostStore) =>
  Number((await store.db.prepare("SELECT COUNT(*) AS n FROM native_buffer_blobs").get())?.n ?? -1);

it("deletes only blobs no artifact or certificate references, idempotently", async () => {
  const f = await seeded();
  expect(await blobCount(f.store)).toBe(4);
  expect(await countOrphanNativeBufferBlobs(f.store)).toEqual({
    orphanBlobs: 1,
    orphanBytes: f.b.length,
    deletedBlobs: 0,
    deletedBytes: 0,
  });
  expect(await blobCount(f.store)).toBe(4);
  const result = await collectOrphanNativeBufferBlobs(f.store);
  expect(result).toMatchObject({ deletedBlobs: 1, deletedBytes: f.b.length });
  expect(
    await f.store.db
      .prepare("SELECT COUNT(*) AS n FROM native_buffer_blob_chunks WHERE sha256=?")
      .get(sha(f.b)),
  ).toMatchObject({ n: 0 });
  expect(await collectOrphanNativeBufferBlobs(f.store)).toMatchObject({
    orphanBlobs: 0,
    deletedBlobs: 0,
  });
  expect(await blobCount(f.store)).toBe(3);
  const dangling = await f.store.db
    .prepare(`SELECT COUNT(*) AS n FROM (
      SELECT sha256 AS sha FROM native_buffer_artifacts
      UNION SELECT snapshot_digest FROM native_buffer_certificates
      UNION SELECT json_extract(r.value,'$.sha256') FROM native_buffer_certificates c,
        json_each(c.metadata_json,'$.artifacts') r
    ) WHERE sha NOT IN (SELECT sha256 FROM native_buffer_blobs)`)
    .get();
  expect(dangling).toMatchObject({ n: 0 });
  // Every reader still succeeds: the mutable head, the immutable history artifact and the
  // certificate, which re-reads A although the mutable key moved on.
  expect(await f.persistence.read(currentKey, 1024)).toEqual(f.c);
  expect(await f.persistence.read(historyKey, 1024)).toEqual(f.h);
  const certified = await f.persistence.readCertificate(
    { reportId, reportVersion: 1, snapshotDigest: f.certificate.snapshotDigest },
    1024,
  );
  expect(certified?.raw).toEqual(f.a);
});

it("keeps the directory index rebuild and later completes working after GC", async () => {
  const f = await seeded();
  await collectOrphanNativeBufferBlobs(f.store);
  // Force prepareDirectoryIndex to rebuild from artifacts and certificate provenance.
  await f.store.db.prepare("DELETE FROM native_buffer_directory_index").run();
  const b = Buffer.from('{"version":"B-orphan"}');
  await f.persistence.complete({
    writes: [{ key: currentKey, bytes: b, immutable: false }],
    certificates: [],
    authorize: f.authorize,
  });
  expect(await f.persistence.read(currentKey, 1024)).toEqual(b);
  const listing = await f.persistence.entries("native-activity/buffers", null, 10);
  expect(listing.entries).toEqual([{ name: `${reportId}.json`, isDirectory: false }]);
  expect(await f.persistence.hasEntry(`native-activity/buffer-history/reports`, reportId)).toBe(
    true,
  );
});

it("never loses a blob that a concurrent complete() references again", async () => {
  const f = await seeded();
  await Promise.all([
    collectOrphanNativeBufferBlobs(f.store),
    f.persistence.complete({
      writes: [{ key: currentKey, bytes: f.b, immutable: false }],
      certificates: [],
      authorize: f.authorize,
    }),
  ]);
  expect(await f.persistence.read(currentKey, 1024)).toEqual(f.b);
});

it("skips the pass and logs once when a certificate is unreadable", async () => {
  const f = await seeded();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  await f.store.db.prepare("UPDATE native_buffer_certificates SET metadata_json='{'").run();
  for (let pass = 0; pass < 2; pass++)
    expect(await collectOrphanNativeBufferBlobs(f.store)).toMatchObject({
      skipped: "unreadable-certificate",
      deletedBlobs: 0,
    });
  expect(await blobCount(f.store)).toBe(4);
  expect(warn).toHaveBeenCalledTimes(1);
});

it("treats a certificate reference without a sha256 as unreadable", async () => {
  const f = await seeded();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  await f.store.db
    .prepare(
      "UPDATE native_buffer_certificates SET metadata_json=json_set(metadata_json,'$.artifacts[0].sha256',NULL)",
    )
    .run();
  expect(await collectOrphanNativeBufferBlobs(f.store)).toMatchObject({
    skipped: "unreadable-certificate",
    deletedBlobs: 0,
  });
  expect(await blobCount(f.store)).toBe(4);
});

it("does nothing before the native buffer schema exists", async () => {
  const f = await fixture();
  expect(await collectOrphanNativeBufferBlobs(f.store)).toEqual({
    orphanBlobs: 0,
    orphanBytes: 0,
    deletedBlobs: 0,
    deletedBytes: 0,
    skipped: "missing-tables",
  });
});
