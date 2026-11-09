import { createHash } from "node:crypto";
import type { HostStore } from "../store";
import { NativeDeliveryIdentitySchema } from "../../src/shared/model/host-contracts/native-delivery-identity";
import {
  NATIVE_BUFFER_ARTIFACT_MAX_BYTES as MAX_ARTIFACT,
  NATIVE_BUFFER_BATCH_MAX_BYTES as MAX_BATCH,
  NATIVE_BUFFER_BLOB_CHUNK_BYTES as CHUNK,
  type NativeBufferArtifactReference,
  type NativeBufferClockState,
  type NativeBufferCompletionCertificate,
  type NativeBufferPersistence,
} from "../ports/native-buffer-persistence";

const hex = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const failure = () =>
  new Error("Native buffer SQL retention is missing, conflicting or corrupt; sources remain held");
const exactKeys = (value: object, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key)) &&
  keys.filter((key) => key !== "originalDelivery").every((key) => Object.hasOwn(value, key));
function artifactKey(key: unknown, directory = false): asserts key is string {
  if (
    typeof key !== "string" ||
    key.length > 1024 ||
    !/^[A-Za-z0-9._/-]+$/.test(key) ||
    key.split("/").some((part) => !part || part === "." || part === "..") ||
    key.split("/").length > 16 ||
    !(
      key.startsWith("native-activity/buffers/") ||
      key.startsWith("native-activity/buffer-history/") ||
      (directory && (key === "native-activity/buffers" || key === "native-activity/buffer-history"))
    ) ||
    key === "native-activity/buffer-history/clocks" ||
    key.startsWith("native-activity/buffer-history/clocks/")
  )
    throw failure();
}
function bound(value: unknown, maximum: number): asserts value is number {
  if (!integer(value) || value > maximum) throw failure();
}
function clockState(state: NativeBufferClockState) {
  if (
    !state ||
    !exactKeys(state, ["version", "reportId", "clockId", "base", "highWater", "digest"]) ||
    state.version !== 1 ||
    !hex.test(state.reportId) ||
    !uuid.test(state.clockId) ||
    !integer(state.base) ||
    !integer(state.highWater) ||
    state.highWater < state.base ||
    !hex.test(state.digest)
  )
    throw failure();
  return {
    version: 1 as const,
    reportId: state.reportId,
    clockId: state.clockId,
    base: state.base,
    highWater: state.highWater,
    digest: state.digest,
  };
}
const sameClock = (a: NativeBufferClockState, b: NativeBufferClockState) =>
  JSON.stringify(a) === JSON.stringify(b);
