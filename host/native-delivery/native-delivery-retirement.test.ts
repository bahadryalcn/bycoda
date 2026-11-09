import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  nativeDeliveryFixture,
  deliveryIdentity,
  deliverySha,
} from "./native-delivery.test-support";
import {
  nativeDeliveryConsumedResult,
  initializeNativeDeliveryStore,
} from "./native-delivery-store";
import { durableWrite } from "../git/turn-git-history";
import { StoreDatabase } from "../store-db";

const format = "native.services.workspace.format" as const;
const finish = "native.services.conversation.desktop.finish" as const;
const maximum = 32 * 1024 * 1024;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture() {
  const f = await nativeDeliveryFixture("2026-10-29-host-delivery-retirement");
  cleanups.push(f.close);
  return f;
}
const formatJson = () =>
  JSON.stringify({
    command: "format_text_file",
    args: {
      path: "/fixture/file.ts",
      source: "source",
      cursorOffset: 0,
    },
  });
const consumedBuffer = nativeDeliveryConsumedResult("buffer", { acknowledged: true });
const consumedFinish = nativeDeliveryConsumedResult(finish, { accepted: true });

it("stores serde_json sorted-key consumed identity separately from exact source bytes", async () => {
  const f = await fixture(),
    paramsJson = formatJson(),
    identity = deliveryIdentity(paramsJson);
  const result = { formatted: 'Türkçe 😀\n\u0000"\\\u2028', cursorOffset: 9007199254740991 };
  f.setFormat(async () => result);
  await f.call("native.services.delivery.apply", { ...identity, target: format, paramsJson });
  const row = await f.journal.read(f.principal, format, identity);
  const canonical = JSON.stringify({
    cursorOffset: result.cursorOffset,
    formatted: result.formatted,
  });
  expect(row?.consumedResult).toEqual({
    sha256: deliverySha(canonical),
    byteLength: Buffer.byteLength(canonical),
  });
  expect(row?.resultSource?.sha256).toBe(deliverySha(JSON.stringify(result)));
  expect(row?.consumedResult?.sha256).not.toBe(row?.resultSource?.sha256);
  expect(consumedBuffer.byteLength).toBe(21);
  expect(consumedFinish.byteLength).toBe(17);
  expect(nativeDeliveryConsumedResult(format, null)).toEqual({
    sha256: deliverySha("null"),
    byteLength: 4,
  });
  await f.reopen();
  expect((await f.journal.readMetadata(f.principal, format, identity))?.consumedResult).toEqual(
    row?.consumedResult,
  );
});

it("reserves each finite maximum durably before its actual effect and converts it at record", async () => {
  const f = await fixture();
  const reserved = async (originalId: string) =>
    await f.store.db
      .prepare("SELECT state,reserved_bytes FROM native_delivery_receipts WHERE original_id=?")
      .get(originalId);
  const bufferJson = f.report(),
    bufferId = deliveryIdentity(bufferJson);
  f.setWrite(async (path) => {
    if (path.includes("buffers"))
      expect(await reserved(bufferId.originalId)).toEqual({
        state: "admitted",
        reserved_bytes: 21,
      });
  });
  await f.call("native.buffers.delivery.apply", { ...bufferId, paramsJson: bufferJson });
  await f.call("native.buffers.delivery.ack", { ...bufferId, consumedResult: consumedBuffer });
  const finishJson = JSON.stringify({ id: "finish-reservation", result: null }),
    finishId = deliveryIdentity(finishJson);
  f.setFinish(async () => {
    expect(await reserved(finishId.originalId)).toEqual({ state: "admitted", reserved_bytes: 17 });
    return { accepted: true };
  });
  await f.call("native.services.delivery.apply", {
    ...finishId,
    target: finish,
    paramsJson: finishJson,
  });
  await f.call("native.services.delivery.ack", {
    ...finishId,
    target: finish,
    consumedResult: consumedFinish,
  });
  const paramsJson = formatJson(),
    identity = deliveryIdentity(paramsJson);
  f.setFormat(async () => {
    expect(await reserved(identity.originalId)).toEqual({
      state: "admitted",
      reserved_bytes: 4 * 1024 * 1024,
    });
    return null;
  });
  await f.call("native.services.delivery.apply", { ...identity, target: format, paramsJson });
  expect(await reserved(identity.originalId)).toEqual({ state: "recorded", reserved_bytes: 0 });
});

