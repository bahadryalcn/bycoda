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

let reportedUnreadable = false;

async function guard(store: HostStore): Promise<NativeBufferBlobGcResult["skipped"]> {
  for (const table of TABLES)
    if (
      !(await store.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table))
    )
      return "missing-tables";
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

/** Deletes unreferenced blobs and their chunks. Each batch re-derives the orphan set in
 * the same transaction that deletes it, so a concurrent complete() that reuses a
 * deduplicated blob is serialized before or after, never between check and delete.
 * Artifacts and certificates are never deleted here. */
export async function collectOrphanNativeBufferBlobs(
  store: HostStore,
  options: { maxBatches?: number; stopped?: () => boolean } = {},
): Promise<NativeBufferBlobGcResult> {
  const before = await countOrphanNativeBufferBlobs(store);
  const result = { ...before };
  if (before.skipped || !before.orphanBlobs) return result;
  for (let batch = 0; batch < (options.maxBatches ?? NATIVE_BUFFER_GC_MAX_BATCHES); batch++) {
    if (options.stopped?.()) break;
    const deleted = await store.db.storeScope(() =>
      withShortBusyTimeout(store.db, () =>
        store.transaction(async () => {
          if (await guard(store)) return null;
          const rows = await store.db
            .prepare(`SELECT sha256, byte_length ${ORPHANS} ORDER BY sha256 LIMIT ?`)
            .all(NATIVE_BUFFER_GC_BATCH_BLOBS);
          const chosen: string[] = [];
          let bytes = 0;
          for (const row of rows) {
            const length = Number(row.byte_length);
            if (chosen.length && bytes + length > NATIVE_BUFFER_GC_BATCH_BYTES) break;
            chosen.push(String(row.sha256));
            bytes += length;
          }
          if (!chosen.length) return null;
          const keys = chosen.map((hash) => [hash]);
          await store.db.runMany("DELETE FROM native_buffer_blob_chunks WHERE sha256=?", keys);
          await store.db.runMany("DELETE FROM native_buffer_blobs WHERE sha256=?", keys);
          return { blobs: chosen.length, bytes, more: rows.length > chosen.length };
        }, "checkpoint"),
      ),
    );
    if (!deleted) break;
    result.deletedBlobs += deleted.blobs;
    result.deletedBytes += deleted.bytes;
    if (!deleted.more && deleted.blobs < NATIVE_BUFFER_GC_BATCH_BLOBS) break;
  }
  return result;
}
