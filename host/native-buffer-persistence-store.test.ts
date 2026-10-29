import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "./store";
import { createNativeBufferPersistenceStore } from "./native-buffer-persistence-store";
import {
  NATIVE_BUFFER_ARTIFACT_MAX_BYTES as MAX,
  type NativeBufferClockState,
  type NativeBufferCompletionCertificate,
} from "./ports/native-buffer-persistence";

const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const reportId = "a".repeat(64);
const currentKey = `native-activity/buffers/${reportId}.json`;
const historyKey = "native-activity/buffer-history/chunks/original.bin";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function fixture() {
  const base = resolve("temp/verification/2026-10-29-buffer-retained-store/fixtures");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "sql-")),
    path = join(root, "host.db");
  let store = new HostStore(path),
    allowed = true,
    persistence = createNativeBufferPersistenceStore(store);
  const device = await store.issueDevice("retained-source fixture");
  const authorize = async () => {
    if (!allowed || !(await store.authenticated(device.token)) || !allowed)
      throw new Error("Fixture authority revoked");
  };
  const f = {
    root,
    authorize,
    get store() {
      return store;
    },
    get persistence() {
      return persistence;
    },
    setAllowed(value: boolean) {
      allowed = value;
    },
    async reopen() {
      await store.close();
      store = new HostStore(path);
      await store.authenticated(device.token);
      persistence = createNativeBufferPersistenceStore(store);
    },
    async close() {
      await store.close();
      if (!resolve(root).startsWith(base + sep)) throw new Error("Unsafe fixture cleanup");
      await rm(root, { recursive: true, force: true, maxRetries: 5 });
    },
  };
  cleanups.push(f.close);
  return f;
}
function clock(base = 0): NativeBufferClockState {
  const clockId = randomUUID();
  return {
    version: 1,
    reportId,
    clockId,
    base,
    highWater: base,
    digest: sha(`${base.toString().padStart(16, "0")}|${clockId}|${"0".repeat(64)}`),
  };
}
function advance(state: NativeBufferClockState): NativeBufferClockState {
  const highWater = state.highWater + 1;
  return {
    ...state,
    highWater,
    digest: sha(`${highWater.toString().padStart(16, "0")}|${state.clockId}|${state.digest}`),
  };
}
async function reserved(f: Awaited<ReturnType<typeof fixture>>) {
  const initial = clock(),
    next = advance(initial);
  await f.persistence.initializeClock(initial, f.authorize);
  await f.persistence.advanceClock(initial, next, f.authorize);
  return next;
}
const ref = (key: string, raw: Buffer) => ({ key, sha256: sha(raw), byteLength: raw.length });
function source(
  state: NativeBufferClockState,
  raw = Buffer.from('\ufeff { "recovery": { "reportVersion": 1 }, "owners": [] }\n'),
): NativeBufferCompletionCertificate {
  return {
    reportId,
    reportVersion: state.highWater,
    snapshotDigest: sha(raw),
    byteLength: raw.length,
    clockId: state.clockId,
    raw,
    artifacts: [ref(currentKey, raw), ref(historyKey, raw)],
    originalDelivery: {
      originalId: "original",
      sha256: sha("{}"),
      byteLength: 2,
      principalId: sha("paired"),
      environmentId: "original-host",
    },
  };
}
const identity = (certificate: NativeBufferCompletionCertificate) => ({
  reportId: certificate.reportId,
  reportVersion: certificate.reportVersion,
  snapshotDigest: certificate.snapshotDigest,
});
const writes = (certificate: NativeBufferCompletionCertificate) => [
  { key: currentKey, bytes: certificate.raw, immutable: false },
  { key: historyKey, bytes: certificate.raw, immutable: true },
];

it("keeps all missing-schema reads mutation-free and bounds/normalizes generated keys", async () => {
  const f = await fixture(),
    before = f.store.db.dataMutationVersion;
  expect(await f.persistence.directoryView()).toBe(0);
  expect(await f.persistence.readClock(reportId)).toBeNull();
  expect(await f.persistence.read(currentKey, MAX)).toBeNull();
  expect(await f.persistence.entries("native-activity/buffers", null, 10)).toEqual({
    entries: [],
    nextAfter: null,
  });
  expect(await f.persistence.hasEntry("native-activity/buffers", reportId + ".json")).toBe(false);
  expect(
    await f.persistence.readCertificate(
      { reportId, reportVersion: 1, snapshotDigest: "b".repeat(64) },
      MAX,
    ),
  ).toBeNull();
  expect(f.store.db.dataMutationVersion).toBe(before);
  expect(
    await f.store.db
      .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'native_buffer_%'")
      .all(),
  ).toEqual([]);
  for (const key of [
    "/native-activity/buffers/a",
    "native-activity/buffers/../private",
    "native-activity\\buffers\\a",
    "native-activity/buffer-history/clocks/a",
    "C:/private",
    "native-activity/buffers//a",
  ]) {
    await expect(f.persistence.read(key, MAX)).rejects.toThrow();
  }
});