it("retires exact32MiB results by stored consumed digest, reclaims capacity and invalidates chunk guards", async () => {
  const f = await fixture(),
    paramsJson = formatJson(),
    identity = deliveryIdentity(paramsJson);
  // A withheld tiny receipt must not starve the formatter's entire existing32MiB pool.
  const tinyJson = JSON.stringify({ id: "withheld-tiny", result: null });
  await f.call("native.services.delivery.apply", {
    ...deliveryIdentity(tinyJson),
    target: finish,
    paramsJson: tinyJson,
  });
  const empty = { formatted: "", cursorOffset: 0 };
  const result = {
    ...empty,
    formatted: "x".repeat(maximum - Buffer.byteLength(JSON.stringify(empty))),
  };
  // Model an already admitted legacy original, whose immutable reservation was32MiB.
  await f.journal.admit(f.principal, format, identity);
  await f.store.db
    .prepare("UPDATE native_delivery_receipts SET reserved_bytes=? WHERE original_id=?")
    .run(maximum, identity.originalId);
  await f.journal.record(f.principal, format, identity, result);
  const status = await f.call("native.services.delivery.status", {
    ...identity,
    target: format,
  });
  expect(status).toMatchObject({ state: "recorded", resultSource: { byteLength: maximum } });
  const source = (status as { resultSource: { sha256: string; byteLength: number } }).resultSource;
  await f.reopen();
  const next = deliveryIdentity(paramsJson),
    guards: Array<() => Promise<boolean>> = [],
    ctx = f.context();
  ctx.retainResultAuthority = (check) => guards.push(check);
  await f.call(
    "native.services.delivery.result.read",
    { ...identity, target: format, resultSource: source, offset: 0, limit: 32 },
    ctx,
  );
  await expect(
    f.call("native.services.delivery.apply", { ...next, target: format, paramsJson }),
  ).rejects.toThrow("before admission");
  expect(f.counts.format).toBe(0);
  expect(await f.journal.readMetadata(f.principal, format, next)).toBeNull();
  await expect(
    f.call("native.services.delivery.ack", { ...identity, target: format, consumedResult: source }),
  ).rejects.toThrow("consumed result conflicts");
  const consumedResult = nativeDeliveryConsumedResult(format, result);
  const retired = { ...identity, target: format, state: "retired", consumedResult };
  const prepared = vi.spyOn(f.store.db, "prepare");
  expect(
    await f.call("native.services.delivery.ack", { ...identity, target: format, consumedResult }),
  ).toEqual(retired);
  const ackReads = prepared.mock.calls
    .map(([sql]) => sql)
    .filter(
      (sql) =>
        sql.trimStart().startsWith("SELECT") && sql.includes("FROM native_delivery_receipts"),
    );
  expect(ackReads.length).toBeGreaterThanOrEqual(3);
  expect(ackReads.every((sql) => !sql.includes("result_json"))).toBe(true);
  prepared.mockRestore();
  const stored = await f.store.db
    .prepare(
      "SELECT state,result_json,proof_json,reserved_bytes,result_bytes,consumed_bytes FROM native_delivery_receipts WHERE original_id=?",
    )
    .get(identity.originalId);
  expect(stored).toEqual({
    state: "retired",
    result_json: null,
    proof_json: null,
    reserved_bytes: 0,
    result_bytes: maximum,
    consumed_bytes: maximum,
  });
  expect(await guards.at(-1)!()).toBe(false);
  await expect(
    f.call("native.services.delivery.result.read", {
      ...identity,
      target: format,
      resultSource: source,
      offset: 0,
      limit: 32,
    }),
  ).rejects.toThrow();
  const mutations = f.store.db.dataMutationVersion;
  expect(await f.call("native.services.delivery.status", { ...identity, target: format })).toEqual(
    retired,
  );
  expect(f.store.db.dataMutationVersion).toBe(mutations);
  expect(
    await f.call("native.services.delivery.apply", { ...identity, target: format, paramsJson }),
  ).toEqual(retired);
  expect(f.counts.format).toBe(0);
  f.setFormat(async () => null);
  expect(
    await f.call("native.services.delivery.apply", { ...next, target: format, paramsJson }),
  ).toMatchObject({ state: "recorded", result: null });
  expect(f.counts.format).toBe(1);
});

