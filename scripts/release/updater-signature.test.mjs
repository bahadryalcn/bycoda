import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { verifyUpdaterSignature } from "./updater-signature.mjs";
test("real Ed25519 verification binds updater bytes, key, filename and trusted version", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ type: "spki", format: "der" }).subarray(-32),
    keyId = Buffer.from("fixture1");
  const key = Buffer.concat([Buffer.from("Ed"), keyId, raw]);
  const encodedKey = Buffer.from(
    `untrusted comment: synthetic fixture key\n${key.toString("base64")}\n`,
  ).toString("base64");
  const data = Buffer.from("synthetic updater archive"),
    filename = "fixture.exe",
    version = "0.6.94";
  for (const algorithm of ["ED", "Ed"]) {
    const value = algorithm === "ED" ? createHash("blake2b512").update(data).digest() : data;
    const signature = sign(null, value, privateKey),
      comment = `timestamp:1\tfile:${filename}\tversion:${version}`;
    const packet = Buffer.concat([Buffer.from(algorithm), keyId, signature]);
    const global = sign(null, Buffer.concat([signature, Buffer.from(comment)]), privateKey);
    const envelope = Buffer.from(
      `untrusted comment: synthetic fixture\n${packet.toString("base64")}\ntrusted comment: ${comment}\n${global.toString("base64")}\n`,
    ).toString("base64");
    const input = { data, signature: envelope, publicKey: encodedKey, filename, version };
    assert.equal(verifyUpdaterSignature(input).verified, true);
    for (const mutation of [
      { data: Buffer.from("tampered") },
      { filename: "other.exe" },
      { version: "0.6.93" },
      {
        signature: Buffer.from(
          Buffer.from(envelope, "base64").toString().replace("timestamp:1", "timestamp:2"),
        ).toString("base64"),
      },
      { signature: "malformed" },
    ])
      assert.throws(() => verifyUpdaterSignature({ ...input, ...mutation }));
  }
});
