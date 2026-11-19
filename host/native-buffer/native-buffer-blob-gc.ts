import type { HostStore } from "../store";
import { withShortBusyTimeout } from "../storage/short-busy-timeout";

/** One delete transaction removes at most this many blobs... */
export const NATIVE_BUFFER_GC_BATCH_BLOBS = 500;
/** ...or about this many blob bytes (a single larger blob still goes alone). */
export const NATIVE_BUFFER_GC_BATCH_BYTES = 64 * 1024 * 1024;
/** Batches per pass, so one pass never holds the SQL queue for long. */
export const NATIVE_BUFFER_GC_MAX_BATCHES = 20;

export type NativeBufferBlobGcResult = {
  /** Unreferenced blobs and their bytes when the pass started (dry-run counts). */
  orphanBlobs: number;
  orphanBytes: number;
  deletedBlobs: number;
  deletedBytes: number;
  /** Why the pass deleted nothing on purpose. */
  skipped?: "missing-tables" | "unreadable-certificate";
};

const TABLES = [
  "native_buffer_blobs",
  "native_buffer_blob_chunks",
  "native_buffer_artifacts",
  "native_buffer_certificates",
];
// Every sha256 a reader can reach: artifact rows (all keys, mutable and immutable)
// and every certificate's snapshot body plus its artifact list (readCertificate
// reads each listed blob even after the mutable key moved on). A NULL anywhere in
// this set makes NOT IN select nothing, so malformed references fail closed.
const REFERENCED = `SELECT sha256 FROM native_buffer_artifacts
  UNION SELECT snapshot_digest FROM native_buffer_certificates
  UNION SELECT json_extract(metadata_json,'$.snapshotDigest') FROM native_buffer_certificates
  UNION SELECT json_extract(reference.value,'$.sha256') FROM native_buffer_certificates AS certificate,
    json_each(certificate.metadata_json,'$.artifacts') AS reference`;
const ORPHANS = `FROM native_buffer_blobs WHERE sha256 NOT IN (${REFERENCED})`;
// CASE keeps json_* from evaluating malformed JSON.
const UNREADABLE_CERTIFICATE = `SELECT 1 AS bad FROM native_buffer_certificates WHERE CASE
  WHEN json_valid(metadata_json) THEN json_type(metadata_json,'$.artifacts') IS NOT 'array'
    OR json_extract(metadata_json,'$.snapshotDigest') IS NOT snapshot_digest
  ELSE 1 END LIMIT 1`;
const UNREADABLE_REFERENCE = `SELECT 1 AS bad FROM native_buffer_certificates AS certificate,
  json_each(certificate.metadata_json,'$.artifacts') AS reference
  WHERE reference.type IS NOT 'object' OR json_type(reference.value,'$.sha256') IS NOT 'text'
    OR length(json_extract(reference.value,'$.sha256'))<>64 LIMIT 1`;

// Certificates are insert-only and never deleted (the store rejects a changed row), so an
// unchanged count and newest rowid mean no certificate appeared since the marker was read.
const CERTIFICATE_MARKER = `SELECT COUNT(*) AS certificates, COALESCE(MAX(rowid),0) AS newest
  FROM native_buffer_certificates`;

let reportedUnreadable = false;

async function missingTables(store: HostStore): Promise<"missing-tables" | undefined> {
  for (const table of TABLES)
    if (
      !(await store.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table))
    )
      return "missing-tables";
  return undefined;
}

async function unreadableCertificate(
  store: HostStore,
): Promise<"unreadable-certificate" | undefined> {
  if (
    (await store.db.prepare(UNREADABLE_CERTIFICATE).get()) ||
    (await store.db.prepare(UNREADABLE_REFERENCE).get())
  ) {
    if (!reportedUnreadable) {
      reportedUnreadable = true;
      console.warn("Native buffer blob GC skipped: a retained certificate is unreadable.");
    }
    return "unreadable-certificate";
  }
  return undefined;
}

async function guard(store: HostStore): Promise<NativeBufferBlobGcResult["skipped"]> {
  return (await missingTables(store)) ?? (await unreadableCertificate(store));
}

async function certificateMarker(store: HostStore) {
  const row = await store.db.prepare(CERTIFICATE_MARKER).get();
  return `${Number(row?.certificates ?? 0)}:${Number(row?.newest ?? 0)}`;
}

type Orphan = { sha256: string; byteLength: number };
type Snapshot = {
  /** Certificate marker read before the orphan scan; a different marker makes it stale. */
  marker: string;
  orphanBlobs: number;
  orphanBytes: number;
  /** Orphans in sha256 order, at most one pass worth; `truncated` when more exist. */
  candidates: Orphan[];
  truncated: boolean;
};

/** One full derivation of the orphan set: the unreadable-certificate guard and the
 * certificate JSON scans run here once, not once per delete batch. Call inside storeScope. */