it("keeps an unresolved admitted service reservation across reopen and rejects ACK without an actual result", async () => {
  const f = await fixture(),
    paramsJson = formatJson(),
    identity = deliveryIdentity(paramsJson);
  // An admission with no observed owner continuation exit models a crashed or
  // still-unresolved execution. It cannot acquire failed-handler cleanup rights.
  expect(await f.journal.admit(f.principal, format, identity)).toBe(true);
  expect(
    await f.call("native.services.delivery.apply", { ...identity, target: format, paramsJson }),
  ).toMatchObject({ state: "unknown" });
  for (let index = 0; index < 7; index++)
    await f.journal.admit(f.principal, format, deliveryIdentity(paramsJson));
  await f.reopen();
  await expect(
    f.call("native.services.delivery.ack", {
      ...identity,
      target: format,
      consumedResult: nativeDeliveryConsumedResult(format, null),
    }),
  ).rejects.toThrow();
  await expect(
    f.call("native.services.delivery.apply", {
      ...deliveryIdentity(paramsJson),
      target: format,
      paramsJson,
    }),
  ).rejects.toThrow("before admission");
  expect(
    await f.call("native.services.delivery.apply", { ...identity, target: format, paramsJson }),
  ).toMatchObject({ state: "unknown" });
  expect(f.counts.format).toBe(0);
  expect(
    (
      await f.store.db
        .prepare("SELECT reserved_bytes FROM native_delivery_receipts WHERE original_id=?")
        .get(identity.originalId)
    )?.reserved_bytes,
  ).toBe(4 * 1024 * 1024);
});

it("enforces the global reservation bound across principals before a seventeenth formatter enters", async () => {
  const f = await fixture(),
    paramsJson = formatJson();
  const ids = [
    deliveryIdentity(paramsJson),
    deliveryIdentity(paramsJson),
    deliveryIdentity(paramsJson),
  ];
  await f.journal.admit("first-paired-principal", format, ids[0]);
  await f.journal.admit("second-paired-principal", format, ids[1]);
  for (let index = 0; index < 7; index++) {
    await f.journal.admit("first-paired-principal", format, deliveryIdentity(paramsJson));
    await f.journal.admit("second-paired-principal", format, deliveryIdentity(paramsJson));
  }
  await expect(
    f.call("native.services.delivery.apply", { ...ids[2], target: format, paramsJson }),
  ).rejects.toThrow("before admission");
  expect(f.counts.format).toBe(0);
  await f.reopen();
  expect(
    (
      await f.store.db
        .prepare("SELECT SUM(reserved_bytes) AS held FROM native_delivery_receipts")
        .get()
    )?.held,
  ).toBe(2 * maximum);
});