it("retains exact BOM/whitespace bytes and complete original metadata across actual file DB reopen without FS caches", async () => {
  const f = await fixture(),
    state = await reserved(f),
    certificate = source(state);
  await f.persistence.complete({
    writes: writes(certificate),
    certificates: [certificate],
    authorize: f.authorize,
  });
  await f.reopen();
  expect(await f.persistence.read(currentKey, MAX)).toEqual(certificate.raw);
  expect(await f.persistence.read(historyKey, MAX)).toEqual(certificate.raw);
  const before = f.store.db.dataMutationVersion;
  const retained = await f.persistence.readCertificate(identity(certificate), MAX);
  expect(retained).toEqual({
    ...certificate,
    artifacts: [...certificate.artifacts].sort((a, b) => a.key.localeCompare(b.key)),
  });
  expect(retained?.raw.subarray(0, 3)).toEqual(Buffer.from([239, 187, 191]));
  expect(f.store.db.dataMutationVersion).toBe(before);
  expect(
    (await f.store.db.prepare("SELECT COUNT(*) AS count FROM native_buffer_blobs").get())?.count,
  ).toBe(1);
});

it("stores chunks and certificate atomically in one FULL completion rather than per piece", async () => {
  const f = await fixture(),
    state = await reserved(f),
    certificate = source(state, Buffer.alloc(2 * 1024 * 1024 + 9, 120));
  const exec = f.store.db.exec.bind(f.store.db),
    modes: number[] = [];
  vi.spyOn(f.store.db, "exec").mockImplementation(async (sql) => {
    if (sql === "COMMIT")
      modes.push(Number((await f.store.db.prepare("PRAGMA synchronous").get())?.synchronous));
    return exec(sql);
  });
  await f.persistence.complete({
    writes: writes(certificate),
    certificates: [certificate],
    authorize: f.authorize,
  });
  expect(modes).toEqual([2]);
  expect(
    await f.store.db
      .prepare(
        "SELECT MAX(length(data)) AS largest,COUNT(*) AS chunks FROM native_buffer_blob_chunks",
      )
      .get(),
  ).toEqual({ largest: 65536, chunks: 33 });
  expect((await f.store.db.prepare("PRAGMA synchronous").get())?.synchronous).toBe(1);
});

it("keeps reserved gaps when completion rolls back and retains every atom after a lost completion COMMIT ACK", async () => {
  const f = await fixture(),
    state = await reserved(f),
    certificate = source(state);
  const exec = f.store.db.exec.bind(f.store.db);
  vi.spyOn(f.store.db, "exec").mockImplementation(async (sql) => {
    if (sql === "COMMIT") throw new Error("Before completion commit");
    return exec(sql);
  });
  await expect(
    f.persistence.complete({
      writes: writes(certificate),
      certificates: [certificate],
      authorize: f.authorize,
    }),
  ).rejects.toThrow("Before completion");
  vi.restoreAllMocks();
  await f.reopen();
  expect(await f.persistence.readClock(reportId)).toEqual(state);
  expect(await f.persistence.read(currentKey, MAX)).toBeNull();
  expect(await f.persistence.readCertificate(identity(certificate), MAX)).toBeNull();
  const commit = f.store.db.exec.bind(f.store.db);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(f.store.db, "exec").mockImplementation(async (sql) => {
    await commit(sql);
    if (sql === "COMMIT") throw new Error("Lost completion commit ACK");
  });
  await expect(
    f.persistence.complete({
      writes: writes(certificate),
      certificates: [certificate],
      authorize: f.authorize,
    }),
  ).rejects.toThrow("Lost completion");
  vi.restoreAllMocks();
  await f.reopen();
  expect((await f.persistence.readCertificate(identity(certificate), MAX))?.raw).toEqual(
    certificate.raw,
  );
  expect(await f.persistence.readClock(reportId)).toEqual(state);
});

