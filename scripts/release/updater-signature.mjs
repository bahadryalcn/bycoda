/** Minisign verification using Node's Ed25519/BLAKE2b primitives.
 * Format: https://github.com/jedisct1/minisign/blob/master/src/minisign.c
 * Tauri envelope: https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/src/helpers/updater_signature.rs
 */
import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
function decode(value, size) {
  assert(
    typeof value === "string" &&
      value.length > 0 &&
      value.length < 16384 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(value),
    "Malformed signature base64",
  );
  const bytes = Buffer.from(value, "base64");
  assert(
    bytes.toString("base64") === value && (size === undefined || bytes.length === size),
    "Noncanonical signature encoding/size",
  );
  return bytes;
}
export function verifyUpdaterSignature({ data, signature, publicKey, filename, version }) {
  assert(Buffer.isBuffer(data) && data.length > 0, "Signature must cover actual artifact bytes");
  const keyLines = decode(publicKey.trim()).toString("utf8").trim().split(/\r?\n/);
  const lines = decode(signature.trim()).toString("utf8").trim().split(/\r?\n/);
  assert(
    keyLines.length === 2 &&
      keyLines[0].startsWith("untrusted comment: ") &&
      lines.length === 4 &&
      lines[0].startsWith("untrusted comment: ") &&
      lines[2].startsWith("trusted comment: "),
    "Malformed minisign envelope",
  );
  const key = decode(keyLines[1], 42),
    packet = decode(lines[1], 74),
    global = decode(lines[3], 64);
  assert(
    key.subarray(0, 2).toString() === "Ed" &&
      ["Ed", "ED"].includes(packet.subarray(0, 2).toString()) &&
      key.subarray(2, 10).equals(packet.subarray(2, 10)),
    "Updater signing key/algorithm differs",
  );
  const cryptoKey = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key.subarray(10)]),
    format: "der",
    type: "spki",
  });
  const payload =
    packet.subarray(0, 2).toString() === "ED"
      ? createHash("blake2b512").update(data).digest()
      : data;
  assert(
    verify(null, payload, cryptoKey, packet.subarray(10)),
    "Updater artifact signature is invalid",
  );
  const comment = lines[2].slice("trusted comment: ".length);
  assert(
    verify(null, Buffer.concat([packet.subarray(10), Buffer.from(comment)]), cryptoKey, global),
    "Updater trusted-comment signature is invalid",
  );
  const fields = comment.split("\t");
  assert.equal(
    fields.filter((field) => field.startsWith("file:")).length,
    1,
    "Missing signed artifact filename",
  );
  assert(fields.includes(`file:${filename}`), "Signed artifact filename differs");
  const versions = fields.filter((field) => field.startsWith("version:"));
  assert(
    versions.length <= 1 && (!versions.length || versions[0] === `version:${version}`),
    "Signed release version differs",
  );
  return {
    verified: true,
    prehashed: packet.subarray(0, 2).toString() === "ED",
    signedVersion: versions.length === 1,
  };
}
