import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { NativeAdmissionOwner, nativeAdmissionBytes, nativeAdmissionDigest, nativeAdmissionFingerprint } from "./assistant-native-admission";
import { verifyWorkspaceReceipt } from "./assistant-workspace-receipt";

it("accepts only the exact original workspace operation and consumes its native proof once", async () => {
  const key = generateKeyPairSync("ed25519");
  const path = join(await mkdtemp(join(tmpdir(), "workspace-proof-")), "registry.json");
  await writeFile(path, JSON.stringify({ version: 1, generation: "a".repeat(64), entries: [{ installationId: "desktop", hostId: "host", publicKey: key.publicKey.export({ type: "spki", format: "pem" }).toString(), fingerprint: nativeAdmissionFingerprint(key.publicKey) }] }));
  const admission = new NativeAdmissionOwner(path, "host");
  const expected = { environmentId: "host", threadId: "room", projectId: "project", targetCwd: "C:/project", operationId: "original", action: "workspace.sessions.create", originalInput: { requestId: "original", title: "New" } };
  const operationJson = JSON.stringify({ ...expected, issuer: "window", relayId: "relay", result: { state: "accepted", result: { sessionId: "session" } } });
  const challenge = await admission.challenge({ installationId: "desktop", hostId: "host", action: "assistant.workspace.receipt", requestDigest: nativeAdmissionDigest(operationJson) });
  const captured = { relayId: "relay", envelope: { operationJson, proof: { challenge, signature: sign(null, nativeAdmissionBytes(challenge), key.privateKey).toString("base64url") } } };
  await expect(verifyWorkspaceReceipt(admission, captured, { ...expected, originalInput: { ...expected.originalInput, title: "Changed" } }, async () => true)).rejects.toThrow("identity changed");
  await expect(verifyWorkspaceReceipt(admission, captured, { ...expected, projectId: "other" }, async () => true)).rejects.toThrow("source changed");
  await expect(verifyWorkspaceReceipt(admission, captured, expected, async () => true)).resolves.toEqual({ state: "accepted", result: { sessionId: "session" } });
  await expect(verifyWorkspaceReceipt(admission, captured, expected, async () => true)).rejects.toThrow();
  const acceptedJson = JSON.stringify({ ...expected, issuer: "window", relayId: "relay-2", result: { state: "ownerAccepted" } });
  const acceptedChallenge = await admission.challenge({ installationId: "desktop", hostId: "host", action: "assistant.workspace.receipt", requestDigest: nativeAdmissionDigest(acceptedJson) });
  const ownerAccepted = { relayId: "relay-2", envelope: { operationJson: acceptedJson, proof: { challenge: acceptedChallenge, signature: sign(null, nativeAdmissionBytes(acceptedChallenge), key.privateKey).toString("base64url") } } };
  await expect(verifyWorkspaceReceipt(admission, ownerAccepted, expected, async () => true, { installationId: "other", registryRevision: "other" })).rejects.toThrow("installation changed");
  await expect(verifyWorkspaceReceipt(admission, ownerAccepted, expected, async () => true)).resolves.toEqual({ state: "ownerAccepted" });
});