function artifactReference(ref: NativeBufferArtifactReference) {
  if (!ref || !exactKeys(ref, ["key", "sha256", "byteLength"])) throw failure();
  artifactKey(ref.key);
  bound(ref.byteLength, MAX_ARTIFACT);
  if (!hex.test(ref.sha256)) throw failure();
  return { key: ref.key, sha256: ref.sha256, byteLength: ref.byteLength };
}
function certificateMetadata(value: Omit<NativeBufferCompletionCertificate, "raw">) {
  if (
    !value ||
    !exactKeys(value, [
      "reportId",
      "reportVersion",
      "snapshotDigest",
      "byteLength",
      "clockId",
      "artifacts",
      "originalDelivery",
    ]) ||
    !hex.test(value.reportId) ||
    !hex.test(value.snapshotDigest) ||
    !integer(value.reportVersion) ||
    value.reportVersion < 1 ||
    !uuid.test(value.clockId) ||
    !integer(value.byteLength) ||
    value.byteLength < 1 ||
    value.byteLength > MAX_ARTIFACT ||
    !Array.isArray(value.artifacts) ||
    value.artifacts.length > 100_000
  )
    throw failure();
  const artifacts = Array.from(value.artifacts, artifactReference).sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  if (artifacts.some((ref, index) => index > 0 && artifacts[index - 1].key === ref.key))
    throw failure();
  const referenced = new Map<string, number>([[value.snapshotDigest, value.byteLength]]);
  let referencedBytes = value.byteLength;
  for (const ref of artifacts) {
    const previous = referenced.get(ref.sha256);
    if (previous !== undefined && previous !== ref.byteLength) throw failure();
    if (previous === undefined) {
      referenced.set(ref.sha256, ref.byteLength);
      referencedBytes += ref.byteLength;
    }
    if (referencedBytes > MAX_BATCH) throw failure();
  }
  let originalDelivery;
  if (value.originalDelivery !== undefined) {
    const binding = value.originalDelivery;
    if (
      !binding ||
      !exactKeys(binding, ["originalId", "sha256", "byteLength", "principalId", "environmentId"]) ||
      !hex.test(binding.principalId) ||
      typeof binding.environmentId !== "string" ||
      !/^[A-Za-z0-9._:@/-]{1,200}$/.test(binding.environmentId)
    )
      throw failure();
    originalDelivery = {
      ...NativeDeliveryIdentitySchema.parse({
        originalId: binding.originalId,
        sha256: binding.sha256,
        byteLength: binding.byteLength,
      }),
      principalId: binding.principalId,
      environmentId: binding.environmentId,
    };
  }
  return {
    reportId: value.reportId,
    reportVersion: value.reportVersion,
    snapshotDigest: value.snapshotDigest,
    byteLength: value.byteLength,
    clockId: value.clockId,
    ...(originalDelivery ? { originalDelivery } : {}),
    artifacts,
  };
}

