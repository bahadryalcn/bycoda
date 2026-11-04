import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "./store";
import { createNativeDeliveryStore, nativeDeliveryConsumedResult } from "./native-delivery-store";
import { assertNativeDeliveryEffect } from "./native-delivery-epochs";
import { nativeDeliveryFixture } from "./native-delivery.test-support";
import {
  nativeDeliveryEpochOriginalId,
  type NativeDeliveryEpochRef,
} from "../src/shared/model/host-contracts/native-delivery-epochs";

const finish = "native.services.conversation.desktop.finish" as const;
const format = "native.services.workspace.format" as const;
const sha = (raw: string) => createHash("sha256").update(raw).digest("hex");
const result = { accepted: true };
const consumed = nativeDeliveryConsumedResult(finish, result);
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function fixture() {
  const base = resolve("temp/verification/2026-10-29-delivery-epochs-host/fixtures");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "epoch-")),
    path = join(root, "host.db");
  let store = new HostStore(path),
    journal = createNativeDeliveryStore(store);
  const credential = await store.issueDevice("Native epoch fixture"),
    principal = sha(credential.token),
    other = sha("another paired principal");
  const f = {
    root,
    path,
    principal,
    other,
    token: credential.token,
    get store() {
      return store;
    },
    get journal() {
      return journal;
    },
    async reopen() {
      await store.close();
      store = new HostStore(path);
      journal = createNativeDeliveryStore(store);
      await store.authenticated(credential.token);
    },
    async close() {
      await store.close().catch(() => {});
      if (!resolve(root).startsWith(base + sep)) throw new Error("Unsafe epoch fixture cleanup");
      await rm(root, { recursive: true, force: true, maxRetries: 5 });
    },
  };
  cleanups.push(f.close);
  return f;
}
function identity(epoch: NativeDeliveryEpochRef, sequence: number) {
  return {
    originalId: nativeDeliveryEpochOriginalId({ ...epoch, sequence }),
    sha256: sha("{}"),
    byteLength: 2,
  };
}
const legacy = () => ({ originalId: randomUUID(), sha256: sha("{}"), byteLength: 2 });
async function retire(
  f: Awaited<ReturnType<typeof fixture>>,
  epoch: NativeDeliveryEpochRef,
  sequence: number,
) {
  const id = identity(epoch, sequence);
  await f.journal.execute(f.principal, finish, id, async () => {
    await assertNativeDeliveryEffect(f.store, f.principal, finish);
    return result;
  });
  await f.journal.retire(f.principal, finish, id, consumed);
  return id;
}

it("opens an idempotent authenticated namespace with global monotonic generations and no active-peer rotation", async () => {
  const f = await fixture(),
    openId = randomUUID(),
    first = await f.journal.epochs.open(f.principal, openId);
  expect(first).toMatchObject({
    version: 2,
    openId,
    generation: 1,
    through: 0,
    highWater: 0,
    closed: false,
  });
  expect(await f.journal.epochs.open(f.principal, openId)).toEqual(first);
  const peer = await f.journal.epochs.open(f.principal, randomUUID());
  const foreign = await f.journal.epochs.open(f.other, openId);
  expect([peer.generation, foreign.generation]).toEqual([2, 3]);
  expect(peer.ownerId).not.toBe(first.ownerId);
  expect(await f.journal.epochs.status(f.principal, first)).toEqual(first);
  await f.reopen();
  expect(await f.journal.epochs.open(f.principal, openId)).toEqual(first);
  await expect(f.journal.epochs.status(f.other, first)).rejects.toThrow("UNAVAILABLE");
  await expect(
    f.journal.epochs.status(f.principal, { ...first, generation: first.generation + 1 }),
  ).rejects.toThrow("UNAVAILABLE");
  const environment = f.store.environmentId;
  f.store.environmentId = "different-environment";
  await expect(f.journal.epochs.status(f.principal, first)).rejects.toThrow("UNAVAILABLE");
  f.store.environmentId = environment;
});

it("single-flights concurrent identical opens and preserves independent explicit intents", async () => {
  const f = await fixture(),
    openId = randomUUID();
  const values = await Promise.all(
    Array.from({ length: 4 }, () => f.journal.epochs.open(f.principal, openId)),
  );
  expect(values.every((value) => JSON.stringify(value) === JSON.stringify(values[0]))).toBe(true);
  expect(
    (await f.store.db.prepare("SELECT COUNT(*) AS count FROM native_delivery_epochs").get())?.count,
  ).toBe(1);
  expect((await f.journal.epochs.open(f.principal, randomUUID())).generation).toBe(2);
});

