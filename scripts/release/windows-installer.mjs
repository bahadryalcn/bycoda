/** Read only selected bounded NSIS members to stdout; never run the installer. */
import assert from "node:assert/strict";
import { parseSha256Sum } from "./checksum.mjs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function normalizedAuthenticodeImage(bytes) {
  const image = Buffer.from(bytes);
  if (image.length < 64 || image.toString("ascii", 0, 2) !== "MZ") return image;
  const pe = image.readUInt32LE(0x3c);
  assert(
    pe >= 64 && pe <= image.length - 24 && image.readUInt32LE(pe) === 0x4550,
    "Invalid PE header",
  );
  const optional = pe + 24,
    optionalSize = image.readUInt16LE(pe + 20);
  assert(
    optionalSize >= 68 && optional <= image.length - optionalSize,
    "Invalid PE optional header",
  );
  const magic = image.readUInt16LE(optional);
  assert([0x10b, 0x20b].includes(magic), "Unsupported PE image");
  const directories = optional + (magic === 0x20b ? 112 : 96);
  const security = directories + 32;
  assert(
    security + 8 <= optional + optionalSize && image.readUInt32LE(directories - 4) >= 5,
    "Missing PE security directory",
  );
  const certificate = image.readUInt32LE(security),
    certificateSize = image.readUInt32LE(security + 4);
  const sectionCount = image.readUInt16LE(pe + 6),
    sections = optional + optionalSize;
  assert(
    sectionCount <= 96 && sections + sectionCount * 40 <= image.length,
    "Invalid PE section table",
  );
  let contentEnd = image.readUInt32LE(optional + 60);
  assert(
    contentEnd >= sections + sectionCount * 40 && contentEnd <= image.length,
    "Invalid PE headers size",
  );
  for (let index = 0; index < sectionCount; index++) {
    const section = sections + index * 40;
    const end = image.readUInt32LE(section + 20) + image.readUInt32LE(section + 16);
    assert(end <= image.length, "Invalid PE section extent");
    contentEnd = Math.max(contentEnd, end);
  }
  if (certificate || certificateSize) {
    assert(
      certificate >= contentEnd &&
        certificate % 8 === 0 &&
        certificateSize >= 8 &&
        certificate + certificateSize === image.length,
      "Invalid trailing PE certificate table",
    );
    for (let cursor = certificate; cursor < image.length;) {
      assert(cursor <= image.length - 8, "Truncated PE certificate record");
      const size = image.readUInt32LE(cursor),
        padded = Math.ceil(size / 8) * 8;
      assert(
        size >= 8 &&
          padded <= image.length - cursor &&
          image.readUInt16LE(cursor + 4) === 0x200 &&
          image.readUInt16LE(cursor + 6) === 2,
        "Invalid PE certificate record",
      );
      assert(
        image.subarray(cursor + size, cursor + padded).every((byte) => byte === 0),
        "Invalid PE certificate padding",
      );
      cursor += padded;
    }
  }
  // Tauri restores the unsigned build EXE after signing its patched NSIS copy.
  // Keep every payload/overlay byte; only Authenticode-owned fields may differ.
  image.fill(0, optional + 64, optional + 68);
  image.fill(0, security, security + 8);
  return certificate ? image.subarray(0, certificate) : image;
}
export function normalizedWindowsBinaryHash(bytes) {
  const normalized = normalizedAuthenticodeImage(bytes);
  const marker = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_"),
    offset = normalized.indexOf(marker);
  assert(
    offset >= 0 && normalized.indexOf(marker, offset + 1) === -1,
    "Expected exactly one Tauri bundle marker",
  );
  const start = offset + marker.length;
  assert(
    ["UNK", "NSS"].includes(normalized.subarray(start, start + 3).toString()),
    "Invalid Tauri bundle marker",
  );
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
