import { createPublicKey } from "node:crypto";
import { expect, it } from "vitest";
import { NativeAdmission, nativeAdmissionDigest, nativeAdmissionFingerprint } from "./assistant-native-admission";

it("consumes Rust ring's fixed Ed25519 proof for exact Turkish operation bytes", () => {
  // Test-only RFC 8410 public key for the fixed seed in the Rust interoperability test.
  const der = Buffer.from("MCowBQYDK2VwAyEAiojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w=", "base64");
  const publicKey = createPublicKey({ key: der, format: "der", type: "spki" });
  const request = { installationId: "native-fd110d301d2f077de1414b8f99f441b1", hostId: "host", action: "assistant.delegation.issue", requestDigest: nativeAdmissionDigest('{"text":"İstanbul için çalışma"}') };
  expect(request.requestDigest).toBe("60506d7e46f9de7139fa04d4e8e07ff3f363d678a82dd116a5fc5e6baf085614");
  const entry = { installationId: request.installationId, hostId: "host", publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(), fingerprint: nativeAdmissionFingerprint(publicKey) };
  const admission = new NativeAdmission("host", [entry], () => 1000);
  const challenge = { ...request, nonce: "b".repeat(64), expiresAt: 2000 };
  // Fixed vector must use the exact nonce signed by the Rust fixture.
  (admission as unknown as { pending: Map<string, typeof challenge> }).pending.set(challenge.nonce, challenge);
  const proof = { challenge, signature: "lh0won5CPeE4qugKK48x17KvxE43EAIu_xjhXmqtb6HQmVDP4zMDK8L6f9HDDFgnw6lPRXFJqixlxaQOJp44AA" };
  expect(() => admission.consume({ ...request, requestDigest: nativeAdmissionDigest('{"text":"İstanbul için farklı"}') }, proof)).toThrow();
  admission.consume(request, proof);
  expect(() => admission.consume(request, proof)).toThrow();
});