it("compacts only a retired original, retains its irreversible fence and never repeats its effect", async () => {
  const f = await fixture(),
    epoch = await f.journal.epochs.open(f.principal, randomUUID()),
    id = identity(epoch, 1);
  let effects = 0;
  await f.journal.execute(f.principal, finish, id, async () => {
    effects++;
    await assertNativeDeliveryEffect(f.store, f.principal, finish);
    return result;
  });
  await f.journal.retire(f.principal, finish, id, consumed);
  expect(
    await f.journal.epochs.compact(f.principal, { ...epoch, expectedThrough: 0, through: 1 }),
  ).toMatchObject({ through: 1, highWater: 1, closed: false });
  expect(
    (await f.store.db.prepare("SELECT COUNT(*) AS count FROM native_delivery_receipts").get())
      ?.count,
  ).toBe(0);
  await f.reopen();
  const before = f.store.db.dataMutationVersion;
  expect(await f.journal.read(f.principal, finish, id)).toEqual({
    ...id,
    kind: finish,
    state: "fenced",
    epoch: { ownerId: epoch.ownerId, generation: epoch.generation, through: 1, closed: false },
  });
  expect(await f.journal.readMetadata(f.principal, finish, id)).toMatchObject({ state: "fenced" });
  expect(f.store.db.dataMutationVersion).toBe(before);
  await expect(
    f.journal.execute(f.principal, finish, id, async () => {
      effects++;
      return result;
    }),
  ).rejects.toThrow("FENCED");
  await expect(f.journal.record(f.principal, finish, id, result)).rejects.toThrow("FENCED");
  await expect(f.journal.retire(f.principal, finish, id, consumed)).rejects.toThrow("FENCED");
  await expect(
    f.journal.prepareProof(f.principal, id, {
      reportId: "a".repeat(64),
      reportVersion: 1,
      snapshotDigest: "b".repeat(64),
      byteLength: 1,
    }),
  ).rejects.toThrow();
  await expect(f.journal.readResult(f.principal, finish, id, consumed, 0, 1)).rejects.toThrow(
    "FENCED",
  );
  expect(effects).toBe(1);
});

it("requires a contiguous prefix across missing, recorded and admitted-unknown holes", async () => {
  const f = await fixture(),
    epoch = await f.journal.epochs.open(f.principal, randomUUID());
  await retire(f, epoch, 2);
  await expect(
    f.journal.epochs.compact(f.principal, { ...epoch, expectedThrough: 0, through: 2 }),
  ).rejects.toThrow("HOLE");
  const first = identity(epoch, 1);
  await f.journal.execute(f.principal, finish, first, async () => {
    throw new Error("Original handler result unknown");
  });
  expect(await f.journal.readMetadata(f.principal, finish, first)).toMatchObject({
    state: "admitted",
  });
  expect(
    (
      await f.store.db
        .prepare("SELECT reserved_bytes FROM native_delivery_receipts WHERE original_id=?")
        .get(first.originalId)
    )?.reserved_bytes,
  ).toBe(0);
  await expect(
    f.journal.epochs.compact(f.principal, { ...epoch, expectedThrough: 0, through: 2 }),
  ).rejects.toThrow("HOLE");
  await expect(f.journal.record(f.principal, finish, first, result)).rejects.toThrow(
    "not reserved",
  );
  await expect(
    f.journal.epochs.close(f.principal, { ...epoch, expectedThrough: 0, through: 2 }),
  ).rejects.toThrow("HOLE");
  expect((await f.journal.epochs.status(f.principal, epoch)).through).toBe(0);
  expect(
    (await f.store.db.prepare("SELECT COUNT(*) AS count FROM native_delivery_receipts").get())
      ?.count,
  ).toBe(2);
});

it("blocks recorded-but-unconsumed rows and stale floor CAS without deleting anything", async () => {
  const f = await fixture(),
    epoch = await f.journal.epochs.open(f.principal, randomUUID()),
    id = identity(epoch, 1);
  await f.journal.execute(f.principal, finish, id, async () => result);
  await expect(
    f.journal.epochs.compact(f.principal, { ...epoch, expectedThrough: 0, through: 1 }),
  ).rejects.toThrow("HOLE");
  await f.journal.retire(f.principal, finish, id, consumed);
  await f.journal.epochs.compact(f.principal, { ...epoch, expectedThrough: 0, through: 1 });
  await expect(
    f.journal.epochs.compact(f.principal, { ...epoch, expectedThrough: 0, through: 1 }),
  ).rejects.toThrow("CAS");
  await expect(
    f.journal.epochs.close(f.principal, { ...epoch, expectedThrough: 0, through: 1 }),
  ).rejects.toThrow("CAS");
  expect(
    await f.journal.epochs.compact(f.principal, { ...epoch, expectedThrough: 1, through: 1 }),
  ).toMatchObject({ through: 1 });
});

