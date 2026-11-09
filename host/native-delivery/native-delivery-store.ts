import type { HostStore } from "../store";
import type { StoreDatabase } from "../store-db";
import { createHash } from "node:crypto";
import type { NativeDeliveryIdentity } from "../../src/shared/model/host-contracts/native-delivery-identity";
import type { NativeDeliveryResultSource } from "../../src/shared/model/host-contracts/native-delivery-identity";
import type { NativeDeliveryConsumedResult } from "../../src/shared/model/host-contracts/native-delivery-identity";
import type { NativeBufferDeliveryProof } from "../domains/native-delivery/ports";
import {
  NATIVE_SERVICES_RPC_SCHEMAS,
  NATIVE_FORMAT_MAX_RESULT_BYTES,
} from "../../src/shared/model/host-contracts/native-services";
import {
  createNativeDeliveryEpochs,
  initializeNativeDeliveryEpochs,
} from "./native-delivery-epochs";
import {
  parseNativeDeliveryEpochOriginalId,
  type NativeDeliveryEpochFence,
} from "../../src/shared/model/host-contracts/native-delivery-epochs";

export type NativeDeliveryKind =
  | "buffer"
  | "native.services.conversation.desktop.finish"
  | "native.services.workspace.format";
export type NativeDeliveryRow = NativeDeliveryIdentity & {
  kind: NativeDeliveryKind;
  result?: unknown;
  resultSource?: NativeDeliveryResultSource;
  proof?: NativeBufferDeliveryProof;
  consumedResult?: NativeDeliveryConsumedResult;
  resultUnavailable?: true;
} & (
    | { state: "fenced"; epoch: NativeDeliveryEpochFence }
    | { state: "admitted" | "recorded" | "retired"; epoch?: never }
  );
// Retain legacy results; new formatter executions have a smaller enforced bound.
const MAX_RESULT_BYTES = 32 * 1024 * 1024;

const MAX_TOTAL_RESULT_BYTES = 64 * 1024 * 1024;
const MAX_PRINCIPAL_RESULT_BYTES = 32 * 1024 * 1024;
const MAX_ROWS = 1_000_000;
const MAX_PRINCIPAL_ROWS = 250_000;
// Fixed21/17-byte results live under the metadata row budget (<=21M global /5.25M per principal).
// The existing64MiB/32MiB bulk pool belongs to formatter results and their pre-effect reservations.
const INLINE_RESULT_BYTES = 1_048_576;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const warnedExecutionFailures = new Set<string>();
/** A failed native delivery leaves its original unknown on the device; log each distinct
 * cause once so a persistent failure is visible instead of silently filling the queue. */
function warnExecutionFailure(kind: string, error: unknown) {
  const message = `${kind}: ${error instanceof Error ? error.message : String(error)}`;
  if (warnedExecutionFailures.has(message) || warnedExecutionFailures.size >= 100) return;
  warnedExecutionFailures.add(message);
  console.warn(`Native delivery execution failed and remains unknown (${message})`);
}
const maximumResult = (kind: string) =>
  kind === "buffer"
    ? 21
    : kind === "native.services.conversation.desktop.finish"
      ? 17
      : MAX_RESULT_BYTES;
const digest = (raw: string): NativeDeliveryConsumedResult => ({
  sha256: sha(raw),
  byteLength: Buffer.byteLength(raw),
});
const sameDigest = (a: NativeDeliveryConsumedResult | undefined, b: NativeDeliveryConsumedResult) =>
  a?.sha256 === b.sha256 && a.byteLength === b.byteLength;
function storedDigest(hash: unknown, bytes: unknown): NativeDeliveryConsumedResult | undefined {
  return typeof hash === "string" &&
    /^[a-f0-9]{64}$/.test(hash) &&
    Number.isSafeInteger(bytes) &&
    Number(bytes) >= 1 &&
    Number(bytes) <= MAX_RESULT_BYTES
    ? { sha256: hash, byteLength: Number(bytes) }
    : undefined;
}

