import assert from "node:assert/strict";
import test from "node:test";
import { installerSelection, normalizedWindowsBinaryHash } from "./windows-installer.mjs";
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
