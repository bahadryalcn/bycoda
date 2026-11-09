import assert from "node:assert/strict";
import test from "node:test";
import { installerSelection, normalizedWindowsBinaryHash } from "./windows-installer.mjs";
function peImage(signed = false) {
  const bytes = Buffer.alloc(signed ? 1040 : 1024);
  bytes.write("MZ");
  bytes.writeUInt32LE(128, 0x3c);
  bytes.writeUInt32LE(0x4550, 128);
  bytes.writeUInt16LE(1, 134);
  bytes.writeUInt16LE(240, 148);
  const optional = 152;
  bytes.writeUInt16LE(0x20b, optional);
  bytes.writeUInt32LE(512, optional + 60);
  bytes.writeUInt32LE(16, optional + 108);
  bytes.writeUInt32LE(512, 392 + 16);
  bytes.writeUInt32LE(512, 392 + 20);
  bytes.write(`__TAURI_BUNDLE_TYPE_VAR_${signed ? "NSS" : "UNK"}`, 600);
  bytes.write("payload", 800);
  if (signed) {
    bytes.writeUInt32LE(1234, optional + 64);
    bytes.writeUInt32LE(1024, optional + 144);
    bytes.writeUInt32LE(16, optional + 148);
    bytes.writeUInt32LE(16, 1024);
    bytes.writeUInt16LE(0x200, 1028);
    bytes.writeUInt16LE(2, 1030);
    bytes.fill(42, 1032);
  }
  return bytes;
}

test("signed NSIS copy matches unsigned native payload while code and overlay bytes remain bound", () => {
  const original = peImage(),
    signed = peImage(true);
  assert.equal(normalizedWindowsBinaryHash(original), normalizedWindowsBinaryHash(signed));
  for (const offset of [800, 1023]) {
    const modified = Buffer.from(signed);
    modified[offset] ^= 1;
    assert.notEqual(normalizedWindowsBinaryHash(original), normalizedWindowsBinaryHash(modified));
  }
  assert.equal(original.readUInt32LE(216), 0);
  assert.equal(signed.readUInt32LE(216), 1234);
  const unsignedOverlay = peImage(),
    signedOverlay = peImage(true);
  unsignedOverlay.writeUInt32LE(496, 408);
  signedOverlay.writeUInt32LE(496, 408);
  assert.equal(
    normalizedWindowsBinaryHash(unsignedOverlay),
    normalizedWindowsBinaryHash(signedOverlay),
  );
  signedOverlay[1016] = 1;
  assert.notEqual(
    normalizedWindowsBinaryHash(unsignedOverlay),
    normalizedWindowsBinaryHash(signedOverlay),
  );
});

test("certificate normalization rejects mapped sections, unbounded tables and malformed records", () => {
  for (const mutate of [
    (image) => image.writeUInt32LE(512, 296),
    (image) => image.writeUInt32LE(1025, 296),
    (image) => image.writeUInt32LE(32, 300),
    (image) => image.writeUInt32LE(17, 1024),
    (image) => image.writeUInt16LE(1, 1030),
    (image) => image.writeUInt32LE(2, 0x3c),
  ]) {
    const image = peImage(true);
    mutate(image);
    assert.throws(() => normalizedWindowsBinaryHash(image), /PE/);
  }
  assert.throws(
    () => normalizedWindowsBinaryHash(Buffer.concat([peImage(true), Buffer.alloc(8)])),
    /PE/,
  );
  const badPadding = peImage(true);
  badPadding.writeUInt32LE(15, 1024);
  badPadding[1039] = 1;
  assert.throws(() => normalizedWindowsBinaryHash(badPadding), /padding/);
});
test("bounded installer selection rejects duplicate/case aliases, traversal and oversized members", () => {
  const archive = "bycoda-host-win32-x64.zip";
  const listing = (native = "bycoda.exe", size = 10) =>
    `Path = ${native}\nSize = ${size}\n\nPath = host/${archive}\nSize = 20\n\nPath = host/${archive}.sha256\nSize = 64\n`;
  assert.equal(installerSelection(listing(), archive)[0].target, "native/bycoda.exe");
  assert.throws(() => installerSelection(listing("../bycoda.exe"), archive));
  assert.throws(() => installerSelection(listing("wild*/bycoda.exe"), archive));
  assert.throws(() => installerSelection(listing("bycoda.exe", 1024 ** 3), archive));
  assert.throws(() => installerSelection(`${listing()}\nPath = BYCODA.EXE\nSize = 10\n`, archive));
  assert.throws(() => installerSelection(listing(), "../escape.zip"));
  assert.equal(
    normalizedWindowsBinaryHash(Buffer.from("a__TAURI_BUNDLE_TYPE_VAR_NSSb")),
    normalizedWindowsBinaryHash(Buffer.from("a__TAURI_BUNDLE_TYPE_VAR_UNKb")),
  );
});
