// oxlint-disable-next-line no-restricted-imports -- test fixture writes scratch files in a temporary directory, never Host state
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../store";

/** Schema of the retired Host native buffer tables, as an old Host created it. */
export const RETIRED_NATIVE_BUFFER_SCHEMA = `
  CREATE TABLE IF NOT EXISTS native_buffer_clocks (report_id TEXT PRIMARY KEY,state_json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS native_buffer_clock_witnesses (report_id TEXT PRIMARY KEY,state_json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS native_buffer_blobs (sha256 TEXT PRIMARY KEY,byte_length INTEGER NOT NULL,chunk_count INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS native_buffer_blob_chunks (sha256 TEXT NOT NULL,chunk_index INTEGER NOT NULL,chunk_sha256 TEXT NOT NULL,data BLOB NOT NULL,PRIMARY KEY(sha256,chunk_index));
  CREATE TABLE IF NOT EXISTS native_buffer_artifacts (key TEXT PRIMARY KEY,sha256 TEXT NOT NULL,byte_length INTEGER NOT NULL,immutable INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS native_buffer_certificates (report_id TEXT NOT NULL,report_version INTEGER NOT NULL,snapshot_digest TEXT NOT NULL,metadata_json TEXT NOT NULL,PRIMARY KEY(report_id,report_version,snapshot_digest));
  CREATE TABLE IF NOT EXISTS native_buffer_directory_children (directory TEXT NOT NULL,name TEXT NOT NULL,is_directory INTEGER NOT NULL,first_artifact_rowid INTEGER NOT NULL,PRIMARY KEY(directory,name));
  CREATE UNIQUE INDEX IF NOT EXISTS native_buffer_directory_order ON native_buffer_directory_children(directory,first_artifact_rowid);
  CREATE TABLE IF NOT EXISTS native_buffer_directory_index (id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,artifact_rowid INTEGER NOT NULL);
`;

export const RETIRED_NATIVE_BUFFER_TABLE_NAMES = [
  "native_buffer_clocks",
  "native_buffer_clock_witnesses",
  "native_buffer_blobs",
  "native_buffer_blob_chunks",
  "native_buffer_artifacts",
  "native_buffer_certificates",
  "native_buffer_directory_children",
  "native_buffer_directory_index",
];

/** A Host store (inside a fresh data directory) holding the old tables with a few rows. */
export async function storeWithRetiredNativeBuffers(
  cleanups: Array<() => Promise<void>>,
  options: { chunks?: number } = {},
) {
  const dataDir = mkdtempSync(join(tmpdir(), "bycoda-retired-buffers-"));
  const store = new HostStore(join(dataDir, "host.db"));
  cleanups.push(async () => {
    await store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  await store.db.exec(RETIRED_NATIVE_BUFFER_SCHEMA);
  await store.db.exec(`
    INSERT INTO native_buffer_clocks VALUES ('r','{}');
    INSERT INTO native_buffer_clock_witnesses VALUES ('r','{}');
    INSERT INTO native_buffer_blobs VALUES ('aa',3,1);
    INSERT INTO native_buffer_artifacts VALUES ('native-activity/buffers/x.json','aa',3,0);
    INSERT INTO native_buffer_certificates VALUES ('r',1,'d','{}');
    INSERT INTO native_buffer_directory_children VALUES ('native-activity','buffers',1,1);
    INSERT INTO native_buffer_directory_index VALUES (1,1,1);
  `);
  for (let index = 0; index < (options.chunks ?? 5); index++)
    await store.db
      .prepare("INSERT INTO native_buffer_blob_chunks VALUES ('aa',?,'c',zeroblob(1000))")
      .run(index);
  await store.db.exec("INSERT INTO metadata VALUES ('keepme','1')");
  return { store, dataDir };
}

export const tableNames = async (store: HostStore) =>
  (
    await store.db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index')").all()
  ).map((row) => String(row.name));

/** Retired directories plus siblings that must survive. Returns the managed root. */
export function retiredNativeBufferDirectories(dataDir: string) {
  const managedRoot = join(dataDir, "managed-workspaces");
  const put = (path: string) => {
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "file.json"), "{}");
  };
  put(join(managedRoot, "native-activity", "buffers"));
  put(join(managedRoot, "native-activity", "buffer-history", "deep"));
  put(join(dataDir, "native-buffer-store.git", "objects"));
  put(join(managedRoot, "native-activity", "processes"));
  put(join(managedRoot, "recovery"));
  put(join(dataDir, "attachments"));
  return managedRoot;
}
