/** Read only selected bounded NSIS members to stdout; never run the installer. */
import assert from "node:assert/strict";
import { parseSha256Sum } from "./checksum.mjs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function normalizedWindowsBinaryHash(bytes) {
  const marker = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_"),
    offset = bytes.indexOf(marker);
  assert(
    offset >= 0 && bytes.indexOf(marker, offset + 1) === -1,
    "Expected exactly one Tauri bundle marker",
  );
  const start = offset + marker.length;
  assert(
    ["UNK", "NSS"].includes(bytes.subarray(start, start + 3).toString()),
    "Invalid Tauri bundle marker",
  );
  const normalized = Buffer.from(bytes);
  normalized.write("UNK", start);
  return hash(normalized);
}
export function installerSelection(listing, archive) {
  assert(
    typeof archive === "string" && /^[A-Za-z0-9_.-]+\.zip$/.test(archive),
    "Invalid embedded Host archive name",
  );
  const entries = listing
    .split(/\r?\n\r?\n/)
    .map((block) => ({
      name: /^Path = (.+)$/m.exec(block)?.[1]?.trim().replaceAll("\\", "/"),
      bytes: Number(/^Size = (\d+)$/m.exec(block)?.[1]),
    }))
    .filter((entry) => entry.name);
  assert(entries.length > 0 && entries.length <= 5000, "Invalid installer member count");
  return ["bycoda.exe", archive, `${archive}.sha256`].map((name) => {
    const matches = entries.filter(
      (entry) => path.posix.basename(entry.name).toLowerCase() === name.toLowerCase(),
    );
    assert(
      matches.length === 1 &&
        Number.isSafeInteger(matches[0].bytes) &&
        matches[0].bytes > 0 &&
        matches[0].bytes <= 512 * 1024 * 1024,
      `Missing/ambiguous bounded installer member: ${name}`,
    );
    assert(
      // oxlint-disable-next-line no-control-regex -- reject control characters in file names
      !/[\x00-\x1f\x7f:*?[\]]/.test(matches[0].name) &&
        !matches[0].name.startsWith("/") &&
        matches[0].name.split("/").every((part) => part && part !== "." && part !== ".."),
      "Unsafe installer member path",
    );
    return {
      ...matches[0],
      target: name === "bycoda.exe" ? "native/bycoda.exe" : `native/host/${name}`,
    };
  });
}
export function readWindowsInstaller(
  installer,
  { archive, nativeHash, hostArchiveHash, sevenZip = "7z" },
) {
  const listing = execFileSync(sevenZip, ["l", "-slt", "-ba", "--", installer], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    timeout: 60000,
  });
  const extracted = installerSelection(listing, archive).map((entry) => {
    const payload = execFileSync(sevenZip, ["e", "-so", "--", installer, entry.name], {
      windowsHide: true,
      maxBuffer: 512 * 1024 * 1024,
      timeout: 60000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert(payload.length === entry.bytes, "Installer member size differs");
    return { ...entry, payload };
  });
  assert.equal(
    normalizedWindowsBinaryHash(extracted[0].payload),
    nativeHash,
    "Installer executable differs from frozen native binary",
  );
  assert.equal(
    hash(extracted[1].payload),
    hostArchiveHash,
    "Installer embeds another Host archive",
  );
  assert.equal(
    parseSha256Sum(extracted[2].payload.toString("utf8"), archive),
    hostArchiveHash,
    "Installer Host checksum differs",
  );
  return extracted;
}