async function takeSnapshot(
  store: HostStore,
  limit: number,
): Promise<Snapshot | { skipped: NonNullable<NativeBufferBlobGcResult["skipped"]> }> {
  const missing = await missingTables(store);
  if (missing) return { skipped: missing };
  const marker = await certificateMarker(store);
  const unreadable = await unreadableCertificate(store);
  if (unreadable) return { skipped: unreadable };
  const totals = await count(store);
  const rows = totals.orphanBlobs
    ? await store.db
        .prepare(`SELECT sha256, byte_length ${ORPHANS} ORDER BY sha256 LIMIT ?`)
        .all(limit)
    : [];
  return {
    marker,
    ...totals,
    candidates: rows.map((row) => ({
      sha256: String(row.sha256),
      byteLength: Number(row.byte_length),
    })),
    truncated: totals.orphanBlobs > rows.length,
  };
}

/** The next delete batch: up to the blob and byte caps (one larger blob still goes alone). */
function nextBatch(candidates: Orphan[], from: number) {
  const batch: Orphan[] = [];
  let bytes = 0;
  for (let index = from; index < candidates.length; index++) {
    const candidate = candidates[index];
    if (batch.length >= NATIVE_BUFFER_GC_BATCH_BLOBS) break;
    if (batch.length && bytes + candidate.byteLength > NATIVE_BUFFER_GC_BATCH_BYTES) break;
    batch.push(candidate);
    bytes += candidate.byteLength;
  }
  return batch;
}

async function count(store: HostStore) {
  const row = await store.db
    .prepare(`SELECT COUNT(*) AS blobs, COALESCE(SUM(byte_length),0) AS bytes ${ORPHANS}`)
    .get();
  return { orphanBlobs: Number(row?.blobs ?? 0), orphanBytes: Number(row?.bytes ?? 0) };
}

/** Counts unreferenced blobs and bytes without deleting anything. */
export function countOrphanNativeBufferBlobs(store: HostStore): Promise<NativeBufferBlobGcResult> {
  return store.db.storeScope(async () => {
    const skipped = await guard(store);
    if (skipped)
      return { orphanBlobs: 0, orphanBytes: 0, deletedBlobs: 0, deletedBytes: 0, skipped };
    return { ...(await count(store)), deletedBlobs: 0, deletedBytes: 0 };
  });
}

/** Deletes unreferenced blobs and their chunks. The orphan set is derived once per pass
 * (certificate JSON scanned once). Each delete transaction then re-proves its batch:
 * the certificate marker must be unchanged (otherwise the set is re-derived), and every
 * blob must still be absent from the artifact rows, so a concurrent complete() that
 * reuses a deduplicated blob is serialized before or after, never between check and
 * delete. Artifacts and certificates are never deleted here. */
export async function collectOrphanNativeBufferBlobs(
  store: HostStore,
  options: { maxBatches?: number; stopped?: () => boolean } = {},
): Promise<NativeBufferBlobGcResult> {
  const maxBatches = options.maxBatches ?? NATIVE_BUFFER_GC_MAX_BATCHES;
  const limit = NATIVE_BUFFER_GC_BATCH_BLOBS * maxBatches;
  const first = await store.db.storeScope(() => takeSnapshot(store, limit));
  if ("skipped" in first)
    return { orphanBlobs: 0, orphanBytes: 0, deletedBlobs: 0, deletedBytes: 0, ...first };
  const result: NativeBufferBlobGcResult = {
    orphanBlobs: first.orphanBlobs,
    orphanBytes: first.orphanBytes,
    deletedBlobs: 0,
    deletedBytes: 0,
  };
  if (!first.orphanBlobs) return result;
  let current = first;
  let position = 0;
  const refresh = async () => {
    const next = await store.db.storeScope(() => takeSnapshot(store, limit));
    if ("skipped" in next || !next.candidates.length) return false;
    current = next;
    position = 0;
    return true;
  };
  for (let batch = 0; batch < maxBatches; batch++) {
    if (options.stopped?.()) break;
    if (position >= current.candidates.length) {
      if (!current.truncated || !(await refresh())) break;
    }
    const chosen = nextBatch(current.candidates, position);
    const marker = current.marker;
    const outcome = await store.db.storeScope(() =>
      withShortBusyTimeout(store.db, () =>
        store.transaction(async () => {
          if (await missingTables(store)) return null;
          if ((await certificateMarker(store)) !== marker) return "stale" as const;
          const hashes = chosen.map((candidate) => candidate.sha256);
          const rows = await store.db
            .prepare(
              `SELECT sha256, byte_length FROM native_buffer_blobs
              WHERE sha256 IN (${hashes.map(() => "?").join(",")})
                AND sha256 NOT IN (SELECT sha256 FROM native_buffer_artifacts)`,
            )
            .all(...hashes);
          const keys = rows.map((row) => [String(row.sha256)]);
          if (keys.length) {
            await store.db.runMany("DELETE FROM native_buffer_blob_chunks WHERE sha256=?", keys);
            await store.db.runMany("DELETE FROM native_buffer_blobs WHERE sha256=?", keys);
          }
          return {
            consumed: chosen.length,
            blobs: rows.length,
            bytes: rows.reduce((sum, row) => sum + Number(row.byte_length), 0),
          };
        }, "checkpoint"),
      ),
    );
    if (!outcome) break;
    if (outcome === "stale") {
      if (!(await refresh())) break;
      continue;
    }
    position += outcome.consumed;
    result.deletedBlobs += outcome.blobs;
    result.deletedBytes += outcome.bytes;
  }
  return result;
}