it("limits each contiguous advancement to32 and closes only the exact final high-water", async () => {
  const f = await fixture(),
    epoch = await f.journal.epochs.open(f.principal, randomUUID());
  for (let sequence = 1; sequence <= 33; sequence++) await retire(f, epoch, sequence);
  await expect(
    f.journal.epochs.compact(f.principal, { ...epoch, expectedThrough: 0, through: 33 }),
  ).rejects.toThrow("RANGE");
  await expect(
    f.journal.epochs.close(f.principal, { ...epoch, expectedThrough: 0, through: 32 }),
  ).rejects.toThrow("CLOSE");
  await f.journal.epochs.compact(f.principal, { ...epoch, expectedThrough: 0, through: 32 });
  const closed = await f.journal.epochs.close(f.principal, {
    ...epoch,
    expectedThrough: 32,
    through: 33,
  });
  expect(closed).toMatchObject({ closed: true, through: 33, highWater: 33 });
  expect(await f.journal.epochs.open(f.principal, epoch.openId)).toEqual(closed);
  await expect(f.journal.admit(f.principal, finish, identity(epoch, 34))).rejects.toThrow("FENCED");
  expect(await f.journal.readMetadata(f.principal, finish, identity(epoch, 34))).toMatchObject({
    state: "fenced",
    epoch: { closed: true },
  });
});

it("bounds admission relative to the compacted floor without manufacturing holes or rotating peers", async () => {
  const f = await fixture(),
    epoch = await f.journal.epochs.open(f.principal, randomUUID());
  await f.journal.admit(f.principal, finish, identity(epoch, 65536));
  await expect(f.journal.admit(f.principal, finish, identity(epoch, 65537))).rejects.toThrow(
    "WINDOW",
  );
  await expect(f.journal.admit(f.other, finish, identity(epoch, 1))).rejects.toThrow("UNAVAILABLE");
  await expect(
    f.journal.admit(
      f.principal,
      finish,
      identity({ ...epoch, generation: epoch.generation + 1 }, 1),
    ),
  ).rejects.toThrow("UNAVAILABLE");
  expect(await f.journal.epochs.open(f.principal, epoch.openId)).toMatchObject({
    ownerId: epoch.ownerId,
    generation: epoch.generation,
    through: 0,
    highWater: 65536,
    closed: false,
  });
});

it("keeps all finite kinds in one sequence while actual buffer proof gates retirement", async () => {
  const f = await nativeDeliveryFixture("2026-10-29-delivery-epochs-host");
  cleanups.push(f.close);
  const epoch = await f.journal.epochs.open(f.principal, randomUUID());
  const payloads = [
    JSON.stringify({ id: "actual-finish", result: null }),
    JSON.stringify({
      command: "format_text_file",
      args: { path: "/fixture/file", source: "x", cursorOffset: 0 },
    }),
    f.report(),
  ];
  for (let index = 0; index < payloads.length; index++) {
    const paramsJson = payloads[index],
      id = {
        ...identity(epoch, index + 1),
        sha256: sha(paramsJson),
        byteLength: Buffer.byteLength(paramsJson),
      };
    if (index < 2) {
      const target = index === 0 ? finish : format;
      expect(
        await f.call("native.services.delivery.apply", { ...id, target, paramsJson }),
      ).toMatchObject({ state: "recorded" });
      const row = await f.journal.readMetadata(f.principal, target, id);
      await f.call("native.services.delivery.ack", {
        ...id,
        target,
        consumedResult: row!.consumedResult,
      });
    } else {
      expect(await f.call("native.buffers.delivery.apply", { ...id, paramsJson })).toMatchObject({
        state: "recorded",
      });
      await f.call("native.buffers.delivery.ack", {
        ...id,
        consumedResult: nativeDeliveryConsumedResult("buffer", { acknowledged: true }),
      });
    }
  }
  expect(
    await f.journal.epochs.compact(f.principal, { ...epoch, expectedThrough: 0, through: 3 }),
  ).toMatchObject({ through: 3, highWater: 3 });
  expect(f.counts).toEqual({ buffers: 1, finish: 1, format: 1 });
});