it("retires an admitted buffer only after actual original proof and never consults FS for a tombstone", async () => {
  const f = await fixture(),
    paramsJson = f.report(),
    identity = deliveryIdentity(paramsJson);
  let written = false;
  f.setWrite(async (path, bytes) => {
    if (!written && path.includes("buffers")) {
      written = true;
      await durableWrite(path, bytes);
      throw new Error("Original projection committed but record acknowledgement lost");
    }
  });
  expect(await f.call("native.buffers.delivery.apply", { ...identity, paramsJson })).toMatchObject({
    state: "recorded",
  });
  expect((await f.journal.readMetadata(f.principal, "buffer", identity))?.state).toBe("admitted");
  f.setWrite(undefined);
  await f.reopen();
  const row = await f.journal.readMetadata(f.principal, "buffer", identity);
  const retired = { ...identity, state: "retired", consumedResult: consumedBuffer };
  expect(
    await f.call("native.buffers.delivery.ack", { ...identity, consumedResult: consumedBuffer }),
  ).toEqual(retired);
  await unlink(join(f.root, "native-activity", "buffers", `${row!.proof!.reportId}.json`));
  await f.reopen();
  const verify = vi
    .spyOn(f.buffers, "verifyDelivery")
    .mockRejectedValue(new Error("Retired lookup must not verify FS"));
  expect(await f.call("native.buffers.delivery.status", identity)).toEqual(retired);
  expect(await f.call("native.buffers.delivery.apply", { ...identity, paramsJson })).toEqual(
    retired,
  );
  expect(
    await f.call("native.buffers.delivery.ack", { ...identity, consumedResult: consumedBuffer }),
  ).toEqual(retired);
  expect(verify).not.toHaveBeenCalled();
  expect(f.counts.buffers).toBe(1);
});

it("refuses buffer retirement without current/archive proof and rejects a changed planned proof", async () => {
  const f = await fixture(),
    paramsJson = f.report(),
    identity = deliveryIdentity(paramsJson);
  await f.call("native.buffers.delivery.apply", { ...identity, paramsJson });
  const row = await f.journal.readMetadata(f.principal, "buffer", identity),
    proof = row!.proof!;
  await f.store.db
    .prepare("UPDATE native_delivery_receipts SET proof_json=? WHERE original_id=?")
    .run(JSON.stringify({ ...proof, reportVersion: proof.reportVersion + 1 }), identity.originalId);
  await expect(
    f.journal.retire(f.principal, "buffer", identity, consumedBuffer, proof),
  ).rejects.toThrow("same verified planned");
  await f.store.db
    .prepare("UPDATE native_delivery_receipts SET proof_json=? WHERE original_id=?")
    .run(JSON.stringify(proof), identity.originalId);
  await unlink(join(f.root, "native-activity", "buffers", `${proof.reportId}.json`));
  await expect(
    f.call("native.buffers.delivery.ack", { ...identity, consumedResult: consumedBuffer }),
  ).rejects.toThrow("exact current or archived proof");
  expect((await f.journal.readMetadata(f.principal, "buffer", identity))?.state).toBe("recorded");
});

it("binds ACK to exact original, target, consumed digest, principal and current authentication", async () => {
  const f = await fixture(),
    paramsJson = JSON.stringify({ id: "ack-identity", result: null }),
    identity = deliveryIdentity(paramsJson);
  await f.call("native.services.delivery.apply", { ...identity, target: finish, paramsJson });
  const ack = { ...identity, target: finish, consumedResult: consumedFinish };
  for (const changed of [
    { sha256: "a".repeat(64) },
    { byteLength: identity.byteLength + 1 },
    { target: format },
    { consumedResult: { ...consumedFinish, sha256: "b".repeat(64) } },
    { consumedResult: { ...consumedFinish, byteLength: 18 } },
  ])
    await expect(f.call("native.services.delivery.ack", { ...ack, ...changed })).rejects.toThrow();
  await expect(
    f.call("native.services.delivery.ack", ack, f.context("other-paired-principal")),
  ).rejects.toThrow();
  const oldEnvironment = f.store.environmentId;
  f.store.environmentId = "other-host-environment";
  await expect(f.call("native.services.delivery.ack", ack)).rejects.toThrow();
  f.store.environmentId = oldEnvironment;
  const guards: Array<() => Promise<boolean>> = [],
    ctx = f.context();
  ctx.retainResultAuthority = (check) => guards.push(check);
  expect(await f.call("native.services.delivery.ack", ack, ctx)).toMatchObject({
    state: "retired",
  });
  expect(await f.call("native.services.delivery.ack", ack)).toMatchObject({ state: "retired" });
  const mutations = f.store.db.dataMutationVersion;
  await f.call("native.services.delivery.status", { ...identity, target: finish });
  expect(f.store.db.dataMutationVersion).toBe(mutations);
  await f.store.db.prepare("DELETE FROM devices WHERE hash=?").run(f.principal);
  expect(await guards[0]()).toBe(false);
  await expect(f.call("native.services.delivery.ack", ack)).rejects.toThrow();
  expect(f.counts.finish).toBe(1);
});