/** Only these finite results cross Native's serde_json::Value boundary. Its map keys sort. */
export function nativeDeliveryConsumedResult(kind: NativeDeliveryKind, value: unknown) {
  let raw: string;
  if (kind === "buffer") {
    if (
      !value ||
      typeof value !== "object" ||
      !("acknowledged" in value) ||
      value.acknowledged !== true
    )
      throw new Error("Invalid native buffer consumed result");
    raw = '{"acknowledged":true}';
  } else if (kind === "native.services.conversation.desktop.finish") {
    NATIVE_SERVICES_RPC_SCHEMAS[kind].result.parse(value);
    raw = '{"accepted":true}';
  } else {
    const result = NATIVE_SERVICES_RPC_SCHEMAS[kind].result.parse(value);
    if (result && /[\uD800-\uDFFF]/u.test(result.formatted))
      throw new Error("Native result cannot be represented by serde_json");
    raw = JSON.stringify(
      result === null
        ? null
        : {
            cursorOffset: result.cursorOffset,
            formatted: result.formatted,
          },
    );
  }
  return digest(raw);
}

/** Upgrade actual file databases before authority is exposed. Old uncertain rows remain held.
 * Bounded single-row reads avoid transporting a catalog of large retained results at once. */
export async function initializeNativeDeliveryStore(db: StoreDatabase) {
  await db.durableScope(async () => {
    await db.exec("BEGIN IMMEDIATE");
    try {
      await db.exec(`CREATE TABLE IF NOT EXISTS native_delivery_receipts (
        environment_id TEXT NOT NULL, principal_id TEXT NOT NULL, kind TEXT NOT NULL,
        original_id TEXT NOT NULL, sha256 TEXT NOT NULL, byte_length INTEGER NOT NULL,
        state TEXT NOT NULL, result_json TEXT, proof_json TEXT, result_sha256 TEXT, result_bytes INTEGER,
        consumed_sha256 TEXT, consumed_bytes INTEGER, reserved_bytes INTEGER,
        PRIMARY KEY(environment_id,principal_id,original_id)
      )`);
      const columns = await db.prepare("PRAGMA table_info(native_delivery_receipts)").all();
      for (const [name, type] of [
        ["result_sha256", "TEXT"],
        ["result_bytes", "INTEGER"],
        ["consumed_sha256", "TEXT"],
        ["consumed_bytes", "INTEGER"],
        ["reserved_bytes", "INTEGER"],
      ])
        if (!columns.some((column) => column.name === name))
          await db.exec(`ALTER TABLE native_delivery_receipts ADD COLUMN ${name} ${type}`);
      let cursor = 0;
      while (true) {
        const row = await db
          .prepare(`SELECT rowid AS migration_id, kind, state, result_sha256, result_bytes,
          length(CAST(result_json AS BLOB)) AS actual_bytes,
          CASE WHEN length(CAST(result_json AS BLOB))<=? THEN result_json ELSE NULL END AS bounded_result
          FROM native_delivery_receipts WHERE rowid>? AND reserved_bytes IS NULL ORDER BY rowid LIMIT 1`)
          .get(MAX_RESULT_BYTES, cursor);
        if (!row) break;
        cursor = Number(row.migration_id);
        let consumed: NativeDeliveryConsumedResult | undefined;
        let source: NativeDeliveryResultSource | undefined;
        if (row.state === "recorded" && typeof row.bounded_result === "string") {
          try {
            source = digest(row.bounded_result);
            if (
              (row.result_sha256 != null && row.result_sha256 !== source.sha256) ||
              (row.result_bytes != null && row.result_bytes !== source.byteLength)
            )
              throw new Error("Existing native delivery result identity changed");
            consumed = nativeDeliveryConsumedResult(
              row.kind as NativeDeliveryKind,
              JSON.parse(row.bounded_result),
            );
          } catch {
            source = undefined;
          }
        }
        // A corrupt or older uncertain row consumes at least the finite maximum. Never discard it.
        const reserved =
          source && consumed
            ? 0
            : Math.max(maximumResult(String(row.kind)), Number(row.actual_bytes ?? 0));
        await db
          .prepare(`UPDATE native_delivery_receipts SET reserved_bytes=?,
          result_sha256=COALESCE(result_sha256,?), result_bytes=COALESCE(result_bytes,?),
          consumed_sha256=?, consumed_bytes=? WHERE rowid=? AND reserved_bytes IS NULL`)
          .run(
            reserved,
            source?.sha256 ?? null,
            source?.byteLength ?? null,
            consumed?.sha256 ?? null,
            consumed?.byteLength ?? null,
            cursor,
          );
      }
      await initializeNativeDeliveryEpochs(db);
      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
}

/** Actual Host critical storage; external effects run outside SQL.
 * No TTL, active eviction, credential persistence or dispatch on lookup. */
export function createNativeDeliveryStore(store: HostStore) {
  const epochs = createNativeDeliveryEpochs(store);
  const key = (principal: string, kind: NativeDeliveryKind, identity: NativeDeliveryIdentity) =>
    [store.environmentId, principal, kind, identity.originalId] as const;
  const match = (row: Record<string, unknown>, identity: NativeDeliveryIdentity) => {
    if (row.sha256 !== identity.sha256 || row.byte_length !== identity.byteLength)
      throw new Error("Native delivery original identity conflicts with retained bytes");
  };
  async function read(
    principal: string,
    kind: NativeDeliveryKind,
    identity: NativeDeliveryIdentity,
  ): Promise<NativeDeliveryRow | null> {
    return store.db.scope(async () => {
      const epoch = await epochs.fence(principal, identity);
      if (epoch) return { ...identity, kind, state: "fenced", epoch };
      const meta = await store.db
        .prepare(`SELECT kind, sha256, byte_length, state, result_sha256, result_bytes,
        epoch_owner_id,epoch_generation,epoch_sequence,
        consumed_sha256, consumed_bytes, reserved_bytes,
        length(CAST(result_json AS BLOB)) AS actual_result_bytes, length(CAST(proof_json AS BLOB)) AS proof_bytes
        ,CASE WHEN length(CAST(result_json AS BLOB))<=? THEN result_json ELSE NULL END AS inline_result
        ,CASE WHEN length(CAST(proof_json AS BLOB))<=2048 THEN proof_json ELSE NULL END AS bounded_proof
        FROM native_delivery_receipts WHERE environment_id=? AND principal_id=? AND original_id=?`)
        .get(INLINE_RESULT_BYTES, store.environmentId, principal, identity.originalId);
      if (!meta) return null;
      epochs.validateRow(meta, identity);
      if (meta.kind !== kind)
        throw new Error("Native delivery original target conflicts with retained intent");
      match(meta, identity);
      if (
        !["admitted", "recorded", "retired"].includes(String(meta.state)) ||
        Number(meta.actual_result_bytes ?? 0) > MAX_RESULT_BYTES ||
        Number(meta.proof_bytes ?? 0) > 2048
      )
        throw new Error("Native delivery receipt is corrupt and remains held");
      const consumedResult = storedDigest(meta.consumed_sha256, meta.consumed_bytes);
      if (meta.state === "retired") {
        if (
          !consumedResult ||
          meta.actual_result_bytes !== null ||
          meta.proof_bytes !== null ||
          meta.reserved_bytes !== 0
        )
          throw new Error("Native delivery retirement is corrupt and remains held");
        return { ...identity, kind, state: "retired", consumedResult };
      }
      let result: { result?: unknown; resultSource?: NativeDeliveryResultSource } = {};
      if (meta.state === "recorded") {
        if (
          !consumedResult ||
          typeof meta.result_sha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(meta.result_sha256) ||
          Number(meta.result_bytes) < 1 ||
          meta.result_bytes !== meta.actual_result_bytes
        )
          throw new Error("Native delivery recorded result is corrupt and remains held");
        result.resultSource = { sha256: meta.result_sha256, byteLength: Number(meta.result_bytes) };
        if (meta.inline_result !== null) {
          const raw = String(meta.inline_result);
          if (
            Buffer.byteLength(raw) !== result.resultSource.byteLength ||
            sha(raw) !== result.resultSource.sha256
          )
            throw new Error("Native delivery result bytes changed and remain held");
          result.result = JSON.parse(raw) as unknown;
        }
      }
      return {
        ...identity,
        kind,
        state: meta.state as "admitted" | "recorded" | "retired",
        ...result,
        ...(kind === "native.services.workspace.format" &&
        meta.state === "admitted" &&
        meta.reserved_bytes === 0 &&
        meta.actual_result_bytes === null &&
        meta.proof_bytes === null &&
        meta.result_sha256 === null &&
        meta.result_bytes === null &&
        meta.consumed_sha256 === null &&
        meta.consumed_bytes === null
          ? { resultUnavailable: true as const }
          : {}),
        ...(consumedResult ? { consumedResult } : {}),
        ...(meta.bounded_proof === null
          ? {}
          : { proof: JSON.parse(String(meta.bounded_proof)) as NativeBufferDeliveryProof }),
      };
    });
  }
  async function readMetadata(
    principal: string,
    kind: NativeDeliveryKind,
    identity: NativeDeliveryIdentity,
  ): Promise<NativeDeliveryRow | null> {
    return store.db.scope(async () => {
      const epoch = await epochs.fence(principal, identity);
      if (epoch) return { ...identity, kind, state: "fenced", epoch };
      // No result_json expression, length or substring: ACK must not materialize a 32MiB payload even inside SQLite.
      const meta = await store.db
        .prepare(`SELECT kind,sha256,byte_length,state,result_sha256,result_bytes,
        epoch_owner_id,epoch_generation,epoch_sequence,
        consumed_sha256,consumed_bytes,reserved_bytes,
        CASE WHEN kind='buffer' AND length(CAST(proof_json AS BLOB))<=2048 THEN proof_json ELSE NULL END AS proof
        FROM native_delivery_receipts WHERE environment_id=? AND principal_id=? AND original_id=?`)
        .get(store.environmentId, principal, identity.originalId);
      if (!meta) return null;
      epochs.validateRow(meta, identity);
      if (meta.kind !== kind)
        throw new Error("Native delivery original target conflicts with retained intent");
      match(meta, identity);
      const consumedResult = storedDigest(meta.consumed_sha256, meta.consumed_bytes);
      if (meta.state === "retired") {
        if (!consumedResult || meta.reserved_bytes !== 0 || meta.proof !== null)
          throw new Error("Native delivery retirement is corrupt and remains held");
        return { ...identity, kind, state: "retired", consumedResult };
      }
      if (meta.state !== "admitted" && meta.state !== "recorded")
        throw new Error("Native delivery state is corrupt and remains held");
      const resultSource = storedDigest(meta.result_sha256, meta.result_bytes);
      if (
        meta.state === "recorded" &&
        (!consumedResult || !resultSource || meta.reserved_bytes !== 0)
      )
        throw new Error("Native delivery recorded metadata is corrupt and remains held");
      return {
        ...identity,
        kind,
        state: meta.state,
        ...(consumedResult ? { consumedResult } : {}),
        ...(resultSource ? { resultSource } : {}),
        ...(meta.proof === null
          ? {}
          : { proof: JSON.parse(String(meta.proof)) as NativeBufferDeliveryProof }),
      };
    });
  }
  /** Only the invocation that won admission and left its effect/record await
   * can enter this path. It releases a result reservation, never an original
   * or its unknown outcome. Zero reservation fences every later record. */
  async function releaseFailedReservation(
    principal: string,
    kind: NativeDeliveryKind,
    identity: NativeDeliveryIdentity,
  ): Promise<void> {
    await store.db.runRecoveryBookkeeping(() =>
      store.transaction(async () => {
        const row = await store.db
          .prepare(`SELECT kind,sha256,byte_length,state,reserved_bytes,
          result_json IS NULL AS no_result,proof_json IS NULL AS no_proof,
          result_sha256,result_bytes,consumed_sha256,consumed_bytes
          FROM native_delivery_receipts WHERE environment_id=? AND principal_id=? AND original_id=?`)
          .get(store.environmentId, principal, identity.originalId);
        if (!row || row.kind !== kind)
          throw new Error("Native delivery failed execution original is unavailable");
        match(row, identity);
        // A successful record/ACK may have committed before its reply was lost.
        // Failure bookkeeping cannot change that authoritative outcome.
        if (row.state === "recorded" || row.state === "retired") return;
        if (
          row.state !== "admitted" ||
          (row.reserved_bytes !== 0 &&
            row.reserved_bytes !== maximumResult(kind) &&
            !(
              kind === "native.services.workspace.format" &&
              row.reserved_bytes === NATIVE_FORMAT_MAX_RESULT_BYTES
            )) ||
          row.no_result !== 1 ||
          (kind !== "buffer" && row.no_proof !== 1) ||
          row.result_sha256 !== null ||
          row.result_bytes !== null ||
          row.consumed_sha256 !== null ||
          row.consumed_bytes !== null
        )
          throw new Error("Native delivery failed execution metadata is corrupt and remains held");
        if (row.reserved_bytes === 0) return;
        const changed = await store.db
          .prepare(`UPDATE native_delivery_receipts SET reserved_bytes=0
          WHERE environment_id=? AND principal_id=? AND kind=? AND original_id=?
          AND sha256=? AND byte_length=? AND state='admitted' AND reserved_bytes=?`)
          .run(
            ...key(principal, kind, identity),
            identity.sha256,
            identity.byteLength,
            row.reserved_bytes,
          );
        if (Number(changed.changes) !== 1)
          throw new Error("Native delivery failed execution disposition changed and remains held");
      }, "critical"),
    );
  }
  const journal = {
    epochs: {
      open: epochs.open,
      status: epochs.status,
      compact: epochs.compact,
      close: epochs.close,
    },
    read,
    readMetadata,
    readResult(
      principal: string,
      kind: Exclude<NativeDeliveryKind, "buffer">,
      identity: NativeDeliveryIdentity,
      source: NativeDeliveryResultSource,
      offset: number,
      limit: number,
    ) {
      if (
        !Number.isSafeInteger(source.byteLength) ||
        source.byteLength < 1 ||
        source.byteLength > MAX_RESULT_BYTES ||
        !/^[a-f0-9]{64}$/.test(source.sha256) ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset >= source.byteLength ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 65_536
      )
        throw new Error("Invalid native delivery result chunk");
      return store.db.scope(async () => {
        await epochs.assertNotFenced(principal, identity);
        const row = await store.db
          .prepare(`SELECT kind,sha256,byte_length,state,result_sha256,result_bytes,
          epoch_owner_id,epoch_generation,epoch_sequence,
          length(CAST(result_json AS BLOB)) AS actual_bytes,
          CASE WHEN state='recorded' AND result_sha256=? AND result_bytes=? AND length(CAST(result_json AS BLOB))=?
          THEN hex(substr(CAST(result_json AS BLOB),?,?)) ELSE NULL END AS chunk
          FROM native_delivery_receipts WHERE environment_id=? AND principal_id=? AND original_id=?`)
          .get(
            source.sha256,
            source.byteLength,
            source.byteLength,
            offset + 1,
            limit,
            store.environmentId,
            principal,
            identity.originalId,
          );
        if (!row || row.kind !== kind)
          throw new Error("Native delivery result source is unavailable");
        match(row, identity);
        epochs.validateRow(row, identity);
        if (
          row.state !== "recorded" ||
          row.result_sha256 !== source.sha256 ||
          row.result_bytes !== source.byteLength ||
          row.actual_bytes !== source.byteLength ||
          source.byteLength > MAX_RESULT_BYTES ||
          row.chunk === null ||
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          offset >= source.byteLength ||
          !Number.isSafeInteger(limit) ||
          limit < 1 ||
          limit > 65_536
        )
          throw new Error("Native delivery result source changed or is corrupt");
        const raw = String(row.chunk);
        if (
          !/^(?:[a-fA-F0-9]{2})+$/.test(raw) ||
          raw.length !== Math.min(limit, source.byteLength - offset) * 2
        )
          throw new Error("Native delivery result chunk changed");
        return Buffer.from(raw, "hex").toString("base64");
      });
    },
    admit(principal: string, kind: NativeDeliveryKind, identity: NativeDeliveryIdentity) {
      return store.transaction(async () => {
        const parsed = parseNativeDeliveryEpochOriginalId(identity.originalId);
        const epoch = parsed ? await epochs.assertAdmission(principal, identity) : null;
        const row = await store.db
          .prepare(`SELECT kind,sha256,byte_length,epoch_owner_id,epoch_generation,epoch_sequence FROM native_delivery_receipts
          WHERE environment_id=? AND principal_id=? AND original_id=?`)
          .get(store.environmentId, principal, identity.originalId);
        if (row) {
          if (row.kind !== kind)
            throw new Error("Native delivery original target conflicts with retained intent");
          match(row, identity);
          epochs.validateRow(row, identity);
          return false;
        }
        if (!parsed) await epochs.assertAdmission(principal, identity);
        const count = await store.db
          .prepare(`SELECT COUNT(*) AS total,
          SUM(CASE WHEN environment_id=? AND principal_id=? THEN 1 ELSE 0 END) AS own,
          COALESCE(SUM(CASE WHEN kind='native.services.workspace.format'
            THEN COALESCE(reserved_bytes,?) + CASE WHEN state='retired' THEN 0 ELSE COALESCE(result_bytes,0) END ELSE 0 END),0) AS bytes,
          COALESCE(SUM(CASE WHEN kind='native.services.workspace.format' AND environment_id=? AND principal_id=?
            THEN COALESCE(reserved_bytes,?) + CASE WHEN state='retired' THEN 0 ELSE COALESCE(result_bytes,0) END ELSE 0 END),0) AS own_bytes
          FROM native_delivery_receipts`)
          .get(
            store.environmentId,
            principal,
            MAX_RESULT_BYTES,
            store.environmentId,
            principal,
            MAX_RESULT_BYTES,
          );
        if (Number(count?.total) >= MAX_ROWS || Number(count?.own ?? 0) >= MAX_PRINCIPAL_ROWS)
          throw new Error(
            "Native delivery journal capacity is unavailable; retained originals remain held",
          );
        const reservation =
          kind === "native.services.workspace.format"
            ? NATIVE_FORMAT_MAX_RESULT_BYTES
            : maximumResult(kind);
        if (
          kind === "native.services.workspace.format" &&
          (Number(count?.bytes) + reservation > MAX_TOTAL_RESULT_BYTES ||
            Number(count?.own_bytes) + reservation > MAX_PRINCIPAL_RESULT_BYTES)
        )
          throw new Error(
            "Native delivery result capacity is unavailable before admission; retained originals remain held",
          );
        await store.db
          .prepare(`INSERT INTO native_delivery_receipts
          (environment_id,principal_id,kind,original_id,sha256,byte_length,state,reserved_bytes,epoch_owner_id,epoch_generation,epoch_sequence) VALUES (?,?,?,?,?,?,'admitted',?,?,?,?)`)
          .run(
            ...key(principal, kind, identity),
            identity.sha256,
            identity.byteLength,
            reservation,
            epoch?.ownerId ?? null,
            epoch?.generation ?? null,
            epoch?.sequence ?? null,
          );
        return true;
      }, "critical");
    },
    prepareProof(
      principal: string,
      identity: NativeDeliveryIdentity,
      proof: NativeBufferDeliveryProof,
    ) {
      return store.transaction(async () => {
        const row = await read(principal, "buffer", identity);
        if (!row) throw new Error("Native delivery admission is unavailable");
        if (row.state !== "admitted")
          throw new Error("Native delivery no longer accepts a planned proof");
        if (row.proof && JSON.stringify(row.proof) !== JSON.stringify(proof))
          throw new Error("Native delivery planned proof changed");
        if (!row.proof)
          await store.db
            .prepare(`UPDATE native_delivery_receipts SET proof_json=?
          WHERE environment_id=? AND principal_id=? AND kind=? AND original_id=? AND sha256=? AND byte_length=? AND proof_json IS NULL`)
            .run(
              JSON.stringify(proof),
              ...key(principal, "buffer", identity),
              identity.sha256,
              identity.byteLength,
            );
      }, "critical");
    },
    record(
      principal: string,
      kind: NativeDeliveryKind,
      identity: NativeDeliveryIdentity,
      result: unknown,
    ) {
      const raw = JSON.stringify(result);
      const consumed = nativeDeliveryConsumedResult(kind, result),
        source = digest(raw);
      if (source.byteLength > maximumResult(kind))
        throw new Error("Native delivery result exceeds retained capacity and remains unknown");
      return store.transaction(async () => {
        const row = await read(principal, kind, identity);
        if (!row) throw new Error("Native delivery admission is unavailable");
        if (row.state === "fenced")
          throw new Error(
            "NATIVE_DELIVERY_EPOCH_FENCED: compacted original cannot record a result",
          );
        if (row.state === "retired") throw new Error("Native delivery has already retired");
        if (row.state === "recorded") {
          if (!sameDigest(row.resultSource, source) || !sameDigest(row.consumedResult, consumed))
            throw new Error("Native delivery recorded result changed");
          return;
        }
        const reservation = await store.db
          .prepare(`SELECT reserved_bytes FROM native_delivery_receipts
          WHERE environment_id=? AND principal_id=? AND kind=? AND original_id=?`)
          .get(...key(principal, kind, identity));
        // A failed execution may have released this exact reservation while
        // retaining its admitted/unknown no-replay marker. Never revive it.
        if (Number(reservation?.reserved_bytes ?? 0) < source.byteLength)
          throw new Error(
            "Native delivery result was not reserved before the effect and remains held",
          );
        await store.db
          .prepare(`UPDATE native_delivery_receipts SET state='recorded', result_json=?, result_sha256=?, result_bytes=?,
          consumed_sha256=?, consumed_bytes=?, reserved_bytes=0
          WHERE environment_id=? AND principal_id=? AND kind=? AND original_id=? AND sha256=? AND byte_length=? AND state='admitted'`)
          .run(
            raw,
            source.sha256,
            source.byteLength,
            consumed.sha256,
            consumed.byteLength,
            ...key(principal, kind, identity),
            identity.sha256,
            identity.byteLength,
          );
      }, "critical");
    },
    retire(
      principal: string,
      kind: NativeDeliveryKind,
      identity: NativeDeliveryIdentity,
      consumed: NativeDeliveryConsumedResult,
      verifiedProof?: NativeBufferDeliveryProof,
    ) {
      return store.transaction(async () => {
        await epochs.assertNotFenced(principal, identity);
        // Metadata and a bounded buffer proof only: never deserialize a retained 32MiB service result on ACK.
        const row = await store.db
          .prepare(`SELECT kind,sha256,byte_length,state,consumed_sha256,consumed_bytes,epoch_owner_id,epoch_generation,epoch_sequence,
          CASE WHEN length(CAST(proof_json AS BLOB))<=2048 THEN proof_json ELSE NULL END AS proof
          FROM native_delivery_receipts WHERE environment_id=? AND principal_id=? AND original_id=?`)
          .get(store.environmentId, principal, identity.originalId);
        if (!row || row.kind !== kind)
          throw new Error("Native delivery ACK original is unavailable");
        match(row, identity);
        epochs.validateRow(row, identity);
        const expected =
          row.state === "admitted" && kind === "buffer"
            ? nativeDeliveryConsumedResult("buffer", { acknowledged: true })
            : { sha256: String(row.consumed_sha256), byteLength: Number(row.consumed_bytes) };
        if (!sameDigest(expected, consumed))
          throw new Error("Native delivery ACK consumed result conflicts");
        if (row.state === "retired") return;
        if (kind === "buffer") {
          if (!verifiedProof || row.proof !== JSON.stringify(verifiedProof))
            throw new Error("Native delivery ACK requires the same verified planned buffer proof");
        } else if (row.state !== "recorded") {
          throw new Error("Native delivery unknown service cannot retire");
        }
        if (row.state !== "recorded" && row.state !== "admitted")
          throw new Error("Native delivery ACK state is corrupt and remains held");
        await store.db
          .prepare(`UPDATE native_delivery_receipts SET state='retired',result_json=NULL,proof_json=NULL,
          reserved_bytes=0,consumed_sha256=?,consumed_bytes=?
          WHERE environment_id=? AND principal_id=? AND kind=? AND original_id=? AND sha256=? AND byte_length=?`)
          .run(
            consumed.sha256,
            consumed.byteLength,
            ...key(principal, kind, identity),
            identity.sha256,
            identity.byteLength,
          );
      }, "critical");
    },
  };
  return {
    ...journal,
    /** Admission failure/ambiguity stays outside the catch: no cleanup authority
     * exists until this invocation actually wins the retained original. */
    async execute(
      principal: string,
      kind: NativeDeliveryKind,
      identity: NativeDeliveryIdentity,
      effect: () => Promise<unknown>,
    ): Promise<void> {
      const original = {
        originalId: identity.originalId,
        sha256: identity.sha256,
        byteLength: identity.byteLength,
      };
      if (!(await journal.admit(principal, kind, original))) return;
      try {
        const result = await epochs.withAdmittedExecution(principal, kind, original, effect);
        await journal.record(principal, kind, original, result);
      } catch (error) {
        // The sole owner continuation has exited. Process-owned failure
        // bookkeeping may release only its own capacity, even after authority
        // loss; it cannot disclose data, retry an effect or mint a user grant.
        warnExecutionFailure(kind, error);
        await releaseFailedReservation(principal, kind, original).catch(() => {});
      }
    },
  };
}
