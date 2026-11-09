import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import {
  formatNativeBufferLegacyRelease,
  releaseNativeBufferLegacy,
} from "./native-buffer-legacy-release";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-legacy-release-"));
  dirs.push(dir);
  const db = new DatabaseSync(join(dir, "host.db"));
  db.exec(`
    CREATE TABLE native_buffer_clocks (report_id TEXT PRIMARY KEY, state_json TEXT NOT NULL);
    CREATE TABLE native_buffer_blobs (sha256 TEXT PRIMARY KEY, byte_length INTEGER NOT NULL);
    CREATE TABLE native_buffer_blob_chunks (sha256 TEXT, chunk_index INTEGER, data BLOB NOT NULL);
    CREATE TABLE native_buffer_artifacts (key TEXT PRIMARY KEY, sha256 TEXT NOT NULL);
    CREATE TABLE native_buffer_certificates (report_id TEXT, metadata_json TEXT NOT NULL);
    CREATE TABLE other (id INTEGER);
    INSERT INTO native_buffer_clocks VALUES ('r','{}');
    INSERT INTO other VALUES (1);
    INSERT INTO native_buffer_blobs VALUES ('a', 3000000);
    INSERT INTO native_buffer_artifacts VALUES ('k','a');
    INSERT INTO native_buffer_certificates VALUES ('r','{"x":1}');
  `);
  const insert = db.prepare("INSERT INTO native_buffer_blob_chunks VALUES ('a', ?, ?)");
  for (let i = 0; i < 30; i++) insert.run(i, Buffer.alloc(100_000, i));
  db.close();
  return dir;
}
const count = (dir: string, table: string) => {
  const db = new DatabaseSync(join(dir, "host.db"));
  try {
    return Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
  } finally {
    db.close();
  }
};

it("reports without --yes and changes nothing", () => {
  const dir = fixture();
  const result = releaseNativeBufferLegacy(dir, { apply: false });
  expect(result.dropped).toBe(false);
  expect(result.tables.find((t) => t.table === "native_buffer_blob_chunks")).toMatchObject({
    rows: 30,
    bytes: 3_000_030,
  });
  expect(count(dir, "native_buffer_blob_chunks")).toBe(30);
  expect(formatNativeBufferLegacyRelease(result)).toContain("--yes");
});

it("drops content rows, keeps clocks and other tables, and shrinks the file", () => {
  const dir = fixture();
  const result = releaseNativeBufferLegacy(dir, { apply: true });
  expect(result.dropped).toBe(true);
  expect(result.sizeAfter!).toBeLessThan(result.sizeBefore);
  for (const table of [
    "native_buffer_blob_chunks",
    "native_buffer_blobs",
    "native_buffer_artifacts",
    "native_buffer_certificates",
  ])
    expect(count(dir, table)).toBe(0);
  expect(count(dir, "native_buffer_clocks")).toBe(1);
  expect(count(dir, "other")).toBe(1);
});

it("rejects a directory without host.db", () => {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-legacy-release-"));
  dirs.push(dir);
  expect(() => releaseNativeBufferLegacy(dir, { apply: true })).toThrow(/No host.db/);
});