it("uses FULL retirement commits and survives a lost commit acknowledgement without replay", async () => {
  const f = await fixture(),
    paramsJson = JSON.stringify({ id: "ack-commit", result: null }),
    identity = deliveryIdentity(paramsJson);
  await f.call("native.services.delivery.apply", { ...identity, target: finish, paramsJson });
  const exec = f.store.db.exec.bind(f.store.db);
  let injected = false;
  vi.spyOn(f.store.db, "exec").mockImplementation(async (sql) => {
    if (sql === "COMMIT" && !injected) {
      expect((await f.store.db.prepare("PRAGMA synchronous").get())?.synchronous).toBe(2);
      injected = true;
      await exec(sql);
      throw new Error("Lost retirement commit acknowledgement");
    }
    return exec(sql);
  });
  const ack = { ...identity, target: finish, consumedResult: consumedFinish };
  await expect(f.call("native.services.delivery.ack", ack)).rejects.toThrow("Lost retirement");
  vi.restoreAllMocks();
  await f.reopen();
  expect(await f.call("native.services.delivery.status", { ...identity, target: finish })).toEqual({
    ...ack,
    state: "retired",
  });
  expect(await f.call("native.services.delivery.ack", ack)).toEqual({ ...ack, state: "retired" });
  expect(
    await f.call("native.services.delivery.apply", { ...identity, target: finish, paramsJson }),
  ).toEqual({ ...ack, state: "retired" });
  expect(f.counts.finish).toBe(1);
  expect((await f.store.db.prepare("PRAGMA synchronous").get())?.synchronous).toBe(1);
});

it("rolls back a precommit retirement failure and retains the original result for a later exact ACK", async () => {
  const f = await fixture(),
    paramsJson = JSON.stringify({ id: "ack-rollback", result: null }),
    identity = deliveryIdentity(paramsJson);
  await f.call("native.services.delivery.apply", { ...identity, target: finish, paramsJson });
  const exec = f.store.db.exec.bind(f.store.db);
  vi.spyOn(f.store.db, "exec").mockImplementation(async (sql) => {
    if (sql === "COMMIT") throw new Error("Before retirement commit");
    return exec(sql);
  });
  const ack = { ...identity, target: finish, consumedResult: consumedFinish };
  await expect(f.call("native.services.delivery.ack", ack)).rejects.toThrow(
    "Before retirement commit",
  );
  vi.restoreAllMocks();
  await f.reopen();
  expect(
    await f.call("native.services.delivery.status", { ...identity, target: finish }),
  ).toMatchObject({ state: "recorded", result: { accepted: true } });
  expect(await f.call("native.services.delivery.ack", ack)).toEqual({ ...ack, state: "retired" });
  expect(f.counts.finish).toBe(1);
});