it("establishes irreversible min-v2 while keeping existing legacy result/status/ACK compatibility", async () => {
  const f = await fixture(),
    before = legacy(),
    after = legacy();
  let effects = 0;
  await assertNativeDeliveryEffect(f.store, f.principal, finish);
  await f.journal.execute(f.principal, finish, before, async () => {
    effects++;
    return result;
  });
  await f.journal.epochs.open(f.principal, randomUUID());
  await f.journal.retire(f.principal, finish, before, consumed);
  expect(await f.journal.readMetadata(f.principal, finish, before)).toMatchObject({
    state: "retired",
  });
  await f.journal.execute(f.principal, finish, before, async () => {
    effects++;
    return result;
  });
  await expect(
    f.journal.execute(f.principal, finish, after, async () => {
      effects++;
      return result;
    }),
  ).rejects.toThrow("PROTOCOL_FENCED");
  await expect(assertNativeDeliveryEffect(f.store, f.principal, finish)).rejects.toThrow(
    "PROTOCOL_FENCED",
  );
  expect(await f.journal.readMetadata(f.principal, finish, after)).toBeNull();
  expect(effects).toBe(1);
  await f.reopen();
  await expect(f.journal.admit(f.principal, finish, legacy())).rejects.toThrow("PROTOCOL_FENCED");
});

it("permits only the actual v2 winner's matching live execution and invalidates escaped async continuations", async () => {
  const f = await fixture(),
    other = await fixture(),
    epoch = await f.journal.epochs.open(f.principal, randomUUID());
  await other.journal.epochs.open(f.principal, randomUUID());
  let release!: () => void, escaped!: Promise<void>;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  await f.journal.execute(f.principal, finish, identity(epoch, 1), async () => {
    await assertNativeDeliveryEffect(f.store, f.principal, finish);
    await expect(assertNativeDeliveryEffect(f.store, f.principal, format)).rejects.toThrow(
      "PROTOCOL_FENCED",
    );
    await expect(assertNativeDeliveryEffect(other.store, f.principal, finish)).rejects.toThrow(
      "PROTOCOL_FENCED",
    );
    escaped = gate.then(() => assertNativeDeliveryEffect(f.store, f.principal, finish));
    return result;
  });
  release();
  await expect(escaped).rejects.toThrow("PROTOCOL_FENCED");
  expect(Object.keys(f.journal.epochs).sort()).toEqual(["close", "compact", "open", "status"]);
});

it("rejects canonical aliases and old SQL writers before v2 receipt insertion", async () => {
  const f = await fixture(),
    epoch = await f.journal.epochs.open(f.principal, randomUUID());
  const oldInsert = (id: string) =>
    f.store.db
      .prepare(
        "INSERT INTO native_delivery_receipts(environment_id,principal_id,kind,original_id,sha256,byte_length,state,reserved_bytes) VALUES (?,?,?,?,?,2,'admitted',17)",
      )
      .run(f.store.environmentId, f.principal, finish, id, sha("{}"));
  await expect(oldInsert(identity(epoch, 1).originalId)).rejects.toThrow("FENCED");
  await expect(oldInsert(randomUUID())).rejects.toThrow("PROTOCOL_FENCED");
  const insert = (id: string, owner: string, generation: number, sequence: number) =>
    f.store.db
      .prepare(
        "INSERT INTO native_delivery_receipts(environment_id,principal_id,kind,original_id,sha256,byte_length,state,reserved_bytes,epoch_owner_id,epoch_generation,epoch_sequence) VALUES (?,?,?,?,?,2,'admitted',17,?,?,?)",
      )
      .run(f.store.environmentId, f.principal, finish, id, sha("{}"), owner, generation, sequence);
  for (const id of [
    `nd2:${epoch.ownerId}:01:1`,
    `nd2:${epoch.ownerId}:${epoch.generation}:01`,
    `nd2:${epoch.ownerId}:${epoch.generation}:0`,
    `nd2:${epoch.ownerId.toUpperCase()}:${epoch.generation}:1`,
    `nd2:${epoch.ownerId}:${epoch.generation}:9007199254740992`,
  ])
    await expect(insert(id, epoch.ownerId, epoch.generation, 1)).rejects.toThrow("FENCED");
  await expect(
    insert(
      `nd2:${epoch.ownerId.replace(/-4/, "-5")}:${epoch.generation}:1`,
      epoch.ownerId.replace(/-4/, "-5"),
      epoch.generation,
      1,
    ),
  ).rejects.toThrow("FENCED");
  await f.journal.admit(f.principal, finish, identity(epoch, 1));
  await expect(
    f.store.db
      .prepare("UPDATE native_delivery_receipts SET sha256=? WHERE original_id=?")
      .run("a".repeat(64), identity(epoch, 1).originalId),
  ).rejects.toThrow("IMMUTABLE");
});

