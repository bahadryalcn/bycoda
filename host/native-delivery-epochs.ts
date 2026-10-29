import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import type { HostStore } from "./store";
import type { StoreDatabase } from "./store-db";
import type { NativeDeliveryKind } from "./native-delivery-store";
import type { NativeDeliveryIdentity } from "../src/shared/model/host-contracts/native-delivery-identity";
import {
  parseNativeDeliveryEpochOriginalId,
  type NativeDeliveryEpochDescription,
  type NativeDeliveryEpochFence,
  type NativeDeliveryEpochOriginal,
  type NativeDeliveryEpochRef,
} from "../src/shared/model/host-contracts/native-delivery-epochs";

const MAX = Number.MAX_SAFE_INTEGER;
const WINDOW = 65_536;
const MAX_OWNERS = 65_536;
const MAX_OWN_PRINCIPAL = 4096;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/;
const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");
const BUFFER_HASH = hash('{"acknowledged":true}');
const FINISH_HASH = hash('{"accepted":true}');
const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const failure = (code = "CORRUPT") =>
  new Error(`NATIVE_DELIVERY_EPOCH_${code}: retained delivery namespace is unavailable or fenced`);
const boundedScope = (value: string) => {
  if (typeof value !== "string" || !value || Buffer.byteLength(value) > 256) throw failure("SCOPE");
};
const sqlInteger = (value: string, minimum = 0) =>
  `(typeof(${value})='integer' AND ${value} BETWEEN ${minimum} AND ${MAX})`;
const sqlUuid = (
  value: string,
) => `(typeof(${value})='text' AND length(${value})=36 AND ${value}=lower(${value}) AND ${value} NOT GLOB '*[^0-9a-f-]*'
  AND length(replace(${value},'-',''))=32 AND substr(${value},9,1)='-' AND substr(${value},14,1)='-' AND substr(${value},19,1)='-' AND substr(${value},24,1)='-'
  AND substr(${value},15,1)='4' AND substr(${value},20,1) IN ('8','9','a','b'))`;
const columns = "environment_id,principal_id,owner_id,generation,open_id,through,high_water,closed";
const ownerMatch = (a: string, b: string) =>
  [
    "environment_id",
    "principal_id",
    "owner_id",
    "generation",
    "open_id",
    "through",
    "high_water",
    "closed",
  ]
    .map((key) => `${a}.${key}=${b}.${key}`)
    .join(" AND ");
const ownerShape = (
  row: string,
) => `(${sqlUuid(`${row}.owner_id`)} AND ${sqlUuid(`${row}.open_id`)} AND ${sqlInteger(`${row}.generation`, 1)}
  AND ${sqlInteger(`${row}.through`)} AND ${sqlInteger(`${row}.high_water`)} AND ${row}.high_water>=${row}.through AND ${row}.high_water-${row}.through<=${WINDOW}
  AND ${row}.closed IN (0,1) AND (${row}.closed=0 OR ${row}.through=${row}.high_water)
  AND typeof(${row}.environment_id)='text' AND length(CAST(${row}.environment_id AS BLOB)) BETWEEN 1 AND 256
  AND typeof(${row}.principal_id)='text' AND length(CAST(${row}.principal_id AS BLOB)) BETWEEN 1 AND 256)`;
const retired = (
  row: string,
) => `(${row}.state='retired' AND ${row}.reserved_bytes=0 AND ${row}.result_json IS NULL AND ${row}.proof_json IS NULL
  AND typeof(${row}.consumed_sha256)='text' AND length(${row}.consumed_sha256)=64 AND ${row}.consumed_sha256 NOT GLOB '*[^0-9a-f]*'
  AND ${sqlInteger(`${row}.consumed_bytes`, 1)} AND ${row}.consumed_bytes<=33554432
  AND ((${row}.kind='buffer' AND ${row}.consumed_bytes=21 AND ${row}.consumed_sha256='${BUFFER_HASH}')
    OR (${row}.kind='native.services.conversation.desktop.finish' AND ${row}.consumed_bytes=17 AND ${row}.consumed_sha256='${FINISH_HASH}')
    OR ${row}.kind='native.services.workspace.format'))`;

