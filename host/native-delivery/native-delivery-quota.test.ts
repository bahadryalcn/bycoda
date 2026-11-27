import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { StoreDatabase } from "../store-db";
import { initializeNativeDeliveryStore } from "./native-delivery-store";
import {
  NATIVE_DELIVERY_QUOTA_NULL_RESERVED_BYTES,
  initializeNativeDeliveryQuota,
  readNativeDeliveryQuota,
} from "./native-delivery-quota";

const FORMAT = "native.services.workspace.format";
const BUFFER = "buffer";
const HASH = "a".repeat(64);
const MAX = NATIVE_DELIVERY_QUOTA_NULL_RESERVED_BYTES;
const ENV = "env-a";
const OTHER_ENV = "env-b";
const P1 = "principal-1";
const P2 = "principal-2";
const SCOPES = [
  [ENV, P1],
  [ENV, P2],
  [OTHER_ENV, P1],
  ["env-empty", "nobody"],
] as const;

const databases: StoreDatabase[] = [];
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) await db.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function database(path = ":memory:") {
  const db = new StoreDatabase(path);
  databases.push(db);
  await db.ready;
  return db;
}
/** Store init creates receipts and their protection triggers exactly as production does. */
async function journal(path?: string) {
  const db = await database(path);
  await initializeNativeDeliveryStore(db);
  return db;
}
async function legacyJournal() {
  const db = await database();
  await db.exec(`CREATE TABLE native_delivery_receipts (
    environment_id TEXT NOT NULL, principal_id TEXT NOT NULL, kind TEXT NOT NULL,
    original_id TEXT NOT NULL, sha256 TEXT NOT NULL, byte_length INTEGER NOT NULL,
    state TEXT NOT NULL, result_json TEXT, proof_json TEXT, result_sha256 TEXT, result_bytes INTEGER,
    consumed_sha256 TEXT, consumed_bytes INTEGER, reserved_bytes INTEGER,
    PRIMARY KEY(environment_id,principal_id,original_id)
  )`);
  return db;
}
/** Same critical transaction shape as the store initializer and admission path. */
function critical<T>(db: StoreDatabase, work: () => Promise<T>): Promise<T> {
  return db.durableScope(async () => {
    await db.exec("BEGIN IMMEDIATE");
    try {
      const value = await work();
      await db.exec("COMMIT");
      return value;
    } catch (error) {
      await db.exec("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
}
const initQuota = (db: StoreDatabase) => critical(db, () => initializeNativeDeliveryQuota(db));

type Seed = {
  id: string;
  env?: string;
  principal?: string;
  kind?: string;
  state?: "admitted" | "recorded" | "retired";
  reserved?: number | null;
  result?: number | null;
};
async function insert(db: StoreDatabase, row: Seed) {
  await db
    .prepare(`INSERT INTO native_delivery_receipts
      (environment_id,principal_id,kind,original_id,sha256,byte_length,state,reserved_bytes,result_bytes)
      VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(
      row.env ?? ENV,
      row.principal ?? P1,
      row.kind ?? FORMAT,
      row.id,
      HASH,
      1,
      row.state ?? "admitted",
      row.reserved === undefined ? 0 : row.reserved,
      row.result ?? null,
    );
}
/** Old aggregate from native-delivery-store admit(): the parity oracle. */
async function oracle(db: StoreDatabase, environment: string, principal: string) {
  const row = await db
    .prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN environment_id=? AND principal_id=? THEN 1 ELSE 0 END),0) AS own,
      COALESCE(SUM(CASE WHEN kind=?
        THEN COALESCE(reserved_bytes,?) + CASE WHEN state='retired' THEN 0 ELSE COALESCE(result_bytes,0) END ELSE 0 END),0) AS bytes,
      COALESCE(SUM(CASE WHEN kind=? AND environment_id=? AND principal_id=?
        THEN COALESCE(reserved_bytes,?) + CASE WHEN state='retired' THEN 0 ELSE COALESCE(result_bytes,0) END ELSE 0 END),0) AS own_bytes
      FROM native_delivery_receipts`)
    .get(environment, principal, FORMAT, MAX, FORMAT, environment, principal, MAX);
  return {
    total: Number(row?.total),
    own: Number(row?.own),
    bytes: Number(row?.bytes),
    ownBytes: Number(row?.own_bytes),
  };
}
async function expectParity(db: StoreDatabase) {
  for (const [environment, principal] of SCOPES)
    expect(await readNativeDeliveryQuota(db, environment, principal)).toEqual(
      await oracle(db, environment, principal),
    );
}

it("backfills legacy rows once with exact parity to the old aggregate", async () => {
  const db = await legacyJournal();
  await insert(db, { id: "legacy-admitted", reserved: 1000 });
  await insert(db, { id: "legacy-recorded", state: "recorded", reserved: 0, result: 500 });
  await insert(db, { id: "legacy-retired", state: "retired", reserved: 0, result: 700 });
  await insert(db, { id: "legacy-null", principal: P2, reserved: null });
  await insert(db, {
    id: "legacy-other-env",
    env: OTHER_ENV,
    state: "recorded",
    reserved: 0,
    result: 10,
  });
  await insert(db, { id: "legacy-buffer", kind: BUFFER, reserved: 21 });
  await initializeNativeDeliveryStore(db);
  await expectParity(db);
  // Format bytes: 1000 admitted + 500 recorded + 0 retired (+ MAX for NULL) + 10 other env; buffer adds rows only.
  expect(await readNativeDeliveryQuota(db, ENV, P1)).toEqual({
    total: 6,
    own: 4,
    bytes: MAX + 1510,
    ownBytes: 1500,
  });
  expect(await readNativeDeliveryQuota(db, ENV, P2)).toEqual({
    total: 6,
    own: 1,
    bytes: MAX + 1510,
    ownBytes: MAX,
  });
});

it("moves counters through admit, record, retire, release and rejects delete of unprotected originals", async () => {
  const db = await journal();
  await initQuota(db);
  await insert(db, { id: "format-1", reserved: 1000 });
  await expectParity(db);
  // record: reservation replaced by the recorded result
  await db
    .prepare(
      "UPDATE native_delivery_receipts SET state='recorded', result_bytes=500, reserved_bytes=0 WHERE original_id='format-1'",
    )
    .run();
  expect((await readNativeDeliveryQuota(db, ENV, P1)).ownBytes).toBe(500);
  await expectParity(db);
  // retire: result body dropped, retired row still counted, holds no bytes
  await db
    .prepare(
      "UPDATE native_delivery_receipts SET state='retired', result_json=NULL, reserved_bytes=0 WHERE original_id='format-1'",
    )
    .run();
  expect(await readNativeDeliveryQuota(db, ENV, P1)).toEqual({
    total: 1,
    own: 1,
    bytes: 0,
    ownBytes: 0,
  });
  await expectParity(db);
  // release of a failed execution
  await insert(db, { id: "format-2", reserved: 200 });
  await db
    .prepare("UPDATE native_delivery_receipts SET reserved_bytes=0 WHERE original_id='format-2'")
    .run();
  expect((await readNativeDeliveryQuota(db, ENV, P1)).total).toBe(2);
  await expectParity(db);
  // Unprotected originals cannot be deleted; a rejected delete must leave counters exact.
  await expect(
    db.prepare("DELETE FROM native_delivery_receipts WHERE original_id='format-2'").run(),
  ).rejects.toThrow(/NATIVE_DELIVERY_ORIGINAL_HELD/);
  await expectParity(db);
});

it("charges the fixed maximum for NULL reservations on insert and update", async () => {
  const db = await journal();
  await initQuota(db);
  await insert(db, { id: "null-reserved", reserved: null });
  expect((await readNativeDeliveryQuota(db, ENV, P1)).bytes).toBe(MAX);
  await db
    .prepare(
      "UPDATE native_delivery_receipts SET reserved_bytes=5 WHERE original_id='null-reserved'",
    )
    .run();
  expect((await readNativeDeliveryQuota(db, ENV, P1)).bytes).toBe(5);
  await db
    .prepare(
      "UPDATE native_delivery_receipts SET reserved_bytes=NULL WHERE original_id='null-reserved'",
    )
    .run();
  expect((await readNativeDeliveryQuota(db, ENV, P1)).bytes).toBe(MAX);
  await expectParity(db);
});

it("counts every kind in rows but charges bytes only to workspace format", async () => {
  const db = await journal();
  await initQuota(db);
  await insert(db, { id: "buffer-1", kind: BUFFER, reserved: 21 });
  await insert(db, {
    id: "finish-1",
    kind: "native.services.conversation.desktop.finish",
    reserved: 17,
  });
  expect(await readNativeDeliveryQuota(db, ENV, P1)).toEqual({
    total: 2,
    own: 2,
    bytes: 0,
    ownBytes: 0,
  });
  await expectParity(db);
});

it("keeps counters exact when a critical transaction rolls back", async () => {
  const db = await journal();
  await initQuota(db);
  await insert(db, { id: "kept", reserved: 100 });
  await expect(
    critical(db, async () => {
      await insert(db, { id: "rolled-back", reserved: 1000 });
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");
  expect(await readNativeDeliveryQuota(db, ENV, P1)).toEqual({
    total: 1,
    own: 1,
    bytes: 100,
    ownBytes: 100,
  });
  // A receipt the protection trigger rejects must also leave counters untouched.
  await expect(critical(db, () => insert(db, { id: "kept", reserved: 9 }))).rejects.toThrow(
    /NATIVE_DELIVERY_ORIGINAL_REPLACE/,
  );
  await expectParity(db);
});

it("fails closed on malformed legacy rows and writes no metadata", async () => {
  const db = await legacyJournal();
  await insert(db, { id: "bad-reserved", reserved: -1 });
  await expect(initQuota(db)).rejects.toThrow(/malformed for quota backfill/);
  expect(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'native_delivery_quota%'",
        )
        .get()
    )?.count,
  ).toBe(0);
});

it("fails closed when established metadata or triggers are missing", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "native-delivery-quota-")), "host.db");
  dirs.push(join(path, ".."));
  const db = await journal(path);
  await initQuota(db);
  await db.exec("DELETE FROM native_delivery_quota_state");
  await expect(initQuota(db)).rejects.toThrow(/metadata is missing/);
  await db.exec(
    "INSERT INTO native_delivery_quota_state(id,version,null_reserved_bytes) VALUES (1,1,33554432)",
  );
  await db.exec("DROP TRIGGER native_delivery_quota_update");
  await expect(initQuota(db)).rejects.toThrow(/triggers are missing/);
});

it("reopens without rescanning and keeps parity across a restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "native-delivery-quota-"));
  dirs.push(dir);
  const path = join(dir, "host.db");
  const first = await journal(path);
  await initQuota(first);
  await insert(first, { id: "persisted", reserved: 300 });
  await insert(first, { id: "persisted-null", principal: P2, reserved: null });
  await first.close();
  databases.splice(databases.indexOf(first), 1);

  const second = await journal(path);
  const statements: string[] = [];
  const prepare = second.prepare.bind(second);
  vi.spyOn(second, "prepare").mockImplementation((sql: string) => {
    statements.push(sql);
    return prepare(sql);
  });
  await initQuota(second);
  expect(statements.some((sql) => sql.includes("native_delivery_receipts r"))).toBe(false);
  expect(statements.some((sql) => sql.includes("typeof(environment_id)"))).toBe(false);
  await expectParity(second);
  expect(await readNativeDeliveryQuota(second, ENV, P1)).toEqual({
    total: 2,
    own: 1,
    bytes: 300 + MAX,
    ownBytes: 300,
  });
});

it("reads zero for scopes without receipts and stays idempotent", async () => {
  const db = await journal();
  await initQuota(db);
  await initQuota(db);
  expect(await readNativeDeliveryQuota(db, "env-empty", "nobody")).toEqual({
    total: 0,
    own: 0,
    bytes: 0,
    ownBytes: 0,
  });
  await insert(db, { id: "only-row", reserved: 42 });
  expect(await readNativeDeliveryQuota(db, ENV, P2)).toEqual({
    total: 1,
    own: 0,
    bytes: 42,
    ownBytes: 0,
  });
  await expectParity(db);
});

it("refuses a missing scope counter when the receipt index proves history exists", async () => {
  const db = await journal();
  await initQuota(db);
  await insert(db, { id: "retained", reserved: 42 });
  await db
    .prepare("DELETE FROM native_delivery_quota_scopes WHERE environment_id=? AND principal_id=?")
    .run(ENV, P1);
  await expect(readNativeDeliveryQuota(db, ENV, P1)).rejects.toThrow(/scope counters are missing/);
});
