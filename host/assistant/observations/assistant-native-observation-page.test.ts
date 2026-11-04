import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NativeAdmissionOwner, nativeAdmissionBytes, nativeAdmissionDigest, nativeAdmissionFingerprint } from "../native/assistant-native-admission";
import { verifyNativeObservationPage, type NativeObservationCapture } from "./assistant-native-observation-page";

async function fixture() {
  const key = generateKeyPairSync("ed25519");
  const other = generateKeyPairSync("ed25519");
  const path = join(await mkdtemp(join(tmpdir(), "observation-proof-")), "registry.json");
  const entry = (installationId: string, pair: typeof key) => ({ installationId, hostId: "host", publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(), fingerprint: nativeAdmissionFingerprint(pair.publicKey) });
  await writeFile(path, JSON.stringify({ version: 1, generation: "a".repeat(64), entries: [entry("desktop", key), entry("other", other)] }));
  const admission = new NativeAdmissionOwner(path, "host");
  const signed = async (operationJson: string, installationId = "desktop", action = "assistant.observations.baseline") => {
    const challenge = await admission.challenge({ installationId, hostId: "host", action, requestDigest: nativeAdmissionDigest(operationJson) });
    return { operationJson, proof: { challenge, signature: sign(null, nativeAdmissionBytes(challenge), (installationId === "desktop" ? key : other).privateKey).toString("base64url") } };
  };
  // Obtain the actual registry revision through the same verified native admission path.
  const initial = await signed("capture", "desktop", "assistant.capture");
  const registryRevision = await admission.consume({ installationId: "desktop", hostId: "host", action: "assistant.capture", requestDigest: nativeAdmissionDigest("capture") }, initial.proof);
  const captured: NativeObservationCapture = { environmentId: "host", threadId: "room", issuer: "window", installationId: "desktop", registryRevision, visibilityEpoch: 1, policyGeneration: "policy", projectionRevision: 4, policyDigest: "b".repeat(64), privacyRevision: 7 };
  const expected = { relayId: "relay", requestId: "request", operationHash: "c".repeat(64), source: "note" as const, offset: 0 };
  const page = { fingerprint: "d".repeat(64), offset: 0, nextOffset: 1, total: 1, watermark: 2, sourceGap: true, entries: [{ sourceId: "note-id", revision: 2 }] };
  const receipt = { environmentId: captured.environmentId, threadId: captured.threadId, issuer: captured.issuer, projectionRevision: captured.projectionRevision, policyDigest: captured.policyDigest, privacyRevision: captured.privacyRevision, relayId: expected.relayId, requestId: expected.requestId, operationHash: expected.operationHash, source: expected.source, page };
  return { admission, captured, expected, page, receipt, signed };
}

describe("Native observation page admission", () => {
  it.each(["note", "server"] as const)("accepts and consumes the exact signed %s page", async source => {
    const f = await fixture();
    const expected = { ...f.expected, source };
    const envelope = await f.signed(JSON.stringify({ ...f.receipt, source }));
    await expect(verifyNativeObservationPage(f.admission, f.captured, expected, envelope, () => true)).resolves.toEqual(f.page);
    await expect(verifyNativeObservationPage(f.admission, f.captured, expected, envelope, () => true)).rejects.toThrow();
  });

  it.each([
    ["Host", { environmentId: "other" }], ["Room", { threadId: "other" }], ["issuer", { issuer: "other" }],
    ["projection revision", { projectionRevision: 5 }], ["policy digest", { policyDigest: "e".repeat(64) }],
    ["privacy revision", { privacyRevision: 8 }], ["relay", { relayId: "other" }], ["request", { requestId: "other" }],
    ["operation hash", { operationHash: "e".repeat(64) }], ["source", { source: "server" }],
    ["page offset", { page: { fingerprint: "d".repeat(64), offset: 1, nextOffset: 1, total: 1, entries: [] } }],
  ])("rejects a valid signature for another %s", async (_label, change) => {
    const f = await fixture();
    const envelope = await f.signed(JSON.stringify({ ...f.receipt, ...change }));
    await expect(verifyNativeObservationPage(f.admission, f.captured, f.expected, envelope, () => true)).rejects.toThrow();
  });

  it("rejects another enrolled installation, action, forged content and revoked source", async () => {
    const f = await fixture();
    const json = JSON.stringify(f.receipt);
    await expect(verifyNativeObservationPage(f.admission, f.captured, f.expected, await f.signed(json, "other"), () => true)).rejects.toThrow();
    await expect(verifyNativeObservationPage(f.admission, f.captured, f.expected, await f.signed(json, "desktop", "assistant.other"), () => true)).rejects.toThrow();
    const forged = await f.signed(json);
    forged.operationJson = JSON.stringify({ ...f.receipt, page: { ...f.page, total: 2 } });
    await expect(verifyNativeObservationPage(f.admission, f.captured, f.expected, forged, () => true)).rejects.toThrow();
    const badSignature = await f.signed(json);
    badSignature.proof.signature = "A".repeat(86);
    await expect(verifyNativeObservationPage(f.admission, f.captured, f.expected, badSignature, () => true)).rejects.toThrow();
    const revoked = await f.signed(json);
    await expect(verifyNativeObservationPage(f.admission, f.captured, f.expected, revoked, () => false)).rejects.toThrow();
    let checks = 0;
    await expect(verifyNativeObservationPage(f.admission, f.captured, f.expected, revoked, () => ++checks === 1)).rejects.toThrow("trust changed");
  });
});