it("adopts the final legacy artifacts and initial SQL floor in the same critical commit", async () => {
  const f = await fixture(),
    initial = advance(clock()),
    certificate = source(initial);
  await f.persistence.complete({
    writes: [
      {
        key: "native-activity/buffer-history/legacy.json",
        bytes: Buffer.from("legacy"),
        immutable: true,
      },
    ],
    certificates: [],
    authorize: f.authorize,
  });
  expect(await f.persistence.readClock(reportId)).toBeNull();
  const exec = f.store.db.exec.bind(f.store.db);
  vi.spyOn(f.store.db, "exec").mockImplementation(async (sql) => {
    if (sql === "COMMIT") throw new Error("Before adoption commit");
    return exec(sql);
  });
  await expect(
    f.persistence.complete({
      writes: writes(certificate),
      certificates: [certificate],
      initializeClocks: [initial],
      authorize: f.authorize,
    }),
  ).rejects.toThrow();
  vi.restoreAllMocks();
  await f.reopen();
  expect(await f.persistence.readClock(reportId)).toBeNull();
  expect(await f.persistence.read(currentKey, MAX)).toBeNull();
  expect(await f.persistence.read("native-activity/buffer-history/legacy.json", MAX)).toEqual(
    Buffer.from("legacy"),
  );
  await f.persistence.complete({
    writes: writes(certificate),
    certificates: [certificate],
    initializeClocks: [initial],
    authorize: f.authorize,
  });
  await f.reopen();
  expect(await f.persistence.readClock(reportId)).toEqual(initial);
  expect((await f.persistence.readCertificate(identity(certificate), MAX))?.raw).toEqual(
    certificate.raw,
  );
});