it("rejects INSERT OR REPLACE against every retained identity with recursive triggers disabled", async () => {
  const f = await fixture(),
    epoch = await f.journal.epochs.open(f.principal, randomUUID()),
    id = await retire(f, epoch, 1);
  await f.store.db.exec("PRAGMA recursive_triggers=OFF");
  for (const table of [
    "native_delivery_epoch_counter",
    "native_delivery_epoch_counter_witness",
    "native_delivery_protocol_floors",
    "native_delivery_protocol_witnesses",
    "native_delivery_epochs",
    "native_delivery_epoch_witnesses",
    "native_delivery_receipts",
  ]) {
    await expect(
      f.store.db.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`),
    ).rejects.toThrow();
  }
  expect(await f.journal.readMetadata(f.principal, finish, id)).toMatchObject({ state: "retired" });
  expect(await f.journal.epochs.status(f.principal, epoch)).toMatchObject({
    through: 0,
    highWater: 1,
  });
});

it("uses FULL for epoch/floor work, then keeps descriptions and fences entirely read-only", async () => {
  const f = await fixture(),
    exec = f.store.db.exec.bind(f.store.db),
    modes: number[] = [];
  vi.spyOn(f.store.db, "exec").mockImplementation(async (sql) => {
    if (sql === "COMMIT")
      modes.push(Number((await f.store.db.prepare("PRAGMA synchronous").get())?.synchronous));
    return exec(sql);
  });
  const epoch = await f.journal.epochs.open(f.principal, randomUUID()),
    id = await retire(f, epoch, 1);
  const count = modes.length;
  await f.journal.epochs.compact(f.principal, { ...epoch, expectedThrough: 0, through: 1 });
  expect(modes.length).toBe(count + 1);
  expect(modes.every((mode) => mode === 2)).toBe(true);
  expect((await f.store.db.prepare("PRAGMA synchronous").get())?.synchronous).toBe(1);
  const before = f.store.db.dataMutationVersion,
    commits = modes.length;
  await f.journal.epochs.status(f.principal, epoch);
  await f.journal.readMetadata(f.principal, finish, id);
  expect(f.store.db.dataMutationVersion).toBe(before);
  expect(modes.length).toBe(commits);
});

it("rolls back first-open failure without a protocol floor and recovers an actual lost open COMMIT acknowledgement", async () => {
  const f = await fixture(),
    openId = randomUUID(),
    exec = f.store.db.exec.bind(f.store.db);
  vi.spyOn(f.store.db, "exec").mockImplementation(async (sql) => {
    if (sql === "COMMIT") throw new Error("Before open commit");
    return exec(sql);
  });
  await expect(f.journal.epochs.open(f.principal, openId)).rejects.toThrow("Before open");
  vi.restoreAllMocks();
  await f.reopen();
  await assertNativeDeliveryEffect(f.store, f.principal, finish);
  expect(
    (await f.store.db.prepare("SELECT generation FROM native_delivery_epoch_counter").get())
      ?.generation,
  ).toBe(0);
  const commit = f.store.db.exec.bind(f.store.db);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(f.store.db, "exec").mockImplementation(async (sql) => {
    await commit(sql);
    if (sql === "COMMIT") throw new Error("Lost open ACK");
  });
  await expect(f.journal.epochs.open(f.principal, openId)).rejects.toThrow("Lost open");
  vi.restoreAllMocks();
  await f.reopen();
  expect(await f.journal.epochs.open(f.principal, openId)).toMatchObject({ openId, generation: 1 });
  expect(
    (await f.store.db.prepare("SELECT COUNT(*) AS count FROM native_delivery_epochs").get())?.count,
  ).toBe(1);
});

it("rolls back floor/deletion together and survives a committed-but-lost compaction acknowledgement", async () => {
  const f = await fixture(),
    epoch = await f.journal.epochs.open(f.principal, randomUUID()),
    id = await retire(f, epoch, 1),
    exec = f.store.db.exec.bind(f.store.db);
  vi.spyOn(f.store.db, "exec").mockImplementation(async (sql) => {
    if (sql === "COMMIT") throw new Error("Before compact commit");
    return exec(sql);
  });
  await expect(
    f.journal.epochs.compact(f.principal, { ...epoch, expectedThrough: 0, through: 1 }),
  ).rejects.toThrow("Before compact");
  vi.restoreAllMocks();
  await f.reopen();
  expect(await f.journal.readMetadata(f.principal, finish, id)).toMatchObject({ state: "retired" });
  expect((await f.journal.epochs.status(f.principal, epoch)).through).toBe(0);
  const commit = f.store.db.exec.bind(f.store.db);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(f.store.db, "exec").mockImplementation(async (sql) => {
    await commit(sql);
    if (sql === "COMMIT") throw new Error("Lost compact ACK");
  });
  await expect(
    f.journal.epochs.compact(f.principal, { ...epoch, expectedThrough: 0, through: 1 }),
  ).rejects.toThrow("Lost compact");
  vi.restoreAllMocks();
  await f.reopen();
  expect(await f.journal.readMetadata(f.principal, finish, id)).toMatchObject({ state: "fenced" });
  expect((await f.journal.epochs.status(f.principal, epoch)).through).toBe(1);
});

it("blocks missing/corrupt owners or witnesses without rebuilding them from receipts or a repeated openId", async () => {
  for (const which of ["owner", "witness", "protocol", "protocol-witness"]) {
    const f = await fixture(),
      epoch = await f.journal.epochs.open(f.principal, randomUUID());
    await retire(f, epoch, 1);
    const table =
      which === "owner"
        ? "native_delivery_epochs"
        : which === "witness"
          ? "native_delivery_epoch_witnesses"
          : which === "protocol"
            ? "native_delivery_protocol_floors"
            : "native_delivery_protocol_witnesses";
    const trigger =
      which === "owner"
        ? "native_delivery_epoch_delete"
        : which === "witness"
          ? "native_delivery_epoch_witness_delete"
          : which === "protocol"
            ? "native_delivery_protocol_delete"
            : "native_delivery_protocol_witness_delete";
    await f.store.db.exec(`DROP TRIGGER ${trigger}; DELETE FROM ${table}`);
    if (which === "owner" || which === "witness")
      await expect(f.reopen()).rejects.toThrow("CORRUPT");
    else await f.reopen();
    await expect(f.journal.epochs.status(f.principal, epoch)).rejects.toThrow("CORRUPT");
    await expect(f.journal.epochs.open(f.principal, epoch.openId)).rejects.toThrow("CORRUPT");
    await expect(
      f.journal.execute(f.principal, finish, identity(epoch, 1), async () => result),
    ).rejects.toThrow();
  }
});

it("never remints a compacted open intent after both retained header rows disappear", async () => {
  for (const missing of ["first", "middle"]) {
    const f = await fixture();
    const first = await f.journal.epochs.open(f.principal, randomUUID());
    const middle = await f.journal.epochs.open(f.principal, randomUUID());
    const last = await f.journal.epochs.open(f.principal, randomUUID());
    const epoch = missing === "first" ? first : middle;
    const effect = vi.fn(async () => result);
    const original = identity(epoch, 1);
    await f.journal.execute(f.principal, finish, original, effect);
    await f.journal.retire(f.principal, finish, original, consumed);
    await f.journal.epochs.compact(f.principal, { ...epoch, expectedThrough: 0, through: 1 });
    expect(
      (await f.store.db.prepare("SELECT COUNT(*) AS n FROM native_delivery_receipts").get())?.n,
    ).toBe(0);
    await f.store.db.exec(
      "DROP TRIGGER native_delivery_epoch_delete; DROP TRIGGER native_delivery_epoch_witness_delete",
    );
    await f.store.db
      .prepare("DELETE FROM native_delivery_epochs WHERE owner_id=?")
      .run(epoch.ownerId);
    await f.store.db
      .prepare("DELETE FROM native_delivery_epoch_witnesses WHERE owner_id=?")
      .run(epoch.ownerId);
    await expect(f.journal.epochs.open(f.principal, epoch.openId)).rejects.toThrow("CORRUPT");
    await expect(f.journal.epochs.open(f.principal, randomUUID())).rejects.toThrow("CORRUPT");
    await expect(f.journal.execute(f.principal, finish, original, effect)).rejects.toThrow(
      "CORRUPT",
    );
    await expect(f.journal.epochs.status(f.principal, last)).rejects.toThrow("CORRUPT");
    expect(
      (await f.store.db.prepare("SELECT generation FROM native_delivery_epoch_counter").get())
        ?.generation,
    ).toBe(last.generation);
    expect(effect).toHaveBeenCalledTimes(1);
    await expect(f.reopen()).rejects.toThrow("CORRUPT");
  }
});

it("refuses a missing initialized global counter on reopen, even when receipt/source data survives", async () => {
  const f = await fixture(),
    epoch = await f.journal.epochs.open(f.principal, randomUUID());
  await retire(f, epoch, 1);
  await f.store.db.exec(
    "DROP TRIGGER native_delivery_epoch_counter_delete; DELETE FROM native_delivery_epoch_counter",
  );
  await expect(f.journal.epochs.open(f.principal, randomUUID())).rejects.toThrow("CORRUPT");
  await expect(f.reopen()).rejects.toThrow("CORRUPT");
});

it("holds impossible counter jumps and raw floor regression instead of wrapping a generation", async () => {
  const f = await fixture(),
    epoch = await f.journal.epochs.open(f.principal, randomUUID());
  await retire(f, epoch, 1);
  await f.journal.epochs.compact(f.principal, { ...epoch, expectedThrough: 0, through: 1 });
  await expect(
    f.store.db
      .prepare("UPDATE native_delivery_epochs SET through=0 WHERE owner_id=?")
      .run(epoch.ownerId),
  ).rejects.toThrow("FENCED");
  await expect(
    f.store.db.exec("UPDATE native_delivery_protocol_floors SET min_version=1"),
  ).rejects.toThrow("IMMUTABLE");
  await f.store.db
    .exec(`DROP TRIGGER native_delivery_epoch_counter_update; DROP TRIGGER native_delivery_epoch_counter_witness_update;
    UPDATE native_delivery_epoch_counter SET generation=${Number.MAX_SAFE_INTEGER};`);
  await expect(f.journal.epochs.open(f.principal, randomUUID())).rejects.toThrow("CORRUPT");
  await expect(f.journal.epochs.status(f.principal, epoch)).rejects.toThrow("CORRUPT");
});

it("rolls back epoch opening if actual captured authorization disappears during its SQL awaits", async () => {
  const f = await fixture(),
    prepare = f.store.db.prepare.bind(f.store.db);
  let allowed = true;
  vi.spyOn(f.store.db, "prepare").mockImplementation((sql) => {
    const statement = prepare(sql);
    if (sql.startsWith("INSERT INTO native_delivery_epochs(")) {
      const run = statement.run.bind(statement);
      vi.spyOn(statement, "run").mockImplementation(async (...params) => {
        const value = await run(...params);
        allowed = false;
        return value;
      });
    }
    return statement;
  });
  await expect(
    f.store.db.withAuthorization(
      async () => allowed,
      () => f.journal.epochs.open(f.principal, randomUUID()),
    ),
  ).rejects.toThrow("revoked");
  vi.restoreAllMocks();
  expect(
    (await f.store.db.prepare("SELECT generation FROM native_delivery_epoch_counter").get())
      ?.generation,
  ).toBe(0);
  expect(
    (
      await f.store.db
        .prepare("SELECT COUNT(*) AS count FROM native_delivery_protocol_floors")
        .get()
    )?.count,
  ).toBe(0);
});

it("migrates a predecessor file journal without losing legacy results or permitting a fresh legacy bypass", async () => {
  const f = await fixture(),
    old = legacy();
  await f.journal.execute(f.principal, finish, old, async () => result);
  await f.store.transaction(async () => {
    const triggers = await f.store.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND name GLOB 'native_delivery_*'",
      )
      .all();
    for (const trigger of triggers) await f.store.db.exec(`DROP TRIGGER ${String(trigger.name)}`);
    await f.store.db.exec(`ALTER TABLE native_delivery_receipts RENAME TO predecessor_receipts;
      CREATE TABLE native_delivery_receipts (environment_id TEXT NOT NULL,principal_id TEXT NOT NULL,kind TEXT NOT NULL,original_id TEXT NOT NULL,sha256 TEXT NOT NULL,byte_length INTEGER NOT NULL,state TEXT NOT NULL,result_json TEXT,proof_json TEXT,PRIMARY KEY(environment_id,principal_id,original_id));
      INSERT INTO native_delivery_receipts SELECT environment_id,principal_id,kind,original_id,sha256,byte_length,state,result_json,proof_json FROM predecessor_receipts;
      DROP TABLE predecessor_receipts;`);
  });
  await f.reopen();
  expect(await f.journal.readMetadata(f.principal, finish, old)).toMatchObject({
    state: "recorded",
    consumedResult: consumed,
  });
  const epoch = await f.journal.epochs.open(f.principal, randomUUID());
  await f.journal.retire(f.principal, finish, old, consumed);
  await expect(f.journal.admit(f.principal, finish, legacy())).rejects.toThrow("PROTOCOL_FENCED");
  const current = await retire(f, epoch, 1);
  await f.journal.epochs.compact(f.principal, { ...epoch, expectedThrough: 0, through: 1 });
  expect(await f.journal.readMetadata(f.principal, finish, current)).toMatchObject({
    state: "fenced",
  });
  expect(await f.journal.readMetadata(f.principal, finish, old)).toMatchObject({
    state: "retired",
  });
});

it("keeps retained epoch metadata bounded per principal through real typed allocations", async () => {
  const f = await fixture();
  await f.store.transaction(async () => {
    for (let index = 0; index < 4096; index++)
      await f.journal.epochs.open(f.principal, randomUUID());
  }, "critical");
  await expect(f.journal.epochs.open(f.principal, randomUUID())).rejects.toThrow("CAPACITY");
  expect(
    (
      await f.store.db
        .prepare(
          "SELECT COUNT(*) AS count FROM native_delivery_epoch_witnesses WHERE principal_id=?",
        )
        .get(f.principal)
    )?.count,
  ).toBe(4096);
}, 60_000);

it("holds orphaned witnesses as corruption and bounds complete retained headers without eviction", async () => {
  const f = await fixture();
  await f.journal.epochs.open(f.principal, randomUUID());
  await f.store.transaction(async () => {
    await f.store.db
      .exec(`DROP TRIGGER native_delivery_epoch_counter_update; DROP TRIGGER native_delivery_epoch_counter_witness_update; DROP TRIGGER native_delivery_epoch_witness_insert;
      UPDATE native_delivery_epoch_counter SET generation=65536;`);
    await f.store.db
      .prepare(`WITH RECURSIVE rows(n) AS (SELECT 2 UNION ALL SELECT n+1 FROM rows WHERE n<65536)
      INSERT INTO native_delivery_epoch_witnesses SELECT ?,?,printf('%08x-0000-4000-8000-000000000000',n),n,printf('%08x-0000-4000-8000-000000000001',n),0,0,0 FROM rows`)
      .run(f.store.environmentId, sha("held orphan scope"));
  });
  await expect(f.journal.epochs.open(f.other, randomUUID())).rejects.toThrow("CORRUPT");
  // Isolated capacity fixture: populate matching retained headers so this next
  // request reaches the actual global cap check in a complete namespace.
  await f.store.db
    .exec(`DROP TRIGGER native_delivery_epoch_insert; DROP TRIGGER native_delivery_epoch_insert_sync;
    INSERT INTO native_delivery_epochs SELECT * FROM native_delivery_epoch_witnesses WHERE generation>1;`);
  await expect(f.journal.epochs.open(f.other, randomUUID())).rejects.toThrow("CAPACITY");
  expect(
    (
      await f.store.db
        .prepare("SELECT COUNT(*) AS count FROM native_delivery_epoch_witnesses")
        .get()
    )?.count,
  ).toBe(65536);
});

it("cannot replace consumed metadata or rebuild a lost counter from its retained witness", async () => {
  const f = await fixture(),
    epoch = await f.journal.epochs.open(f.principal, randomUUID()),
    id = await retire(f, epoch, 1);
  await expect(
    f.store.db
      .prepare("UPDATE native_delivery_receipts SET consumed_sha256=? WHERE original_id=?")
      .run("a".repeat(64), id.originalId),
  ).rejects.toThrow("RESULT_IMMUTABLE");
  const retained = await f.store.db
    .prepare("SELECT * FROM native_delivery_epoch_counter_witness")
    .get();
  await f.store.db.exec(
    "DROP TRIGGER native_delivery_epoch_counter_delete; DELETE FROM native_delivery_epoch_counter",
  );
  await expect(
    f.store.db
      .prepare("INSERT INTO native_delivery_epoch_counter VALUES (?,?,?)")
      .run(retained!.id, retained!.root_id, retained!.generation),
  ).rejects.toThrow("COUNTER_REPLACE");
  await expect(f.journal.epochs.open(f.principal, epoch.openId)).rejects.toThrow("CORRUPT");
});

it("preserves the full32MiB formatter result and compacts it using only retired bounded metadata", async () => {
  const f = await fixture(),
    epoch = await f.journal.epochs.open(f.principal, randomUUID()),
    id = identity(epoch, 1);
  const empty = { formatted: "", cursorOffset: 0 },
    maximum = 32 * 1024 * 1024;
  const value = {
    ...empty,
    formatted: "x".repeat(maximum - Buffer.byteLength(JSON.stringify(empty))),
  };
  // Preserve results admitted by the legacy32MiB contract.
  await f.journal.admit(f.principal, format, id);
  await f.store.db
    .prepare("UPDATE native_delivery_receipts SET reserved_bytes=? WHERE original_id=?")
    .run(maximum, id.originalId);
  await f.journal.record(f.principal, format, id, value);
  expect((await f.journal.readMetadata(f.principal, format, id))?.resultSource?.byteLength).toBe(
    maximum,
  );
  await f.journal.retire(f.principal, format, id, nativeDeliveryConsumedResult(format, value));
  const prepare = vi.spyOn(f.store.db, "prepare");
  await f.journal.epochs.compact(f.principal, { ...epoch, expectedThrough: 0, through: 1 });
  expect(
    prepare.mock.calls.every(
      ([sql]) =>
        !sql.includes("CAST(result_json") &&
        !sql.includes("substr(") &&
        !sql.includes(" AS inline_result"),
    ),
  ).toBe(true);
  expect(await f.journal.readMetadata(f.principal, format, id)).toMatchObject({ state: "fenced" });
});
