import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RoomAttestationSigner, verifyRoomAttestation, type RoomAttestation } from "./assistant-room-attestation";
it("binds exact Hosts, real thread, scope, request, nonce and expiry across signer restart", async () => {
 const directory = mkdtempSync(join(tmpdir(), "room-proof-")), path = join(directory, "key");
 try {
  const signer = new RoomAttestationSigner(path, "origin", async id => id === "thread" ? { id } : null, () => 1000);
  const concurrent = new RoomAttestationSigner(path, "origin", async id => ({ id }), () => 1000);
  const [firstKey, concurrentKey] = await Promise.all([signer.publicKey(), concurrent.publicKey()]);
  expect(firstKey).toBe(concurrentKey);
  const value: RoomAttestation = { version: 1, originEnvironmentId: "origin", originNativeRevision: "a".repeat(64), targetEnvironmentId: "target", threadId: "thread", projectId: "project", grantId: "grant", action: "tasks.get", requestId: "request", scopeHash: "a".repeat(64), nonce: "b".repeat(64), expiresAt: 2000 };
  const signature = await signer.attest(value, async () => true), key = await signer.publicKey();
  expect(verifyRoomAttestation(key, value, signature, 1000)).toBe(true);
  expect(verifyRoomAttestation(key, { ...value, targetEnvironmentId: "other" }, signature, 1000)).toBe(false);
  expect(verifyRoomAttestation(key, { ...value, nonce: "c".repeat(64) }, signature, 1000)).toBe(false);
  expect(verifyRoomAttestation(key, value, signature, 2000)).toBe(false);
  const restarted = new RoomAttestationSigner(path, "origin", async id => ({ id }), () => 1000);
  expect(await restarted.publicKey()).toBe(key);
  await expect(signer.attest(value, async () => false)).rejects.toThrow("source unavailable");
  await expect(signer.attest({ ...value, threadId: "missing" }, async () => true)).rejects.toThrow("source unavailable");
 } finally { rmSync(directory, { recursive: true, force: true }); }
});