/** Called only by the actual receipt initializer's admitted FULL transaction. */
export async function initializeNativeDeliveryEpochs(db: StoreDatabase): Promise<void> {
  db.assertCriticalScope();
  const receiptColumns = await db.prepare("PRAGMA table_info(native_delivery_receipts)").all();
  for (const [name, type] of [
    ["epoch_owner_id", "TEXT"],
    ["epoch_generation", "INTEGER"],
    ["epoch_sequence", "INTEGER"],
  ])
    if (!receiptColumns.some((column) => column.name === name))
      await db.exec(`ALTER TABLE native_delivery_receipts ADD COLUMN ${name} ${type}`);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS native_delivery_epoch_counter (id INTEGER PRIMARY KEY CHECK(id=1),root_id TEXT NOT NULL,generation INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS native_delivery_epoch_counter_witness (id INTEGER PRIMARY KEY CHECK(id=1),root_id TEXT NOT NULL,generation INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS native_delivery_protocol_floors (environment_id TEXT NOT NULL,principal_id TEXT NOT NULL,min_version INTEGER NOT NULL,open_id TEXT NOT NULL,generation INTEGER NOT NULL,PRIMARY KEY(environment_id,principal_id));
    CREATE TABLE IF NOT EXISTS native_delivery_protocol_witnesses (environment_id TEXT NOT NULL,principal_id TEXT NOT NULL,min_version INTEGER NOT NULL,open_id TEXT NOT NULL,generation INTEGER NOT NULL,PRIMARY KEY(environment_id,principal_id));
    CREATE TABLE IF NOT EXISTS native_delivery_epochs (environment_id TEXT NOT NULL,principal_id TEXT NOT NULL,owner_id TEXT NOT NULL UNIQUE,generation INTEGER NOT NULL UNIQUE,open_id TEXT NOT NULL,through INTEGER NOT NULL,high_water INTEGER NOT NULL,closed INTEGER NOT NULL,PRIMARY KEY(environment_id,principal_id,owner_id,generation),UNIQUE(environment_id,principal_id,open_id));
    CREATE TABLE IF NOT EXISTS native_delivery_epoch_witnesses (environment_id TEXT NOT NULL,principal_id TEXT NOT NULL,owner_id TEXT NOT NULL UNIQUE,generation INTEGER NOT NULL UNIQUE,open_id TEXT NOT NULL,through INTEGER NOT NULL,high_water INTEGER NOT NULL,closed INTEGER NOT NULL,PRIMARY KEY(environment_id,principal_id,owner_id,generation),UNIQUE(environment_id,principal_id,open_id));
    CREATE UNIQUE INDEX IF NOT EXISTS native_delivery_receipt_epoch ON native_delivery_receipts(environment_id,principal_id,epoch_owner_id,epoch_generation,epoch_sequence);
  `);
  const counter = await db
    .prepare("SELECT root_id,generation FROM native_delivery_epoch_counter WHERE id=1")
    .get();
  const witness = await db
    .prepare("SELECT root_id,generation FROM native_delivery_epoch_counter_witness WHERE id=1")
    .get();
  if (!counter && !witness) {
    const evidence = await db
      .prepare(`SELECT 1 AS present FROM native_delivery_epochs UNION ALL SELECT 1 FROM native_delivery_epoch_witnesses
      UNION ALL SELECT 1 FROM native_delivery_protocol_floors UNION ALL SELECT 1 FROM native_delivery_protocol_witnesses
      UNION ALL SELECT 1 FROM native_delivery_receipts WHERE substr(original_id,1,4)='nd2:' LIMIT 1`)
      .get();
    if (evidence) throw failure();
    const root = randomUUID();
    await db.prepare("INSERT INTO native_delivery_epoch_counter VALUES (1,?,0)").run(root);
    await db.prepare("INSERT INTO native_delivery_epoch_counter_witness VALUES (1,?,0)").run(root);
  } else if (
    !counter ||
    !witness ||
    !UUID.test(String(counter.root_id)) ||
    counter.root_id !== witness.root_id ||
    !integer(counter.generation) ||
    counter.generation !== witness.generation
  )
    throw failure();
  const healthyGlobal = `EXISTS(SELECT 1 FROM native_delivery_epoch_counter c JOIN native_delivery_epoch_counter_witness w ON c.id=w.id AND c.root_id=w.root_id AND c.generation=w.generation WHERE c.id=1 AND ${sqlInteger("c.generation")})`;
  const healthyProtocol = (
    environment: string,
    principal: string,
  ) => `EXISTS(SELECT 1 FROM native_delivery_protocol_floors f JOIN native_delivery_protocol_witnesses w
    ON f.environment_id=w.environment_id AND f.principal_id=w.principal_id AND f.min_version=w.min_version AND f.open_id=w.open_id AND f.generation=w.generation
    WHERE f.environment_id=${environment} AND f.principal_id=${principal} AND f.min_version=2)`;
  const epochReceipt = `(${sqlUuid("NEW.epoch_owner_id")} AND ${sqlInteger("NEW.epoch_generation", 1)} AND ${sqlInteger("NEW.epoch_sequence", 1)}
    AND NEW.original_id='nd2:'||NEW.epoch_owner_id||':'||NEW.epoch_generation||':'||NEW.epoch_sequence
    AND typeof(NEW.sha256)='text' AND length(NEW.sha256)=64 AND NEW.sha256 NOT GLOB '*[^0-9a-f]*'
    AND ${sqlInteger("NEW.byte_length", 1)} AND NEW.byte_length<=16777216
    AND NEW.kind IN ('buffer','native.services.conversation.desktop.finish','native.services.workspace.format') AND NEW.state='admitted')`;
  await db.exec(`
    CREATE TRIGGER IF NOT EXISTS native_delivery_epoch_counter_insert BEFORE INSERT ON native_delivery_epoch_counter BEGIN
      SELECT CASE WHEN EXISTS(SELECT 1 FROM native_delivery_epoch_counter WHERE id=NEW.id)
        OR EXISTS(SELECT 1 FROM native_delivery_epoch_counter_witness) OR EXISTS(SELECT 1 FROM native_delivery_epoch_witnesses) OR EXISTS(SELECT 1 FROM native_delivery_epochs)
        OR EXISTS(SELECT 1 FROM native_delivery_protocol_witnesses) OR EXISTS(SELECT 1 FROM native_delivery_protocol_floors) OR NEW.generation<>0 OR NOT ${sqlUuid("NEW.root_id")}
        THEN RAISE(ABORT,'NATIVE_DELIVERY_EPOCH_COUNTER_REPLACE') END;
    END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_epoch_counter_update BEFORE UPDATE ON native_delivery_epoch_counter BEGIN
      SELECT CASE WHEN NEW.id<>OLD.id OR NEW.root_id<>OLD.root_id OR NOT ${sqlInteger("NEW.generation")} OR NEW.generation<>OLD.generation+1
        OR NOT EXISTS(SELECT 1 FROM native_delivery_epoch_counter_witness w WHERE w.id=OLD.id AND w.root_id=OLD.root_id AND w.generation=OLD.generation)
        THEN RAISE(ABORT,'NATIVE_DELIVERY_EPOCH_COUNTER_FENCED') END;
    END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_epoch_counter_sync AFTER UPDATE ON native_delivery_epoch_counter BEGIN
      UPDATE native_delivery_epoch_counter_witness SET generation=NEW.generation WHERE id=NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_epoch_counter_delete BEFORE DELETE ON native_delivery_epoch_counter BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_EPOCH_COUNTER_HELD'); END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_epoch_counter_witness_insert BEFORE INSERT ON native_delivery_epoch_counter_witness BEGIN
      SELECT CASE WHEN EXISTS(SELECT 1 FROM native_delivery_epoch_counter_witness WHERE id=NEW.id) OR NEW.generation<>0
        OR EXISTS(SELECT 1 FROM native_delivery_epoch_witnesses) OR EXISTS(SELECT 1 FROM native_delivery_epochs) OR EXISTS(SELECT 1 FROM native_delivery_protocol_witnesses) OR EXISTS(SELECT 1 FROM native_delivery_protocol_floors)
        OR NOT EXISTS(SELECT 1 FROM native_delivery_epoch_counter c WHERE c.id=NEW.id AND c.root_id=NEW.root_id AND c.generation=NEW.generation)
        THEN RAISE(ABORT,'NATIVE_DELIVERY_EPOCH_COUNTER_REPLACE') END;
    END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_epoch_counter_witness_update BEFORE UPDATE ON native_delivery_epoch_counter_witness BEGIN
      SELECT CASE WHEN NEW.id<>OLD.id OR NEW.root_id<>OLD.root_id OR NEW.generation<OLD.generation
        OR NOT EXISTS(SELECT 1 FROM native_delivery_epoch_counter c WHERE c.id=NEW.id AND c.root_id=NEW.root_id AND c.generation=NEW.generation)
        THEN RAISE(ABORT,'NATIVE_DELIVERY_EPOCH_COUNTER_WITNESS') END;
    END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_epoch_counter_witness_delete BEFORE DELETE ON native_delivery_epoch_counter_witness BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_EPOCH_COUNTER_HELD'); END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_protocol_insert BEFORE INSERT ON native_delivery_protocol_floors BEGIN
      SELECT CASE WHEN EXISTS(SELECT 1 FROM native_delivery_protocol_floors WHERE environment_id=NEW.environment_id AND principal_id=NEW.principal_id)
        OR EXISTS(SELECT 1 FROM native_delivery_protocol_witnesses WHERE environment_id=NEW.environment_id AND principal_id=NEW.principal_id)
        OR NEW.min_version<>2 OR NOT ${sqlUuid("NEW.open_id")} OR NOT ${sqlInteger("NEW.generation", 1)} OR NOT ${healthyGlobal}
        OR NOT EXISTS(SELECT 1 FROM native_delivery_epoch_counter WHERE id=1 AND generation=NEW.generation)
        THEN RAISE(ABORT,'NATIVE_DELIVERY_PROTOCOL_FENCED') END;
    END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_protocol_sync AFTER INSERT ON native_delivery_protocol_floors BEGIN INSERT INTO native_delivery_protocol_witnesses VALUES(NEW.environment_id,NEW.principal_id,NEW.min_version,NEW.open_id,NEW.generation); END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_protocol_update BEFORE UPDATE ON native_delivery_protocol_floors BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_PROTOCOL_IMMUTABLE'); END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_protocol_delete BEFORE DELETE ON native_delivery_protocol_floors BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_PROTOCOL_HELD'); END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_protocol_witness_insert BEFORE INSERT ON native_delivery_protocol_witnesses BEGIN
      SELECT CASE WHEN EXISTS(SELECT 1 FROM native_delivery_protocol_witnesses WHERE environment_id=NEW.environment_id AND principal_id=NEW.principal_id)
        OR NOT EXISTS(SELECT 1 FROM native_delivery_protocol_floors f WHERE f.environment_id=NEW.environment_id AND f.principal_id=NEW.principal_id AND f.min_version=NEW.min_version AND f.open_id=NEW.open_id AND f.generation=NEW.generation)
        THEN RAISE(ABORT,'NATIVE_DELIVERY_PROTOCOL_WITNESS') END;
    END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_protocol_witness_update BEFORE UPDATE ON native_delivery_protocol_witnesses BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_PROTOCOL_IMMUTABLE'); END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_protocol_witness_delete BEFORE DELETE ON native_delivery_protocol_witnesses BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_PROTOCOL_HELD'); END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_epoch_insert BEFORE INSERT ON native_delivery_epochs BEGIN
      SELECT CASE WHEN EXISTS(SELECT 1 FROM native_delivery_epochs WHERE owner_id=NEW.owner_id OR generation=NEW.generation OR (environment_id=NEW.environment_id AND principal_id=NEW.principal_id AND open_id=NEW.open_id))
        OR EXISTS(SELECT 1 FROM native_delivery_epoch_witnesses WHERE owner_id=NEW.owner_id OR generation=NEW.generation OR (environment_id=NEW.environment_id AND principal_id=NEW.principal_id AND open_id=NEW.open_id))
        OR NOT ${ownerShape("NEW")} OR NEW.through<>0 OR NEW.high_water<>0 OR NEW.closed<>0 OR NOT ${healthyGlobal}
        OR NOT ${healthyProtocol("NEW.environment_id", "NEW.principal_id")} OR NOT EXISTS(SELECT 1 FROM native_delivery_epoch_counter WHERE id=1 AND generation=NEW.generation)
        THEN RAISE(ABORT,'NATIVE_DELIVERY_EPOCH_OWNER_FENCED') END;
    END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_epoch_insert_sync AFTER INSERT ON native_delivery_epochs BEGIN INSERT INTO native_delivery_epoch_witnesses(${columns}) VALUES(NEW.environment_id,NEW.principal_id,NEW.owner_id,NEW.generation,NEW.open_id,NEW.through,NEW.high_water,NEW.closed); END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_epoch_update BEFORE UPDATE ON native_delivery_epochs BEGIN
      SELECT CASE WHEN NOT ${ownerShape("NEW")} OR NEW.environment_id<>OLD.environment_id OR NEW.principal_id<>OLD.principal_id OR NEW.owner_id<>OLD.owner_id OR NEW.generation<>OLD.generation OR NEW.open_id<>OLD.open_id
        OR NEW.through<OLD.through OR NEW.through-OLD.through>32 OR NEW.high_water<OLD.high_water OR NEW.closed<OLD.closed
        OR (OLD.closed=1 AND (NEW.through<>OLD.through OR NEW.high_water<>OLD.high_water))
        OR NOT EXISTS(SELECT 1 FROM native_delivery_epoch_witnesses w WHERE ${ownerMatch("w", "OLD")})
        OR (NEW.high_water>OLD.high_water AND (NEW.through<>OLD.through OR NEW.closed<>OLD.closed OR NOT EXISTS(SELECT 1 FROM native_delivery_receipts r WHERE r.environment_id=OLD.environment_id AND r.principal_id=OLD.principal_id AND r.epoch_owner_id=OLD.owner_id AND r.epoch_generation=OLD.generation AND r.epoch_sequence=NEW.high_water AND r.state='admitted')))
        OR (NEW.through>OLD.through AND ((SELECT COUNT(*) FROM native_delivery_receipts r WHERE r.environment_id=OLD.environment_id AND r.principal_id=OLD.principal_id AND r.epoch_owner_id=OLD.owner_id AND r.epoch_generation=OLD.generation AND r.epoch_sequence>OLD.through AND r.epoch_sequence<=NEW.through)<>NEW.through-OLD.through
          OR EXISTS(SELECT 1 FROM native_delivery_receipts r WHERE r.environment_id=OLD.environment_id AND r.principal_id=OLD.principal_id AND r.epoch_owner_id=OLD.owner_id AND r.epoch_generation=OLD.generation AND r.epoch_sequence>OLD.through AND r.epoch_sequence<=NEW.through AND NOT coalesce(${retired("r")},0))))
        OR (NEW.closed=1 AND EXISTS(SELECT 1 FROM native_delivery_receipts r WHERE r.environment_id=OLD.environment_id AND r.principal_id=OLD.principal_id AND r.epoch_owner_id=OLD.owner_id AND r.epoch_generation=OLD.generation AND r.epoch_sequence>NEW.through))
        THEN RAISE(ABORT,'NATIVE_DELIVERY_EPOCH_FLOOR_FENCED') END;
    END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_epoch_update_sync AFTER UPDATE ON native_delivery_epochs BEGIN UPDATE native_delivery_epoch_witnesses SET through=NEW.through,high_water=NEW.high_water,closed=NEW.closed WHERE environment_id=NEW.environment_id AND principal_id=NEW.principal_id AND owner_id=NEW.owner_id AND generation=NEW.generation; END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_epoch_delete BEFORE DELETE ON native_delivery_epochs BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_EPOCH_OWNER_HELD'); END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_epoch_witness_insert BEFORE INSERT ON native_delivery_epoch_witnesses BEGIN
      SELECT CASE WHEN EXISTS(SELECT 1 FROM native_delivery_epoch_witnesses WHERE owner_id=NEW.owner_id OR generation=NEW.generation OR (environment_id=NEW.environment_id AND principal_id=NEW.principal_id AND open_id=NEW.open_id))
        OR NOT EXISTS(SELECT 1 FROM native_delivery_epochs o WHERE ${ownerMatch("o", "NEW")}) THEN RAISE(ABORT,'NATIVE_DELIVERY_EPOCH_WITNESS') END;
    END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_epoch_witness_update BEFORE UPDATE ON native_delivery_epoch_witnesses BEGIN
      SELECT CASE WHEN NEW.environment_id<>OLD.environment_id OR NEW.principal_id<>OLD.principal_id OR NEW.owner_id<>OLD.owner_id OR NEW.generation<>OLD.generation OR NEW.open_id<>OLD.open_id
        OR NEW.through<OLD.through OR NEW.high_water<OLD.high_water OR NEW.closed<OLD.closed OR NOT EXISTS(SELECT 1 FROM native_delivery_epochs o WHERE ${ownerMatch("o", "NEW")})
        THEN RAISE(ABORT,'NATIVE_DELIVERY_EPOCH_WITNESS') END;
    END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_epoch_witness_delete BEFORE DELETE ON native_delivery_epoch_witnesses BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_EPOCH_OWNER_HELD'); END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_receipt_insert BEFORE INSERT ON native_delivery_receipts BEGIN
      SELECT CASE WHEN EXISTS(SELECT 1 FROM native_delivery_receipts WHERE environment_id=NEW.environment_id AND principal_id=NEW.principal_id AND original_id=NEW.original_id) THEN RAISE(ABORT,'NATIVE_DELIVERY_ORIGINAL_REPLACE') END;
      SELECT CASE WHEN substr(NEW.original_id,1,4)<>'nd2:' AND (NEW.epoch_owner_id IS NOT NULL OR NEW.epoch_generation IS NOT NULL OR NEW.epoch_sequence IS NOT NULL
        OR EXISTS(SELECT 1 FROM native_delivery_protocol_floors WHERE environment_id=NEW.environment_id AND principal_id=NEW.principal_id)
        OR EXISTS(SELECT 1 FROM native_delivery_protocol_witnesses WHERE environment_id=NEW.environment_id AND principal_id=NEW.principal_id)
        OR EXISTS(SELECT 1 FROM native_delivery_epoch_witnesses WHERE environment_id=NEW.environment_id AND principal_id=NEW.principal_id)
        OR EXISTS(SELECT 1 FROM native_delivery_epochs WHERE environment_id=NEW.environment_id AND principal_id=NEW.principal_id)) THEN RAISE(ABORT,'NATIVE_DELIVERY_PROTOCOL_FENCED') END;
      SELECT CASE WHEN substr(NEW.original_id,1,4)='nd2:' AND (NOT coalesce(${epochReceipt},0) OR NOT ${healthyGlobal}
        OR NOT ${healthyProtocol("NEW.environment_id", "NEW.principal_id")}
        OR NOT EXISTS(SELECT 1 FROM native_delivery_epochs o JOIN native_delivery_epoch_witnesses w ON ${ownerMatch("o", "w")}
          WHERE o.environment_id=NEW.environment_id AND o.principal_id=NEW.principal_id AND o.owner_id=NEW.epoch_owner_id AND o.generation=NEW.epoch_generation AND o.closed=0 AND NEW.epoch_sequence-o.through BETWEEN 1 AND ${WINDOW}))
        THEN RAISE(ABORT,'NATIVE_DELIVERY_EPOCH_FENCED') END;
    END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_receipt_insert_epoch AFTER INSERT ON native_delivery_receipts WHEN NEW.epoch_owner_id IS NOT NULL BEGIN
      UPDATE native_delivery_epochs SET high_water=NEW.epoch_sequence WHERE environment_id=NEW.environment_id AND principal_id=NEW.principal_id AND owner_id=NEW.epoch_owner_id AND generation=NEW.epoch_generation AND high_water<NEW.epoch_sequence;
    END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_receipt_identity BEFORE UPDATE OF environment_id,principal_id,kind,original_id,sha256,byte_length,epoch_owner_id,epoch_generation,epoch_sequence ON native_delivery_receipts
      WHEN NEW.environment_id IS NOT OLD.environment_id OR NEW.principal_id IS NOT OLD.principal_id OR NEW.kind IS NOT OLD.kind OR NEW.original_id IS NOT OLD.original_id OR NEW.sha256 IS NOT OLD.sha256 OR NEW.byte_length IS NOT OLD.byte_length OR NEW.epoch_owner_id IS NOT OLD.epoch_owner_id OR NEW.epoch_generation IS NOT OLD.epoch_generation OR NEW.epoch_sequence IS NOT OLD.epoch_sequence
      BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_IDENTITY_IMMUTABLE'); END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_epoch_result_identity BEFORE UPDATE OF consumed_sha256,consumed_bytes,result_sha256,result_bytes ON native_delivery_receipts
      WHEN OLD.epoch_owner_id IS NOT NULL AND ((OLD.consumed_sha256 IS NOT NULL AND NEW.consumed_sha256 IS NOT OLD.consumed_sha256)
        OR (OLD.consumed_bytes IS NOT NULL AND NEW.consumed_bytes IS NOT OLD.consumed_bytes)
        OR (OLD.result_sha256 IS NOT NULL AND NEW.result_sha256 IS NOT OLD.result_sha256)
        OR (OLD.result_bytes IS NOT NULL AND NEW.result_bytes IS NOT OLD.result_bytes))
      BEGIN SELECT RAISE(ABORT,'NATIVE_DELIVERY_RESULT_IMMUTABLE'); END;
    CREATE TRIGGER IF NOT EXISTS native_delivery_receipt_delete BEFORE DELETE ON native_delivery_receipts BEGIN
      SELECT CASE WHEN OLD.epoch_owner_id IS NULL OR NOT coalesce(${retired("OLD")},0) OR NOT EXISTS(SELECT 1 FROM native_delivery_epochs o JOIN native_delivery_epoch_witnesses w ON ${ownerMatch("o", "w")}
        WHERE o.environment_id=OLD.environment_id AND o.principal_id=OLD.principal_id AND o.owner_id=OLD.epoch_owner_id AND o.generation=OLD.epoch_generation AND OLD.epoch_sequence<=o.through)
        THEN RAISE(ABORT,'NATIVE_DELIVERY_ORIGINAL_HELD') END;
    END;
  `);
  await globalGeneration(db);
}

type Execution = {
  store: HostStore;
  principal: string;
  kind: NativeDeliveryKind;
  identity: NativeDeliveryIdentity;
  active: boolean;
};
const execution = new AsyncLocalStorage<Execution>();

function description(row: Record<string, unknown>): NativeDeliveryEpochDescription {
  if (
    !UUID.test(String(row.owner_id)) ||
    !UUID.test(String(row.open_id)) ||
    !integer(row.generation) ||
    row.generation < 1 ||
    !integer(row.through) ||
    !integer(row.high_water) ||
    row.high_water < row.through ||
    row.high_water - row.through > WINDOW ||
    (row.closed !== 0 && row.closed !== 1) ||
    (row.closed === 1 && row.through !== row.high_water)
  )
    throw failure();
  return {
    version: 2,
    openId: String(row.open_id),
    ownerId: String(row.owner_id),
    generation: row.generation,
    through: row.through,
    highWater: row.high_water,
    closed: row.closed === 1,
  };
}
async function globalGeneration(db: StoreDatabase): Promise<number> {
  const value = await db
    .prepare(
      "SELECT c.root_id,c.generation,w.root_id AS witness_root,w.generation AS witness_generation FROM native_delivery_epoch_counter c LEFT JOIN native_delivery_epoch_counter_witness w ON w.id=c.id WHERE c.id=1",
    )
    .get();
  if (
    !value ||
    !UUID.test(String(value.root_id)) ||
    value.root_id !== value.witness_root ||
    !integer(value.generation) ||
    value.generation !== value.witness_generation
  )
    throw failure();
  // Epoch headers never retire. The independent global counter therefore
  // commits to a complete, contiguous population, including compacted owners.
  // Checking only MAX would let a lost header+witness pair look like a new
  // deterministic open intent and admit a restored producer a second time.
  const coverage = await db
    .prepare(`SELECT
      (SELECT COUNT(*) FROM native_delivery_epochs) AS owners,
      (SELECT COUNT(*) FROM native_delivery_epoch_witnesses) AS witnesses,
      COUNT(*) AS matched,MAX(o.generation) AS maximum
      FROM native_delivery_epochs o JOIN native_delivery_epoch_witnesses w ON ${ownerMatch("o", "w")}
      WHERE ${sqlInteger("o.generation", 1)}`)
    .get();
  if (
    !coverage ||
    coverage.owners !== value.generation ||
    coverage.witnesses !== value.generation ||
    coverage.matched !== value.generation ||
    (value.generation === 0 ? coverage.maximum !== null : coverage.maximum !== value.generation)
  )
    throw failure();
  return value.generation;
}
async function protocol(store: HostStore, principal: string): Promise<0 | 2> {
  boundedScope(principal);
  const key = [store.environmentId, principal];
  const floor = await store.db
    .prepare(
      "SELECT min_version,open_id,generation FROM native_delivery_protocol_floors WHERE environment_id=? AND principal_id=?",
    )
    .get(...key);
  const witness = await store.db
    .prepare(
      "SELECT min_version,open_id,generation FROM native_delivery_protocol_witnesses WHERE environment_id=? AND principal_id=?",
    )
    .get(...key);
  if (!floor && !witness) {
    const owner = await store.db
      .prepare(`SELECT owner_id FROM native_delivery_epoch_witnesses WHERE environment_id=? AND principal_id=?
      UNION ALL SELECT owner_id FROM native_delivery_epochs WHERE environment_id=? AND principal_id=?
      UNION ALL SELECT epoch_owner_id FROM native_delivery_receipts WHERE environment_id=? AND principal_id=? AND substr(original_id,1,4)='nd2:' LIMIT 1`)
      .get(...key, ...key, ...key);
    if (owner) throw failure();
    return 0;
  }
  if (
    !floor ||
    !witness ||
    floor.min_version !== 2 ||
    floor.min_version !== witness.min_version ||
    floor.open_id !== witness.open_id ||
    floor.generation !== witness.generation ||
    !UUID.test(String(floor.open_id)) ||
    !integer(floor.generation) ||
    floor.generation < 1
  )
    throw failure();
  const anchor = await store.db
    .prepare(`SELECT 1 AS present FROM native_delivery_epochs o JOIN native_delivery_epoch_witnesses w ON ${ownerMatch("o", "w")}
      WHERE o.environment_id=? AND o.principal_id=? AND o.open_id=? AND o.generation=?`)
    .get(...key, floor.open_id, floor.generation);
  if (!anchor) throw failure();
  return 2;
}

export function createNativeDeliveryEpochs(store: HostStore) {
  async function status(
    principal: string,
    ref: NativeDeliveryEpochRef,
  ): Promise<NativeDeliveryEpochDescription> {
    boundedScope(principal);
    if (!UUID.test(ref.ownerId) || !integer(ref.generation) || ref.generation < 1)
      throw failure("IDENTITY");
    return store.db.scope(async () => {
      const maximum = await globalGeneration(store.db);
      if (ref.generation > maximum || (await protocol(store, principal)) !== 2)
        throw failure("UNAVAILABLE");
      const args = [store.environmentId, principal, ref.ownerId, ref.generation];
      const row = await store.db
        .prepare(
          `SELECT ${columns} FROM native_delivery_epochs WHERE environment_id=? AND principal_id=? AND owner_id=? AND generation=?`,
        )
        .get(...args);
      const witness = await store.db
        .prepare(
          `SELECT ${columns} FROM native_delivery_epoch_witnesses WHERE environment_id=? AND principal_id=? AND owner_id=? AND generation=?`,
        )
        .get(...args);
      if (!row && !witness) throw failure("UNAVAILABLE");
      if (!row || !witness || JSON.stringify(row) !== JSON.stringify(witness)) throw failure();
      await store.db.checkAuthorization();
      return description(row);
    });
  }
  async function fence(
    principal: string,
    identity: NativeDeliveryIdentity,
  ): Promise<NativeDeliveryEpochFence | null> {
    const original = parseNativeDeliveryEpochOriginalId(identity.originalId);
    if (!original) return null;
    const owner = await status(principal, original);
    return owner.closed || original.sequence <= owner.through
      ? {
          ownerId: owner.ownerId,
          generation: owner.generation,
          through: owner.through,
          closed: owner.closed,
        }
      : null;
  }
  async function assertAdmission(
    principal: string,
    identity: NativeDeliveryIdentity,
  ): Promise<NativeDeliveryEpochOriginal | null> {
    const original = parseNativeDeliveryEpochOriginalId(identity.originalId);
    if (!original) {
      if ((await protocol(store, principal)) === 2) throw failure("PROTOCOL_FENCED");
      return null;
    }
    const owner = await status(principal, original);
    if (owner.closed || original.sequence <= owner.through) throw failure("FENCED");
    if (original.sequence - owner.through > WINDOW) throw failure("WINDOW");
    return original;
  }
  async function change(
    principal: string,
    input: NativeDeliveryEpochRef & { expectedThrough: number; through: number },
    close: boolean,
  ): Promise<NativeDeliveryEpochDescription> {
    if (
      !integer(input.expectedThrough) ||
      !integer(input.through) ||
      input.through < input.expectedThrough ||
      input.through - input.expectedThrough > 32
    )
      throw failure("RANGE");
    return store.transaction(async () => {
      const owner = await status(principal, input);
      if (owner.through !== input.expectedThrough) throw failure("CAS");
      if (
        input.through > owner.highWater ||
        (close && input.through !== owner.highWater) ||
        (owner.closed && input.through !== owner.through)
      )
        throw failure("CLOSE");
      const rows = await store.db
        .prepare(`SELECT original_id,epoch_owner_id,epoch_generation,epoch_sequence,kind,state,sha256,byte_length,consumed_sha256,consumed_bytes,reserved_bytes,result_json IS NULL AS no_result,proof_json IS NULL AS no_proof
        FROM native_delivery_receipts WHERE environment_id=? AND principal_id=? AND epoch_owner_id=? AND epoch_generation=? AND epoch_sequence>? AND epoch_sequence<=? ORDER BY epoch_sequence LIMIT 33`)
        .all(
          store.environmentId,
          principal,
          owner.ownerId,
          owner.generation,
          owner.through,
          input.through,
        );
      if (rows.length !== input.through - owner.through) throw failure("HOLE");
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index],
          parsed = parseNativeDeliveryEpochOriginalId(String(row.original_id));
        if (
          !parsed ||
          parsed.ownerId !== owner.ownerId ||
          parsed.generation !== owner.generation ||
          parsed.sequence !== owner.through + index + 1 ||
          row.epoch_owner_id !== parsed.ownerId ||
          row.epoch_generation !== parsed.generation ||
          row.epoch_sequence !== parsed.sequence ||
          row.state !== "retired" ||
          row.reserved_bytes !== 0 ||
          row.no_result !== 1 ||
          row.no_proof !== 1 ||
          !/^[a-f0-9]{64}$/.test(String(row.sha256)) ||
          !integer(row.byte_length) ||
          row.byte_length < 1 ||
          row.byte_length > 16777216 ||
          !/^[a-f0-9]{64}$/.test(String(row.consumed_sha256)) ||
          !integer(row.consumed_bytes) ||
          row.consumed_bytes < 1 ||
          row.consumed_bytes > 33554432 ||
          (row.kind === "buffer"
            ? row.consumed_sha256 !== BUFFER_HASH || row.consumed_bytes !== 21
            : row.kind === "native.services.conversation.desktop.finish"
              ? row.consumed_sha256 !== FINISH_HASH || row.consumed_bytes !== 17
              : row.kind !== "native.services.workspace.format")
        )
          throw failure("HOLE");
      }
      await store.db.checkAuthorization();
      const changed = await store.db
        .prepare(
          "UPDATE native_delivery_epochs SET through=?,closed=? WHERE environment_id=? AND principal_id=? AND owner_id=? AND generation=? AND through=?",
        )
        .run(
          input.through,
          close || owner.closed ? 1 : 0,
          store.environmentId,
          principal,
          owner.ownerId,
          owner.generation,
          owner.through,
        );
      if (Number(changed.changes) !== 1) throw failure("CAS");
      const deleted = await store.db
        .prepare(
          "DELETE FROM native_delivery_receipts WHERE environment_id=? AND principal_id=? AND epoch_owner_id=? AND epoch_generation=? AND epoch_sequence>? AND epoch_sequence<=?",
        )
        .run(
          store.environmentId,
          principal,
          owner.ownerId,
          owner.generation,
          owner.through,
          input.through,
        );
      if (Number(deleted.changes) !== rows.length) throw failure("CAS");
      return status(principal, input);
    });
  }
  return {
    status,
    fence,
    assertAdmission,
    async assertNotFenced(principal: string, identity: NativeDeliveryIdentity) {
      if (await fence(principal, identity)) throw failure("FENCED");
    },
    validateRow(row: Record<string, unknown>, identity: NativeDeliveryIdentity) {
      const parsed = parseNativeDeliveryEpochOriginalId(identity.originalId);
      if (
        parsed
          ? row.epoch_owner_id !== parsed.ownerId ||
            row.epoch_generation !== parsed.generation ||
            row.epoch_sequence !== parsed.sequence
          : row.epoch_owner_id != null || row.epoch_generation != null || row.epoch_sequence != null
      )
        throw failure();
    },
    async open(principal: string, openId: string): Promise<NativeDeliveryEpochDescription> {
      boundedScope(principal);
      if (!UUID.test(openId)) throw failure("IDENTITY");
      return store.transaction(async () => {
        await store.db.checkAuthorization();
        const generation = await globalGeneration(store.db),
          level = await protocol(store, principal);
        const key = [store.environmentId, principal, openId];
        const row = await store.db
          .prepare(
            "SELECT owner_id,generation FROM native_delivery_epochs WHERE environment_id=? AND principal_id=? AND open_id=?",
          )
          .get(...key);
        const witness = await store.db
          .prepare(
            "SELECT owner_id,generation FROM native_delivery_epoch_witnesses WHERE environment_id=? AND principal_id=? AND open_id=?",
          )
          .get(...key);
        if (row || witness) {
          if (
            !row ||
            !witness ||
            row.owner_id !== witness.owner_id ||
            row.generation !== witness.generation
          )
            throw failure();
          return status(principal, {
            ownerId: String(row.owner_id),
            generation: Number(row.generation),
          });
        }
        if (generation === MAX) throw failure("EXHAUSTED");
        const total = await store.db
          .prepare("SELECT COUNT(*) AS total FROM native_delivery_epoch_witnesses")
          .get();
        const own = await store.db
          .prepare(
            "SELECT COUNT(*) AS total FROM native_delivery_epoch_witnesses WHERE environment_id=? AND principal_id=?",
          )
          .get(store.environmentId, principal);
        if (Number(total?.total) >= MAX_OWNERS || Number(own?.total) >= MAX_OWN_PRINCIPAL)
          throw failure("CAPACITY");
        const next = generation + 1,
          ownerId = randomUUID();
        const changed = await store.db
          .prepare(
            "UPDATE native_delivery_epoch_counter SET generation=? WHERE id=1 AND generation=?",
          )
          .run(next, generation);
        if (Number(changed.changes) !== 1) throw failure("CAS");
        if (!level)
          await store.db
            .prepare("INSERT INTO native_delivery_protocol_floors VALUES (?,?,2,?,?)")
            .run(store.environmentId, principal, openId, next);
        await store.db
          .prepare(`INSERT INTO native_delivery_epochs(${columns}) VALUES (?,?,?,?,?,0,0,0)`)
          .run(store.environmentId, principal, ownerId, next, openId);
        return status(principal, { ownerId, generation: next });
      });
    },
    compact: (
      principal: string,
      input: NativeDeliveryEpochRef & { expectedThrough: number; through: number },
    ) => change(principal, input, false),
    close: (
      principal: string,
      input: NativeDeliveryEpochRef & { expectedThrough: number; through: number },
    ) => change(principal, input, true),
    async withAdmittedExecution<T>(
      principal: string,
      kind: NativeDeliveryKind,
      identity: NativeDeliveryIdentity,
      effect: () => Promise<T>,
    ): Promise<T> {
      if (!parseNativeDeliveryEpochOriginalId(identity.originalId)) return effect();
      const current: Execution = {
        store,
        principal,
        kind,
        identity: Object.freeze({ ...identity }),
        active: true,
      };
      try {
        return await execution.run(current, async () => {
          await assertNativeDeliveryEffect(store, principal, kind);
          return effect();
        });
      } finally {
        current.active = false;
      }
    },
  };
}

/** Bare legacy helpers may run only before v2 enrollment, or inside the actual v2 winner's live continuation. */
export async function assertNativeDeliveryEffect(
  store: HostStore,
  principal: string,
  kind: NativeDeliveryKind,
): Promise<void> {
  await store.db.scope(async () => {
    if ((await protocol(store, principal)) === 0) {
      await store.db.checkAuthorization();
      return;
    }
    const owner = execution.getStore();
    if (
      !owner?.active ||
      owner.store !== store ||
      owner.principal !== principal ||
      owner.kind !== kind
    )
      throw failure("PROTOCOL_FENCED");
    const epochs = createNativeDeliveryEpochs(store),
      parsed = await epochs.assertAdmission(principal, owner.identity);
    if (!parsed || !owner.active) throw failure("PROTOCOL_FENCED");
    const row = await store.db
      .prepare(
        "SELECT kind,sha256,byte_length,state,epoch_owner_id,epoch_generation,epoch_sequence FROM native_delivery_receipts WHERE environment_id=? AND principal_id=? AND original_id=?",
      )
      .get(store.environmentId, principal, owner.identity.originalId);
    if (
      !row ||
      row.kind !== kind ||
      row.sha256 !== owner.identity.sha256 ||
      row.byte_length !== owner.identity.byteLength ||
      row.state !== "admitted" ||
      !owner.active
    )
      throw failure("EXECUTION_FENCED");
    epochs.validateRow(row, owner.identity);
    await store.db.checkAuthorization();
  });
}