it("critically migrates existing file receipts and holds legacy uncertain rows without deleting or replaying them", async () => {
  const f = await fixture(),
    paramsJson = f.report(),
    identity = deliveryIdentity(paramsJson);
  await f.call("native.buffers.delivery.apply", { ...identity, paramsJson });
  const unknown = deliveryIdentity(formatJson());
  await f.journal.admit("legacy-paired-principal", format, unknown);
  await f.store.transaction(async () => {
    await f.store.db.exec(`ALTER TABLE native_delivery_receipts RENAME TO native_delivery_new;
      CREATE TABLE native_delivery_receipts (
        environment_id TEXT NOT NULL, principal_id TEXT NOT NULL, kind TEXT NOT NULL,
        original_id TEXT NOT NULL, sha256 TEXT NOT NULL, byte_length INTEGER NOT NULL,
        state TEXT NOT NULL, result_json TEXT, proof_json TEXT,
        PRIMARY KEY(environment_id,principal_id,original_id));
      INSERT INTO native_delivery_receipts SELECT environment_id,principal_id,kind,original_id,sha256,byte_length,state,result_json,proof_json FROM native_delivery_new;
      DROP TABLE native_delivery_new;`);
  });
  const beforeMigration = f.store.db.exec.bind(f.store.db);
  vi.spyOn(f.store.db, "exec").mockImplementation(async (sql) => {
    if (sql === "COMMIT") throw new Error("Before migration commit");
    return beforeMigration(sql);
  });
  await expect(initializeNativeDeliveryStore(f.store.db)).rejects.toThrow(
    "Before migration commit",
  );
  vi.restoreAllMocks();
  expect(
    (await f.store.db.prepare("PRAGMA table_info(native_delivery_receipts)").all()).some(
      (column) => column.name === "reserved_bytes",
    ),
  ).toBe(false);
  expect(
    (await f.store.db.prepare("SELECT COUNT(*) AS count FROM native_delivery_receipts").get())
      ?.count,
  ).toBe(2);
  const exec = StoreDatabase.prototype.exec,
    modes: number[] = [];
  vi.spyOn(StoreDatabase.prototype, "exec").mockImplementation(async function (
    this: StoreDatabase,
    sql,
  ) {
    if (sql === "COMMIT")
      modes.push(Number((await this.prepare("PRAGMA synchronous").get())?.synchronous));
    return exec.call(this, sql);
  });
  await f.reopen();
  expect(modes).toContain(2);
  expect((await f.journal.readMetadata(f.principal, "buffer", identity))?.consumedResult).toEqual(
    consumedBuffer,
  );
  expect((await f.journal.readMetadata("legacy-paired-principal", format, unknown))?.state).toBe(
    "admitted",
  );
  expect(
    (
      await f.store.db
        .prepare("SELECT reserved_bytes FROM native_delivery_receipts WHERE original_id=?")
        .get(unknown.originalId)
    )?.reserved_bytes,
  ).toBe(maximum);
  expect(
    (await f.store.db.prepare("SELECT COUNT(*) AS count FROM native_delivery_receipts").get())
      ?.count,
  ).toBe(2);
  expect(
    await f.call("native.buffers.delivery.ack", { ...identity, consumedResult: consumedBuffer }),
  ).toMatchObject({ state: "retired" });
  await f.reopen();
  expect(await f.call("native.buffers.delivery.status", identity)).toMatchObject({
    state: "retired",
  });
  expect(f.counts).toEqual({ buffers: 1, finish: 0, format: 0 });
});

it("keeps tiny receipt retention bounded by actual principal metadata rows", async () => {
  const f = await fixture(),
    paramsJson = JSON.stringify({ id: "fixed-capacity", result: null });
  await f.store.transaction(async () => {
    await f.store.db
      .prepare(`WITH RECURSIVE retained(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM retained WHERE n<250000)
      INSERT INTO native_delivery_receipts (environment_id,principal_id,kind,original_id,sha256,byte_length,state,reserved_bytes)
      SELECT ?,?,'buffer','retained-'||n,?,2,'admitted',21 FROM retained`)
      .run(f.store.environmentId, f.principal, "a".repeat(64));
  });
  await expect(
    f.call("native.services.delivery.apply", {
      ...deliveryIdentity(paramsJson),
      target: finish,
      paramsJson,
    }),
  ).rejects.toThrow("journal capacity");
  expect(f.counts.finish).toBe(0);
  expect(
    await f.store.db
      .prepare("SELECT COUNT(*) AS rows,SUM(reserved_bytes) AS fixed FROM native_delivery_receipts")
      .get(),
  ).toEqual({ rows: 250000, fixed: 5_250_000 });
});