/** Internal storage, never a grant. Reads are mutation-free; only actual Host FULL owners publish data. */
export function createNativeBufferPersistenceStore(store: HostStore): NativeBufferPersistence {
  const has = async (table: string) =>
    !!(await store.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(table));
  const schema = async (authorize: () => Promise<void>) => {
    store.db.assertCriticalScope();
    const existingIndex =
      (await has("native_buffer_directory_children")) &&
      (await has("native_buffer_directory_index"));
    await store.db.exec(`
      CREATE TABLE IF NOT EXISTS native_buffer_clocks (report_id TEXT PRIMARY KEY,state_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS native_buffer_clock_witnesses (report_id TEXT PRIMARY KEY,state_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS native_buffer_blobs (sha256 TEXT PRIMARY KEY,byte_length INTEGER NOT NULL,chunk_count INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS native_buffer_blob_chunks (sha256 TEXT NOT NULL,chunk_index INTEGER NOT NULL,chunk_sha256 TEXT NOT NULL,data BLOB NOT NULL,PRIMARY KEY(sha256,chunk_index));
      CREATE TABLE IF NOT EXISTS native_buffer_artifacts (key TEXT PRIMARY KEY,sha256 TEXT NOT NULL,byte_length INTEGER NOT NULL,immutable INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS native_buffer_certificates (report_id TEXT NOT NULL,report_version INTEGER NOT NULL,snapshot_digest TEXT NOT NULL,metadata_json TEXT NOT NULL,PRIMARY KEY(report_id,report_version,snapshot_digest));
      CREATE TABLE IF NOT EXISTS native_buffer_directory_children (directory TEXT NOT NULL,name TEXT NOT NULL,is_directory INTEGER NOT NULL,first_artifact_rowid INTEGER NOT NULL,PRIMARY KEY(directory,name));
      CREATE UNIQUE INDEX IF NOT EXISTS native_buffer_directory_order ON native_buffer_directory_children(directory,first_artifact_rowid);
      CREATE TABLE IF NOT EXISTS native_buffer_directory_index (id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,artifact_rowid INTEGER NOT NULL);
    `);
    await authorize();
    await prepareDirectoryIndex(existingIndex, authorize);
  };
  async function artifactFloor() {
    const row = await store.db
      .prepare("SELECT COALESCE(MAX(rowid),0) AS value FROM native_buffer_artifacts")
      .get();
    bound(row?.value, Number.MAX_SAFE_INTEGER);
    return row!.value as number;
  }
  async function indexArtifact(key: string, rowid: number, authorize: () => Promise<void>) {
    artifactKey(key);
    bound(rowid, Number.MAX_SAFE_INTEGER);
    if (rowid < 1) throw failure();
    const parts = key.split("/");
    for (let index = 1; index < parts.length; index++) {
      const directory = parts.slice(0, index).join("/"),
        name = parts[index],
        isDirectory = index + 1 < parts.length ? 1 : 0;
      const existing = await store.db
        .prepare(
          "SELECT is_directory,first_artifact_rowid FROM native_buffer_directory_children WHERE directory=? AND name=?",
        )
        .get(directory, name);
      if (existing) {
        if (
          existing.is_directory !== isDirectory ||
          !integer(existing.first_artifact_rowid) ||
          existing.first_artifact_rowid < 1 ||
          existing.first_artifact_rowid > rowid
        )
          throw failure();
      } else {
        await store.db
          .prepare("INSERT INTO native_buffer_directory_children VALUES (?,?,?,?)")
          .run(directory, name, isDirectory, rowid);
      }
    }
    await authorize();
  }
  async function prepareDirectoryIndex(intact: boolean, authorize: () => Promise<void>) {
    const floor = await artifactFloor();
    const marker = await store.db
      .prepare("SELECT version,artifact_rowid FROM native_buffer_directory_index WHERE id=1")
      .get();
    if (
      marker &&
      (marker.version !== 1 || !integer(marker.artifact_rowid) || marker.artifact_rowid > floor)
    )
      throw failure();
    if (intact && marker?.artifact_rowid === floor) return;
    // Derived metadata can be rebuilt only by a critical mutator. Existing file witnesses must not be erased over missing heads.
    const orphan = await store.db
      .prepare(`SELECT 1 AS missing FROM native_buffer_directory_children AS child
      LEFT JOIN native_buffer_artifacts AS artifact ON artifact.key=child.directory||'/'||child.name
      WHERE child.is_directory=0 AND artifact.key IS NULL LIMIT 1`)
      .get();
    if (orphan) throw failure();
    // Certificates also retain file-key provenance if the entire derived index was lost.
    const missingReference = await store.db
      .prepare(`SELECT 1 AS missing FROM native_buffer_certificates AS certificate,
      json_each(certificate.metadata_json,'$.artifacts') AS reference
      LEFT JOIN native_buffer_artifacts AS artifact ON artifact.key=json_extract(reference.value,'$.key')
      WHERE artifact.key IS NULL LIMIT 1`)
      .get();
    if (missingReference) throw failure();
    await authorize();
    const start = intact && marker ? marker.artifact_rowid : 0;
    if (!start) await store.db.exec("DELETE FROM native_buffer_directory_children");
    for await (const artifact of store.db
      .prepare(
        "SELECT rowid AS artifact_rowid,key FROM native_buffer_artifacts WHERE rowid>? ORDER BY rowid",
      )
      .iterate(start)) {
      await indexArtifact(String(artifact.key), Number(artifact.artifact_rowid), authorize);
    }
    await store.db
      .prepare(
        "INSERT INTO native_buffer_directory_index VALUES (1,1,?) ON CONFLICT(id) DO UPDATE SET artifact_rowid=excluded.artifact_rowid",
      )
      .run(floor);
    await authorize();
  }
  async function directoryReady(): Promise<number | null> {
    const artifacts = await has("native_buffer_artifacts"),
      children = await has("native_buffer_directory_children"),
      state = await has("native_buffer_directory_index");
    const marker = state
      ? await store.db
          .prepare("SELECT version,artifact_rowid FROM native_buffer_directory_index WHERE id=1")
          .get()
      : undefined;
    if (!artifacts) {
      const witness = children
        ? await store.db.prepare("SELECT name FROM native_buffer_directory_children LIMIT 1").get()
        : undefined;
      if (witness || marker?.artifact_rowid) throw failure();
      return null;
    }
    if (!children || !state || !marker) {
      const head = await store.db
        .prepare("SELECT rowid FROM native_buffer_artifacts LIMIT 1")
        .get();
      const witness = children
        ? await store.db.prepare("SELECT name FROM native_buffer_directory_children LIMIT 1").get()
        : undefined;
      if (head || witness || marker) throw failure();
      return null;
    }
    if (
      marker.version !== 1 ||
      !integer(marker.artifact_rowid) ||
      !(await store.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='native_buffer_directory_order'",
        )
        .get())
    )
      throw failure();
    return marker.artifact_rowid as number;
  }
  async function readClock(reportId: string): Promise<NativeBufferClockState | null> {
    if (!hex.test(reportId)) throw failure();
    return store.db.scope(async () => {
      const row = (await has("native_buffer_clocks"))
        ? await store.db
            .prepare(
              "SELECT CASE WHEN length(CAST(state_json AS BLOB))<=2048 THEN state_json ELSE NULL END AS state FROM native_buffer_clocks WHERE report_id=?",
            )
            .get(reportId)
        : undefined;
      const witness = (await has("native_buffer_clock_witnesses"))
        ? await store.db
            .prepare(
              "SELECT CASE WHEN length(CAST(state_json AS BLOB))<=2048 THEN state_json ELSE NULL END AS state FROM native_buffer_clock_witnesses WHERE report_id=?",
            )
            .get(reportId)
        : undefined;
      if (!row) {
        const retained = (await has("native_buffer_certificates"))
          ? await store.db
              .prepare("SELECT report_id FROM native_buffer_certificates WHERE report_id=? LIMIT 1")
              .get(reportId)
          : undefined;
        if (witness || retained) throw failure();
        return null;
      }
      if (!witness || typeof row.state !== "string" || typeof witness.state !== "string")
        throw failure();
      let value: NativeBufferClockState, observed: NativeBufferClockState;
      try {
        value = clockState(JSON.parse(row.state) as NativeBufferClockState);
        observed = clockState(JSON.parse(witness.state) as NativeBufferClockState);
      } catch {
        throw failure();
      }
      if (value.reportId !== reportId || !sameClock(value, observed)) throw failure();
      return value;
    });
  }
  async function mutate<T>(authorize: () => Promise<void>, work: () => Promise<T>): Promise<T> {
    await authorize();
    const value = await store.transaction(async () => {
      await authorize();
      const result = await work();
      await authorize();
      return result;
    }, "critical");
    // Revocation after COMMIT cannot undo a reservation: an unknown ACK consumes the gap.
    await authorize();
    return value;
  }
  async function initialize(state: NativeBufferClockState, authorize: () => Promise<void>) {
    await schema(authorize);
    const existing = await readClock(state.reportId);
    await authorize();
    if (existing) {
      if (!sameClock(existing, state)) throw failure();
      return existing;
    }
    const raw = JSON.stringify(state);
    await store.db
      .prepare("INSERT INTO native_buffer_clocks VALUES (?,?)")
      .run(state.reportId, raw);
    await store.db
      .prepare("INSERT INTO native_buffer_clock_witnesses VALUES (?,?)")
      .run(state.reportId, raw);
    await authorize();
    return state;
  }
  async function readBlob(hash: string, byteLength: number, limit: number): Promise<Buffer> {
    bound(limit, MAX_ARTIFACT);
    bound(byteLength, limit);
    if (
      !hex.test(hash) ||
      !(await has("native_buffer_blobs")) ||
      !(await has("native_buffer_blob_chunks"))
    )
      throw failure();
    const meta = await store.db
      .prepare("SELECT byte_length,chunk_count FROM native_buffer_blobs WHERE sha256=?")
      .get(hash);
    if (
      !meta ||
      meta.byte_length !== byteLength ||
      meta.chunk_count !== Math.ceil(byteLength / CHUNK)
    )
      throw failure();
    const raw = Buffer.alloc(byteLength);
    let offset = 0,
      index = 0;
    for await (const row of store.db
      .prepare(`SELECT chunk_index,chunk_sha256,length(data) AS bytes,
      CASE WHEN length(data)<=? THEN data ELSE NULL END AS data FROM native_buffer_blob_chunks WHERE sha256=? ORDER BY chunk_index`)
      .iterate(CHUNK, hash)) {
      if (
        row.chunk_index !== index++ ||
        row.bytes !== Math.min(CHUNK, byteLength - offset) ||
        !(row.data instanceof Uint8Array) ||
        row.data.byteLength !== row.bytes ||
        row.bytes < 1
      )
        throw failure();
      const chunk = Buffer.from(row.data);
      if (sha(chunk) !== row.chunk_sha256) throw failure();
      chunk.copy(raw, offset);
      offset += chunk.length;
    }
    if (index !== meta.chunk_count || offset !== byteLength || sha(raw) !== hash) throw failure();
    return raw;
  }
  async function putBlob(hash: string, bytes: Buffer, authorize: () => Promise<void>) {
    const existing = await store.db
      .prepare("SELECT byte_length FROM native_buffer_blobs WHERE sha256=?")
      .get(hash);
    await authorize();
    if (existing) {
      if (
        existing.byte_length !== bytes.length ||
        !(await readBlob(hash, bytes.length, MAX_ARTIFACT)).equals(bytes)
      )
        throw failure();
      await authorize();
      return;
    }
    await store.db
      .prepare("INSERT INTO native_buffer_blobs VALUES (?,?,?)")
      .run(hash, bytes.length, Math.ceil(bytes.length / CHUNK));
    await authorize();
    for (let offset = 0, index = 0; offset < bytes.length; offset += CHUNK, index++) {
      const chunk = bytes.subarray(offset, Math.min(offset + CHUNK, bytes.length));
      await store.db
        .prepare("INSERT INTO native_buffer_blob_chunks VALUES (?,?,?,?)")
        .run(hash, index, sha(chunk), chunk);
      await authorize();
    }
  }
  async function verifyArtifact(ref: NativeBufferArtifactReference) {
    const row = await store.db
      .prepare("SELECT sha256,byte_length FROM native_buffer_artifacts WHERE key=?")
      .get(ref.key);
    if (!row || row.sha256 !== ref.sha256 || row.byte_length !== ref.byteLength) throw failure();
    await readBlob(ref.sha256, ref.byteLength, MAX_ARTIFACT);
  }
  return {
    readClock,
    async initializeClock(candidate, authorize) {
      const state = clockState(candidate);
      return mutate(authorize, () => initialize(state, authorize));
    },
    async advanceClock(previous, advanced, authorize) {
      const expected = clockState(previous),
        next = clockState(advanced);
      if (
        next.reportId !== expected.reportId ||
        next.clockId !== expected.clockId ||
        next.base !== expected.base ||
        !integer(expected.highWater + 1) ||
        next.highWater !== expected.highWater + 1 ||
        next.digest !==
          sha(`${next.highWater.toString().padStart(16, "0")}|${next.clockId}|${expected.digest}`)
      )
        throw failure();
      return mutate(authorize, async () => {
        const current = await readClock(expected.reportId);
        await authorize();
        if (!current || !sameClock(current, expected)) throw failure();
        const raw = JSON.stringify(next);
        await store.db
          .prepare(
            "UPDATE native_buffer_clocks SET state_json=? WHERE report_id=? AND state_json=?",
          )
          .run(raw, expected.reportId, JSON.stringify(expected));
        await store.db
          .prepare(
            "UPDATE native_buffer_clock_witnesses SET state_json=? WHERE report_id=? AND state_json=?",
          )
          .run(raw, expected.reportId, JSON.stringify(expected));
        return next;
      });
    },
    async read(key, limit) {
      artifactKey(key);
      bound(limit, MAX_ARTIFACT);
      return store.db.scope(async () => {
        if (!(await has("native_buffer_artifacts"))) {
          await directoryReady();
          return null;
        }
        const row = await store.db
          .prepare("SELECT sha256,byte_length FROM native_buffer_artifacts WHERE key=?")
          .get(key);
        if (!row) {
          if ((await directoryReady()) !== null) {
            const split = key.lastIndexOf("/"),
              witness = await store.db
                .prepare(
                  "SELECT is_directory FROM native_buffer_directory_children WHERE directory=? AND name=?",
                )
                .get(key.slice(0, split), key.slice(split + 1));
            if (witness?.is_directory === 0) throw failure();
          }
          return null;
        }
        bound(row.byte_length, limit);
        return readBlob(String(row.sha256), row.byte_length, limit);
      });
    },
    async directoryView() {
      return store.db.scope(async () => {
        const floor = await directoryReady();
        if (floor === null) return 0;
        if ((await artifactFloor()) !== floor) throw failure();
        return floor;
      });
    },
    async entries(directory, after, limit, view) {
      artifactKey(directory, true);
      bound(limit, 1024);
      if (view !== undefined) bound(view, Number.MAX_SAFE_INTEGER);
      let cursor = 0;
      if (after !== null) {
        const match =
          typeof after === "string" ? /^directory-rowid:([1-9][0-9]{0,15})$/.exec(after) : null;
        cursor = Number(match?.[1]);
        if (!match || !integer(cursor) || after !== `directory-rowid:${cursor}`) throw failure();
      }
      if (limit < 1) throw failure();
      return store.db.scope(async () => {
        const floor = await directoryReady();
        if (floor === null) return { entries: [], nextAfter: null };
        const cutoff = view ?? floor;
        if (cursor > cutoff) throw failure();
        const rows = await store.db
          .prepare(`SELECT name,is_directory,first_artifact_rowid FROM native_buffer_directory_children INDEXED BY native_buffer_directory_order
          WHERE directory=? AND first_artifact_rowid>? AND first_artifact_rowid<=? ORDER BY first_artifact_rowid LIMIT ?`)
          .all(directory, cursor, cutoff, limit + 1);
        for (const row of rows) {
          artifactKey(directory + "/" + String(row.name), true);
          if (
            (row.is_directory !== 0 && row.is_directory !== 1) ||
            !integer(row.first_artifact_rowid) ||
            row.first_artifact_rowid <= cursor ||
            row.first_artifact_rowid > cutoff
          )
            throw failure();
        }
        const entries = rows
          .slice(0, limit)
          .map((row) => ({ name: String(row.name), isDirectory: row.is_directory === 1 }));
        return {
          entries,
          nextAfter:
            rows.length > limit ? `directory-rowid:${rows[limit - 1].first_artifact_rowid}` : null,
        };
      });
    },
    async hasEntry(directory, name, view) {
      artifactKey(directory, true);
      if (view !== undefined) bound(view, Number.MAX_SAFE_INTEGER);
      if (
        typeof name !== "string" ||
        !/^[A-Za-z0-9._-]{1,1024}$/.test(name) ||
        name === "." ||
        name === ".."
      )
        throw failure();
      const key = directory + "/" + name;
      artifactKey(key, true);
      return store.db.scope(async () => {
        const floor = await directoryReady();
        if (floor === null) return false;
        const row = await store.db
          .prepare(
            "SELECT is_directory,first_artifact_rowid FROM native_buffer_directory_children WHERE directory=? AND name=? AND first_artifact_rowid<=? LIMIT 1",
          )
          .get(directory, name, view ?? floor);
        if (!row) return false;
        if (
          (row.is_directory !== 0 && row.is_directory !== 1) ||
          !integer(row.first_artifact_rowid) ||
          row.first_artifact_rowid < 1
        )
          throw failure();
        return true;
      });
    },
    async complete(batch) {
      if (
        !batch ||
        !Array.isArray(batch.writes) ||
        !Array.isArray(batch.certificates) ||
        batch.writes.length > 100_000 ||
        batch.certificates.length > 4096 ||
        typeof batch.authorize !== "function"
      )
        throw failure();
      const blobs = new Map<string, Buffer>(),
        sizes = new Map<string, number>(),
        writes = new Map<
          string,
          { key: string; sha256: string; byteLength: number; immutable: boolean }
        >();
      let bytes = 0;
      const account = (hash: string, length: number) => {
        const previous = sizes.get(hash);
        if (previous !== undefined && previous !== length) throw failure();
        if (previous === undefined) {
          sizes.set(hash, length);
          bytes += length;
          if (bytes > MAX_BATCH) throw failure();
        }
      };
      const retain = (raw: Buffer) => {
        if (!Buffer.isBuffer(raw) || raw.length > MAX_ARTIFACT) throw failure();
        const hash = sha(raw),
          previous = blobs.get(hash);
        if (previous) {
          if (!previous.equals(raw)) throw failure();
        } else {
          blobs.set(hash, raw);
        }
        account(hash, raw.length);
        return hash;
      };
      for (const write of batch.writes) {
        if (
          !write ||
          !exactKeys(write, ["key", "bytes", "immutable"]) ||
          typeof write.immutable !== "boolean"
        )
          throw failure();
        artifactKey(write.key);
        const current = /^native-activity\/buffers\/[a-f0-9]{64}\.json$/.test(write.key);
        if (
          (!write.immutable && !current) ||
          (write.key.startsWith("native-activity/buffers/") && !current)
        )
          throw failure();
        const value = {
          key: write.key,
          sha256: retain(write.bytes),
          byteLength: write.bytes.length,
          immutable: write.immutable,
        };
        const existing = writes.get(write.key);
        if (existing && JSON.stringify(existing) !== JSON.stringify(value)) throw failure();
        writes.set(write.key, value);
      }
      if (
        batch.initializeClocks !== undefined &&
        (!Array.isArray(batch.initializeClocks) || batch.initializeClocks.length > 4096)
      )
        throw failure();
      const clocks = (batch.initializeClocks ?? []).map(clockState);
      let references = 0;
      const certificates = batch.certificates.map((certificate) => {
        if (
          !certificate ||
          !exactKeys(certificate, [
            "reportId",
            "reportVersion",
            "snapshotDigest",
            "byteLength",
            "clockId",
            "raw",
            "artifacts",
            "originalDelivery",
          ])
        )
          throw failure();
        const { raw, ...rest } = certificate,
          meta = certificateMetadata(rest),
          hash = retain(raw);
        for (const artifact of meta.artifacts) account(artifact.sha256, artifact.byteLength);
        references += meta.artifacts.length;
        if (references > 100_000 || Buffer.byteLength(JSON.stringify(meta)) > 32 * 1024 * 1024)
          throw failure();
        if (raw.length !== meta.byteLength || hash !== meta.snapshotDigest) throw failure();
        return meta;
      });
      // Freeze borrowed buffers only after all individual and distinct batch sizes are checked.
      for (const [hash, raw] of blobs) {
        const frozen = Buffer.from(raw);
        if (sha(frozen) !== hash) throw failure();
        blobs.set(hash, frozen);
      }
      await mutate(batch.authorize, async () => {
        await schema(batch.authorize);
        await batch.authorize();
        for (const state of clocks) await initialize(state, batch.authorize);
        for (const [hash, raw] of blobs) await putBlob(hash, raw, batch.authorize);
        for (const write of writes.values()) {
          const existing = await store.db
            .prepare(
              "SELECT rowid AS artifact_rowid,sha256,byte_length,immutable FROM native_buffer_artifacts WHERE key=?",
            )
            .get(write.key);
          await batch.authorize();
          if (existing && existing.immutable !== 0 && existing.immutable !== 1) throw failure();
          if (
            existing?.immutable === 1 &&
            (existing.sha256 !== write.sha256 ||
              existing.byte_length !== write.byteLength ||
              !write.immutable)
          )
            throw failure();
          const inserted = await store.db
            .prepare(
              `INSERT INTO native_buffer_artifacts VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET sha256=excluded.sha256,byte_length=excluded.byte_length,immutable=excluded.immutable`,
            )
            .run(write.key, write.sha256, write.byteLength, write.immutable ? 1 : 0);
          if (!existing)
            await indexArtifact(write.key, Number(inserted.lastInsertRowid), batch.authorize);
          await batch.authorize();
        }
        await store.db
          .prepare("UPDATE native_buffer_directory_index SET artifact_rowid=? WHERE id=1")
          .run(await artifactFloor());
        for (const certificate of certificates) {
          const state = await readClock(certificate.reportId);
          await batch.authorize();
          if (
            !state ||
            state.clockId !== certificate.clockId ||
            certificate.reportVersion < state.base ||
            state.highWater < certificate.reportVersion
          )
            throw failure();
          for (const ref of certificate.artifacts) {
            await verifyArtifact(ref);
            await batch.authorize();
          }
          const raw = JSON.stringify(certificate);
          const existing = await store.db
            .prepare(
              "SELECT metadata_json FROM native_buffer_certificates WHERE report_id=? AND report_version=? AND snapshot_digest=?",
            )
            .get(certificate.reportId, certificate.reportVersion, certificate.snapshotDigest);
          if (existing && existing.metadata_json !== raw) throw failure();
          if (!existing)
            await store.db
              .prepare("INSERT INTO native_buffer_certificates VALUES (?,?,?,?)")
              .run(
                certificate.reportId,
                certificate.reportVersion,
                certificate.snapshotDigest,
                raw,
              );
          await batch.authorize();
        }
      });
    },
    async readCertificate(ref, limit) {
      if (
        !ref ||
        !exactKeys(ref, ["reportId", "reportVersion", "snapshotDigest"]) ||
        !hex.test(ref.reportId) ||
        !hex.test(ref.snapshotDigest) ||
        !integer(ref.reportVersion) ||
        ref.reportVersion < 1
      )
        throw failure();
      bound(limit, MAX_ARTIFACT);
      return store.db.scope(async () => {
        if (!(await has("native_buffer_certificates"))) return null;
        const row = await store.db
          .prepare(`SELECT snapshot_digest,length(CAST(metadata_json AS BLOB)) AS bytes,
          CASE WHEN length(CAST(metadata_json AS BLOB))<=? THEN metadata_json ELSE NULL END AS metadata
          FROM native_buffer_certificates WHERE report_id=? AND report_version=? AND snapshot_digest=?`)
          .get(32 * 1024 * 1024, ref.reportId, ref.reportVersion, ref.snapshotDigest);
        if (!row) return null;
        if (row.snapshot_digest !== ref.snapshotDigest || typeof row.metadata !== "string")
          throw failure();
        let certificate: ReturnType<typeof certificateMetadata>;
        try {
          certificate = certificateMetadata(
            JSON.parse(row.metadata) as Omit<NativeBufferCompletionCertificate, "raw">,
          );
        } catch {
          throw failure();
        }
        if (
          certificate.reportId !== ref.reportId ||
          certificate.reportVersion !== ref.reportVersion ||
          certificate.snapshotDigest !== ref.snapshotDigest
        )
          throw failure();
        bound(certificate.byteLength, limit);
        const clock = await readClock(ref.reportId);
        if (
          !clock ||
          clock.clockId !== certificate.clockId ||
          clock.highWater < certificate.reportVersion ||
          certificate.reportVersion < clock.base
        )
          throw failure();
        for (const artifact of certificate.artifacts)
          await readBlob(artifact.sha256, artifact.byteLength, MAX_ARTIFACT);
        const raw = await readBlob(certificate.snapshotDigest, certificate.byteLength, limit);
        return { ...certificate, raw };
      });
    },
  };
}