it("CAS-protects immutable clock identity/base, initialization races and a consumed lost advance ACK", async () => {
  const f = await fixture(),
    first = clock(),
    second = clock();
  const attempts = await Promise.allSettled([
    f.persistence.initializeClock(first, f.authorize),
    f.persistence.initializeClock(second, f.authorize),
  ]);
  expect(attempts.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
  const current = (await f.persistence.readClock(reportId))!;
  expect(await f.persistence.initializeClock(current, f.authorize)).toEqual(current);
  await expect(
    f.persistence.initializeClock(
      { ...current, base: current.base + 1, highWater: current.highWater + 1 },
      f.authorize,
    ),
  ).rejects.toThrow();
  const next = advance(current),
    exec = f.store.db.exec.bind(f.store.db);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(f.store.db, "exec").mockImplementation(async (sql) => {
    await exec(sql);
    if (sql === "COMMIT") throw new Error("Lost reserve ACK");
  });
  await expect(f.persistence.advanceClock(current, next, f.authorize)).rejects.toThrow(
    "Lost reserve",
  );
  vi.restoreAllMocks();
  await f.reopen();
  expect(await f.persistence.readClock(reportId)).toEqual(next);
  await expect(f.persistence.advanceClock(current, next, f.authorize)).rejects.toThrow();
  await expect(
    f.persistence.advanceClock(next, { ...advance(next), digest: "c".repeat(64) }, f.authorize),
  ).rejects.toThrow();
  const following = advance(next);
  expect(await f.persistence.advanceClock(next, following, f.authorize)).toEqual(following);
});

it("never rebuilds a missing/corrupt SQL floor from certificates or surviving data", async () => {
  const f = await fixture(),
    state = await reserved(f),
    certificate = source(state);
  await f.persistence.complete({
    writes: writes(certificate),
    certificates: [certificate],
    authorize: f.authorize,
  });
  await f.store.db.prepare("DELETE FROM native_buffer_clocks WHERE report_id=?").run(reportId);
  await f.reopen();
  await expect(f.persistence.readClock(reportId)).rejects.toThrow();
  await expect(f.persistence.initializeClock(state, f.authorize)).rejects.toThrow();
  await expect(f.persistence.readCertificate(identity(certificate), MAX)).rejects.toThrow();
  await f.store.db
    .prepare("DELETE FROM native_buffer_clock_witnesses WHERE report_id=?")
    .run(reportId);
  await expect(f.persistence.readClock(reportId)).rejects.toThrow();
  expect(await f.persistence.read(currentKey, MAX)).toEqual(certificate.raw);
});

it("rejects corrupted clock witnesses, artifact metadata and chunks without repair or unbounded allocations", async () => {
  const f = await fixture(),
    state = await reserved(f),
    certificate = source(state);
  await f.persistence.complete({
    writes: writes(certificate),
    certificates: [certificate],
    authorize: f.authorize,
  });
  await f.store.db
    .prepare("UPDATE native_buffer_clocks SET state_json=? WHERE report_id=?")
    .run("{invalid", reportId);
  await expect(f.persistence.readClock(reportId)).rejects.toThrow("corrupt");
  await f.store.db
    .prepare("UPDATE native_buffer_clocks SET state_json=? WHERE report_id=?")
    .run(JSON.stringify(advance(state)), reportId);
  await expect(f.persistence.readClock(reportId)).rejects.toThrow();
  await f.store.db
    .prepare("UPDATE native_buffer_clocks SET state_json=? WHERE report_id=?")
    .run(JSON.stringify(state), reportId);
  await f.store.db
    .prepare("UPDATE native_buffer_artifacts SET byte_length=? WHERE key=?")
    .run(MAX + 1, currentKey);
  const allocate = vi.spyOn(Buffer, "alloc");
  await expect(f.persistence.read(currentKey, MAX)).rejects.toThrow();
  expect(allocate).not.toHaveBeenCalled();
  allocate.mockRestore();
  await f.store.db
    .prepare("UPDATE native_buffer_artifacts SET byte_length=? WHERE key=?")
    .run(certificate.raw.length, currentKey);
  await f.store.db
    .prepare("UPDATE native_buffer_blob_chunks SET data=? WHERE sha256=? AND chunk_index=0")
    .run(Buffer.alloc(certificate.raw.length, 33), certificate.snapshotDigest);
  const before = f.store.db.dataMutationVersion;
  await expect(f.persistence.read(currentKey, MAX)).rejects.toThrow();
  await expect(f.persistence.readCertificate(identity(certificate), MAX)).rejects.toThrow();
  expect(f.store.db.dataMutationVersion).toBe(before);
});

it("rolls back conflicting immutable writes, incomplete dependency sets and wrong clock certificates", async () => {
  const f = await fixture(),
    state = await reserved(f),
    certificate = source(state);
  await expect(
    f.persistence.complete({
      writes: writes(certificate),
      certificates: [
        {
          ...certificate,
          artifacts: [
            ...certificate.artifacts,
            {
              key: "native-activity/buffer-history/missing",
              sha256: sha("missing"),
              byteLength: 7,
            },
          ],
        },
      ],
      authorize: f.authorize,
    }),
  ).rejects.toThrow();
  expect(await f.persistence.read(currentKey, MAX)).toBeNull();
  await expect(
    f.persistence.complete({
      writes: writes(certificate),
      certificates: [{ ...certificate, clockId: randomUUID() }],
      authorize: f.authorize,
    }),
  ).rejects.toThrow();
  expect(await f.persistence.read(historyKey, MAX)).toBeNull();
  await f.persistence.complete({
    writes: writes(certificate),
    certificates: [certificate],
    authorize: f.authorize,
  });
  await expect(
    f.persistence.complete({
      writes: [
        { key: currentKey, bytes: Buffer.from("changed head"), immutable: false },
        { key: historyKey, bytes: Buffer.from("conflict"), immutable: true },
      ],
      certificates: [],
      authorize: f.authorize,
    }),
  ).rejects.toThrow();
  expect(await f.persistence.read(currentKey, MAX)).toEqual(certificate.raw);
  await expect(
    f.persistence.complete({
      writes: [],
      certificates: [{ ...certificate, artifacts: [] }],
      authorize: f.authorize,
    }),
  ).rejects.toThrow();
});

it("keeps old exact certificates through sameversion alternate digests and later version head advances", async () => {
  const f = await fixture(),
    state = await reserved(f),
    old = source(state);
  await f.persistence.complete({
    writes: writes(old),
    certificates: [old],
    authorize: f.authorize,
  });
  const next = source(state, Buffer.from("new exact retained body"));
  next.artifacts = [ref(currentKey, next.raw)];
  await f.persistence.complete({
    writes: [{ key: currentKey, bytes: next.raw, immutable: false }],
    certificates: [next],
    authorize: f.authorize,
  });
  const laterState = advance(state);
  await f.persistence.advanceClock(state, laterState, f.authorize);
  const later = source(laterState, Buffer.from("version two exact retained body"));
  later.artifacts = [ref(currentKey, later.raw)];
  await f.persistence.complete({
    writes: [{ key: currentKey, bytes: later.raw, immutable: false }],
    certificates: [later],
    authorize: f.authorize,
  });
  await f.reopen();
  expect((await f.persistence.readCertificate(identity(old), MAX))?.raw).toEqual(old.raw);
  expect((await f.persistence.readCertificate(identity(next), MAX))?.raw).toEqual(next.raw);
  expect((await f.persistence.readCertificate(identity(later), MAX))?.raw).toEqual(later.raw);
  expect(await f.persistence.read(currentKey, MAX)).toEqual(later.raw);
  expect(
    (await f.store.db.prepare("SELECT COUNT(*) AS count FROM native_buffer_certificates").get())
      ?.count,
  ).toBe(3);
});

it("freezes borrowed raw bytes before waiting for authorization or storage admission", async () => {
  const f = await fixture(),
    state = await reserved(f),
    certificate = source(state),
    expected = Buffer.from(certificate.raw);
  const pending = f.persistence.complete({
    writes: writes(certificate),
    certificates: [certificate],
    authorize: f.authorize,
  });
  certificate.raw.fill(33);
  await pending;
  expect(await f.persistence.read(currentKey, MAX)).toEqual(expected);
  expect((await f.persistence.readCertificate(identity(certificate), MAX))?.raw).toEqual(expected);
});

it("rechecks actual authorization after admitted awaits and rolls back every tentative chunk", async () => {
  const f = await fixture(),
    state = await reserved(f),
    certificate = source(state, Buffer.alloc(130_000, 120));
  const prepare = f.store.db.prepare.bind(f.store.db);
  vi.spyOn(f.store.db, "prepare").mockImplementation((sql) => {
    const statement = prepare(sql);
    if (sql === "INSERT INTO native_buffer_blob_chunks VALUES (?,?,?,?)") {
      const run = statement.run.bind(statement);
      vi.spyOn(statement, "run").mockImplementation(async (...params) => {
        const result = await run(...params);
        f.setAllowed(false);
        return result;
      });
    }
    return statement;
  });
  await expect(
    f.persistence.complete({
      writes: writes(certificate),
      certificates: [certificate],
      authorize: f.authorize,
    }),
  ).rejects.toThrow("revoked");
  vi.restoreAllMocks();
  f.setAllowed(true);
  await f.reopen();
  expect(await f.persistence.read(currentKey, MAX)).toBeNull();
  expect(await f.persistence.readCertificate(identity(certificate), MAX)).toBeNull();
  expect(
    (await f.store.db.prepare("SELECT COUNT(*) AS count FROM native_buffer_blobs").get())?.count,
  ).toBe(0);
  f.setAllowed(false);
  await expect(f.persistence.advanceClock(state, advance(state), f.authorize)).rejects.toThrow(
    "revoked",
  );
  expect(await f.persistence.readClock(reportId)).toEqual(state);
});

it("paginates metadata/virtual directories and exact child membership without reading any body", async () => {
  const f = await fixture(),
    body = Buffer.from("uncertified legacy retention");
  const retained = Array.from({ length: 43 }, (_, index) => ({
    key: `native-activity/buffer-history/reports/${index.toString().padStart(3, "0")}/snapshot.json`,
    bytes: body,
    immutable: true,
  }));
  await f.persistence.complete({ writes: retained, certificates: [], authorize: f.authorize });
  const allocate = vi.spyOn(Buffer, "alloc");
  expect(await f.persistence.hasEntry("native-activity/buffer-history", "reports")).toBe(true);
  expect(await f.persistence.hasEntry("native-activity/buffer-history", "report")).toBe(false);
  expect(
    await f.persistence.hasEntry("native-activity/buffer-history/reports/000", "snapshot.json"),
  ).toBe(true);
  let after: string | null = null;
  const names: string[] = [],
    before = f.store.db.dataMutationVersion;
  do {
    const page = await f.persistence.entries("native-activity/buffer-history/reports", after, 7);
    expect(page.entries.length).toBeLessThanOrEqual(7);
    expect(page.entries.every((entry) => entry.isDirectory)).toBe(true);
    names.push(...page.entries.map((entry) => entry.name));
    after = page.nextAfter;
  } while (after !== null);
  expect(names).toEqual(
    Array.from({ length: 43 }, (_, index) => index.toString().padStart(3, "0")),
  );
  expect(f.store.db.dataMutationVersion).toBe(before);
  expect(allocate).not.toHaveBeenCalled();
  allocate.mockRestore();
  expect(await f.persistence.readClock(reportId)).toBeNull();
  expect(
    (await f.store.db.prepare("SELECT COUNT(*) AS count FROM native_buffer_blobs").get())?.count,
  ).toBe(1);
});

it("preserves the full64MiB artifact capacity and deduplicates repeated input before charging the384MiB internal batch", async () => {
  const f = await fixture(),
    body = Buffer.alloc(MAX, 120);
  await f.persistence.complete({
    writes: Array.from({ length: 8 }, (_, index) => ({
      key: `native-activity/buffers/${index.toString(16).padStart(64, "0")}.json`,
      bytes: body,
      immutable: false,
    })),
    certificates: [],
    authorize: f.authorize,
  });
  const key = `native-activity/buffers/${"0".repeat(64)}.json`;
  await expect(f.persistence.read(key, MAX - 1)).rejects.toThrow();
  expect(sha((await f.persistence.read(key, MAX))!)).toBe(sha(body));
  expect(
    (await f.store.db.prepare("SELECT COUNT(*) AS count FROM native_buffer_blobs").get())?.count,
  ).toBe(1);
  expect(
    (await f.store.db.prepare("SELECT COUNT(*) AS count FROM native_buffer_blob_chunks").get())
      ?.count,
  ).toBe(1024);
});

it("rejects oversized artifacts and unsupported mutable/traversal writes before creating storage", async () => {
  const f = await fixture(),
    oversized = Buffer.alloc(MAX + 1);
  const before = f.store.db.dataMutationVersion;
  await expect(
    f.persistence.complete({
      writes: [{ key: currentKey, bytes: oversized, immutable: false }],
      certificates: [],
      authorize: f.authorize,
    }),
  ).rejects.toThrow();
  for (const key of [
    historyKey,
    "native-activity/buffers/not-report.json",
    "native-activity/buffer-history/clocks/current",
    "native-activity/buffer-history/../escape",
  ]) {
    await expect(
      f.persistence.complete({
        writes: [{ key, bytes: Buffer.from("x"), immutable: false }],
        certificates: [],
        authorize: f.authorize,
      }),
    ).rejects.toThrow();
  }
  expect(f.store.db.dataMutationVersion).toBe(before);
});

it("bounds the full distinct referenced set before SQL or body allocation, including stored certificate metadata", async () => {
  const f = await fixture(),
    state = await reserved(f),
    certificate = source(state);
  const tooLarge = Array.from({ length: 7 }, (_, index) => ({
    key: `native-activity/buffer-history/large-${index}`,
    sha256: sha(`large-${index}`),
    byteLength: MAX,
  }));
  const before = f.store.db.dataMutationVersion;
  await expect(
    f.persistence.complete({
      writes: writes(certificate),
      certificates: [{ ...certificate, artifacts: tooLarge }],
      authorize: f.authorize,
    }),
  ).rejects.toThrow();
  expect(f.store.db.dataMutationVersion).toBe(before);
  await f.persistence.complete({
    writes: writes(certificate),
    certificates: [certificate],
    authorize: f.authorize,
  });
  const { raw: _raw, ...metadata } = certificate;
  await f.store.db
    .prepare("UPDATE native_buffer_certificates SET metadata_json=? WHERE report_id=?")
    .run(JSON.stringify({ ...metadata, artifacts: tooLarge }), reportId);
  const prepare = vi.spyOn(f.store.db, "prepare");
  const allocate = vi.spyOn(Buffer, "alloc");
  await expect(f.persistence.readCertificate(identity(certificate), MAX)).rejects.toThrow(
    "corrupt",
  );
  expect(prepare.mock.calls.every(([sql]) => !sql.includes("FROM native_buffer_blobs"))).toBe(true);
  expect(allocate).not.toHaveBeenCalled();
});

it("keeps a directory view fixed across later file/virtual-directory discovery without changing existing head rowids", async () => {
  const f = await fixture(),
    first = Buffer.from("first");
  await f.persistence.complete({
    writes: [
      { key: currentKey, bytes: first, immutable: false },
      {
        key: "native-activity/buffer-history/reports/old/source.json",
        bytes: first,
        immutable: true,
      },
    ],
    certificates: [],
    authorize: f.authorize,
  });
  const view = await f.persistence.directoryView();
  expect(view).toBeGreaterThan(0);
  await f.persistence.complete({
    writes: [
      { key: currentKey, bytes: Buffer.from("new head"), immutable: false },
      {
        key: "native-activity/buffer-history/reports/new/source.json",
        bytes: first,
        immutable: true,
      },
      { key: "native-activity/buffer-history/reports/direct.json", bytes: first, immutable: true },
    ],
    certificates: [],
    authorize: f.authorize,
  });
  expect(await f.persistence.directoryView()).toBeGreaterThan(view);
  const before = f.store.db.dataMutationVersion,
    allocate = vi.spyOn(Buffer, "alloc");
  expect(
    await f.persistence.entries("native-activity/buffer-history/reports", null, 10, view),
  ).toEqual({ entries: [{ name: "old", isDirectory: true }], nextAfter: null });
  expect(await f.persistence.hasEntry("native-activity/buffer-history/reports", "new", view)).toBe(
    false,
  );
  expect(
    await f.persistence.hasEntry("native-activity/buffer-history/reports", "direct.json", view),
  ).toBe(false);
  expect(await f.persistence.hasEntry("native-activity/buffer-history/reports", "new")).toBe(true);
  expect(await f.persistence.hasEntry("native-activity/buffers", reportId + ".json", view)).toBe(
    true,
  );
  expect(await f.persistence.entries("native-activity/buffers", null, 10, 0)).toEqual({
    entries: [],
    nextAfter: null,
  });
  expect(f.store.db.dataMutationVersion).toBe(before);
  expect(allocate).not.toHaveBeenCalled();
  allocate.mockRestore();
  expect(await f.persistence.read(currentKey, MAX)).toEqual(Buffer.from("new head"));
  await expect(f.persistence.entries("native-activity/buffers", null, 10, -1)).rejects.toThrow();
  await expect(
    f.persistence.hasEntry(
      "native-activity/buffers",
      reportId + ".json",
      Number.MAX_SAFE_INTEGER + 1,
    ),
  ).rejects.toThrow();
});

it("backfills missing directory metadata only in FULL mutations and pages a large prefix through the bounded rowid index", async () => {
  const f = await fixture(),
    body = Buffer.from("x"),
    directory = "native-activity/buffer-history/reports";
  await f.persistence.complete({
    writes: [{ key: directory + "/z-original.json", bytes: body, immutable: true }],
    certificates: [],
    authorize: f.authorize,
  });
  const oldView = await f.persistence.directoryView();
  expect(oldView).toBe(1);
  await f.store.transaction(async () => {
    await f.store.db
      .prepare(`WITH RECURSIVE rows(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM rows WHERE n<3000)
      INSERT INTO native_buffer_artifacts SELECT ?||printf('/n-%04d.json',n),?,1,1 FROM rows`)
      .run(directory, sha(body));
    await f.store.db.exec(
      "DROP TABLE native_buffer_directory_children; DROP TABLE native_buffer_directory_index;",
    );
  });
  const before = f.store.db.dataMutationVersion;
  await expect(f.persistence.entries(directory, null, 32)).rejects.toThrow("corrupt");
  await expect(f.persistence.hasEntry(directory, "z-original.json")).rejects.toThrow("corrupt");
  await expect(f.persistence.directoryView()).rejects.toThrow("corrupt");
  expect(f.store.db.dataMutationVersion).toBe(before);
  const exec = f.store.db.exec.bind(f.store.db),
    modes: number[] = [];
  vi.spyOn(f.store.db, "exec").mockImplementation(async (sql) => {
    if (sql === "COMMIT")
      modes.push(Number((await f.store.db.prepare("PRAGMA synchronous").get())?.synchronous));
    return exec(sql);
  });
  await f.persistence.complete({ writes: [], certificates: [], authorize: f.authorize });
  expect(modes).toEqual([2]);
  vi.restoreAllMocks();
  const view = await f.persistence.directoryView(),
    prepared = f.store.db.prepare.bind(f.store.db),
    returned: number[] = [];
  const queries = vi.spyOn(f.store.db, "prepare").mockImplementation((sql) => {
    const statement = prepared(sql);
    if (sql.includes("INDEXED BY native_buffer_directory_order")) {
      const all = statement.all.bind(statement);
      vi.spyOn(statement, "all").mockImplementation(async (...params) => {
        const rows = await all(...params);
        returned.push(rows.length);
        return rows;
      });
    }
    return statement;
  });
  const page = await f.persistence.entries(directory, null, 32, view);
  expect(page.entries).toHaveLength(32);
  expect(page.entries[0].name).toBe("z-original.json");
  expect(page.nextAfter).toBe("directory-rowid:32");
  expect((await f.persistence.entries(directory, page.nextAfter, 32, view)).entries[0].name).toBe(
    "n-0032.json",
  );
  expect(await f.persistence.entries(directory, null, 32, oldView)).toEqual({
    entries: [{ name: "z-original.json", isDirectory: false }],
    nextAfter: null,
  });
  expect(await f.persistence.entries(directory, null, 32, 0)).toEqual({
    entries: [],
    nextAfter: null,
  });
  expect(await f.persistence.hasEntry(directory, "n-3000.json", oldView)).toBe(false);
  expect(await f.persistence.hasEntry(directory, "n-3000.json", view)).toBe(true);
  expect(returned.every((count) => count <= 33)).toBe(true);
  expect(
    queries.mock.calls.every(
      ([sql]) => !sql.includes("FROM native_buffer_artifacts") && !/GROUP\s+BY|substr\(/i.test(sql),
    ),
  ).toBe(true);
  queries.mockRestore();
  const plan = await f.store.db
    .prepare(`EXPLAIN QUERY PLAN SELECT name,is_directory,first_artifact_rowid
    FROM native_buffer_directory_children INDEXED BY native_buffer_directory_order
    WHERE directory=? AND first_artifact_rowid>? AND first_artifact_rowid<=? ORDER BY first_artifact_rowid LIMIT ?`)
    .all(directory, 0, view, 33);
  expect(plan.some((row) => /SEARCH.*native_buffer_directory_order/.test(String(row.detail)))).toBe(
    true,
  );
  expect(plan.every((row) => !/SCAN|TEMP B-TREE/.test(String(row.detail)))).toBe(true);
  await f.reopen();
  expect((await f.persistence.entries(directory, null, 32, oldView)).entries).toHaveLength(1);
});

it("rolls back a missing-index backfill failure and lets initialize mutation prepare the retained namespace", async () => {
  const f = await fixture(),
    state = await reserved(f),
    certificate = source(state);
  await f.persistence.complete({
    writes: writes(certificate),
    certificates: [certificate],
    authorize: f.authorize,
  });
  await f.store.transaction(() =>
    f.store.db.exec(
      "DROP TABLE native_buffer_directory_children; DROP TABLE native_buffer_directory_index;",
    ),
  );
  const exec = f.store.db.exec.bind(f.store.db);
  vi.spyOn(f.store.db, "exec").mockImplementation(async (sql) => {
    if (sql === "COMMIT") throw new Error("Before index migration commit");
    return exec(sql);
  });
  await expect(
    f.persistence.complete({ writes: [], certificates: [], authorize: f.authorize }),
  ).rejects.toThrow("Before index");
  vi.restoreAllMocks();
  await f.reopen();
  await expect(f.persistence.entries("native-activity/buffers", null, 10)).rejects.toThrow(
    "corrupt",
  );
  expect(await f.persistence.readClock(reportId)).toEqual(state);
  expect(await f.persistence.initializeClock(state, f.authorize)).toEqual(state);
  expect((await f.persistence.entries("native-activity/buffers", null, 10)).entries).toEqual([
    { name: reportId + ".json", isDirectory: false },
  ]);
});

it("rejects file/virtual-directory collisions in either order and bounds generated path depth", async () => {
  const f = await fixture(),
    base = "native-activity/buffer-history",
    bytes = Buffer.from("original");
  await f.persistence.complete({
    writes: [{ key: base + "/file", bytes, immutable: true }],
    certificates: [],
    authorize: f.authorize,
  });
  await expect(
    f.persistence.complete({
      writes: [{ key: base + "/file/child", bytes, immutable: true }],
      certificates: [],
      authorize: f.authorize,
    }),
  ).rejects.toThrow("corrupt");
  expect(await f.persistence.read(base + "/file/child", MAX)).toBeNull();
  await f.persistence.complete({
    writes: [{ key: base + "/folder/child", bytes, immutable: true }],
    certificates: [],
    authorize: f.authorize,
  });
  await expect(
    f.persistence.complete({
      writes: [{ key: base + "/folder", bytes, immutable: true }],
      certificates: [],
      authorize: f.authorize,
    }),
  ).rejects.toThrow("corrupt");
  expect(await f.persistence.read(base + "/folder/child", MAX)).toEqual(bytes);
  const valid =
    base + "/" + Array.from({ length: 13 }, (_, index) => "d" + index).join("/") + "/leaf";
  await f.persistence.complete({
    writes: [{ key: valid, bytes, immutable: true }],
    certificates: [],
    authorize: f.authorize,
  });
  const before = f.store.db.dataMutationVersion;
  await expect(
    f.persistence.complete({
      writes: [{ key: valid + "/deeper", bytes, immutable: true }],
      certificates: [],
      authorize: f.authorize,
    }),
  ).rejects.toThrow("corrupt");
  expect(f.store.db.dataMutationVersion).toBe(before);
});

it("holds a missing accepted head through its file witness and never erases certificate provenance while rebuilding an index", async () => {
  const f = await fixture(),
    state = await reserved(f),
    certificate = source(state);
  await f.persistence.complete({
    writes: writes(certificate),
    certificates: [certificate],
    authorize: f.authorize,
  });
  await f.store.db.prepare("DELETE FROM native_buffer_artifacts WHERE key=?").run(currentKey);
  await expect(f.persistence.read(currentKey, MAX)).rejects.toThrow("corrupt");
  expect(
    await f.persistence.read(`native-activity/buffers/${"b".repeat(64)}.json`, MAX),
  ).toBeNull();
  expect((await f.persistence.readCertificate(identity(certificate), MAX))?.raw).toEqual(
    certificate.raw,
  );
  await f.store.transaction(() =>
    f.store.db.exec(
      "DROP TABLE native_buffer_directory_children; DROP TABLE native_buffer_directory_index;",
    ),
  );
  await expect(
    f.persistence.complete({ writes: [], certificates: [], authorize: f.authorize }),
  ).rejects.toThrow("corrupt");
  await expect(f.persistence.read(currentKey, MAX)).rejects.toThrow("corrupt");
});

it("rejects noncanonical directory cursors and does not accept cursors beyond the frozen view", async () => {
  const f = await fixture();
  await f.persistence.complete({
    writes: [{ key: historyKey, bytes: Buffer.from("x"), immutable: true }],
    certificates: [],
    authorize: f.authorize,
  });
  for (const cursor of [
    "plain-name",
    "directory-rowid:0",
    "directory-rowid:01",
    "directory-rowid:-1",
    "directory-rowid:1\n",
    "directory-rowid:9007199254740992",
  ]) {
    await expect(
      f.persistence.entries("native-activity/buffer-history", cursor, 10),
    ).rejects.toThrow("corrupt");
  }
  await expect(
    f.persistence.entries("native-activity/buffer-history", "directory-rowid:2", 10, 1),
  ).rejects.toThrow("corrupt");
});
