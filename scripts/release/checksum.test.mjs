import assert from "node:assert/strict";
import test from "node:test";
import { parseSha256Sum, formatSha256Sum } from "./checksum.mjs";
test("reads actual sha256sum text and binary-mode records with exact filename", () => {
  const hash = "a".repeat(64);
  assert.equal(
    parseSha256Sum(`${hash}  bycoda-host-win32-x64.zip\n`, "bycoda-host-win32-x64.zip"),
    hash,
  );
  assert.equal(parseSha256Sum(`${hash} *archive.zip\r\n`, "archive.zip"), hash);
});

test("published archive checksums round-trip through the same filename-bound reader", () => {
  const hash = "b".repeat(64),
    filename = "bycoda-host-win32-x64.zip";
  const record = formatSha256Sum(hash, filename);
  assert.equal(record, `${hash}  ${filename}\n`);
  assert.equal(parseSha256Sum(record, filename), hash);
  assert.throws(() => parseSha256Sum(record, "bycoda-host-win32-arm64.zip"));
  assert.throws(() => formatSha256Sum("invalid", filename));
  assert.throws(() => formatSha256Sum(hash, "../archive.zip"));
});
test("rejects hash-only, another archive, duplicate records and unsafe expected names", () => {
  const hash = "a".repeat(64);
  for (const value of [
    hash,
    `${hash}  other.zip\n`,
    `${hash}  archive.zip\n${hash}  archive.zip\n`,
  ])
    assert.throws(() => parseSha256Sum(value, "archive.zip"));
  assert.throws(() => parseSha256Sum(`${hash}  ../archive.zip\n`, "../archive.zip"));
});
