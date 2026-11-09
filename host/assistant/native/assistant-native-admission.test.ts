import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HostDomainRefusalError } from "../../domains/context";
import {
  loadNativeAdmissionRegistry,
  NativeAdmission,
  NativeAdmissionOwner,
  nativeAdmissionBytes,
  nativeAdmissionDigest,
  nativeAdmissionFingerprint,
} from "./assistant-native-admission";

describe("native admission", () => {
  it("defaults to no trusted installation and rejects owner registry identity mistakes", async () => {
    expect(await loadNativeAdmissionRegistry(undefined, "host")).toEqual([]);
    const pair = generateKeyPairSync("ed25519");
    const entry = {
      installationId: "desktop",
      hostId: "host",
      publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
      fingerprint: nativeAdmissionFingerprint(pair.publicKey),
    };
    const path = join(await mkdtemp(join(tmpdir(), "native-admission-")), "registry.json");
    await writeFile(
      path,
      JSON.stringify({ version: 1, generation: "a".repeat(64), entries: [entry] }),
    );
    expect(await loadNativeAdmissionRegistry(path, "host")).toEqual([entry]);
    await expect(loadNativeAdmissionRegistry(path, "other-host")).rejects.toThrow();
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        generation: "a".repeat(64),
        entries: [{ ...entry, fingerprint: "0".repeat(64) }],
      }),
    );
    await expect(loadNativeAdmissionRegistry(path, "host")).rejects.toThrow();
    expect(() =>
      new NativeAdmission("host", []).challenge({
        installationId: "desktop",
        hostId: "host",
        action: "issue",
        requestDigest: "0".repeat(64),
      }),
    ).toThrow();
  });

  it("refuses an unenrolled installation with a stable not-sent code", () => {
    const request = {
      installationId: "desktop",
      hostId: "host",
      action: "assistant.visibility.reopen",
      requestDigest: "0".repeat(64),
    };
    let refusal: unknown;
    try {
      new NativeAdmission("host", []).challenge(request);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(HostDomainRefusalError);
    expect(refusal).toMatchObject({ code: "NATIVE_ADMISSION_UNENROLLED", delivery: "not-sent" });
    expect((refusal as Error).message).toMatch(/^NATIVE_ADMISSION_UNENROLLED: /);
    // A wrong Host identity stays an ordinary refusal, not the unenrolled state.
    expect(() =>
      new NativeAdmission("host", []).challenge({ ...request, hostId: "other" }),
    ).toThrow("Native admission unavailable.");
  });

  it("binds proof to Host, installation, operation, bytes, deadline and one use", () => {
    let now = 1000;
    const pair = generateKeyPairSync("ed25519");
    const entry = {
      installationId: "desktop",
      hostId: "host",
      publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
      fingerprint: nativeAdmissionFingerprint(pair.publicKey),
    };
    const admission = new NativeAdmission("host", [entry], () => now);
    const request = {
      installationId: "desktop",
      hostId: "host",
      action: "assistant.issue",
      requestDigest: nativeAdmissionDigest('{"project":"one"}'),
    };
    const challenge = admission.challenge(request);
    const proof = {
      challenge,
      signature: sign(null, nativeAdmissionBytes(challenge), pair.privateKey).toString("base64url"),
    };
    expect(() => admission.consume({ ...request, action: "assistant.call" }, proof)).toThrow();
    expect(() =>
      admission.consume(
        { ...request, requestDigest: nativeAdmissionDigest('{"project":"two"}') },
        proof,
      ),
    ).toThrow();
    expect(() => admission.consume({ ...request, hostId: "other" }, proof)).toThrow();
    expect(() =>
      admission.consume(request, {
        ...proof,
        challenge: { ...challenge, expiresAt: challenge.expiresAt + 1 },
      }),
    ).toThrow();
    const foreign = generateKeyPairSync("ed25519");
    expect(() =>
      admission.consume(request, {
        ...proof,
        signature: sign(null, nativeAdmissionBytes(challenge), foreign.privateKey).toString(
          "base64url",
        ),
      }),
    ).toThrow();
    expect(() => admission.consume(request, { ...proof, signature: "A".repeat(86) })).toThrow();
    admission.consume(request, proof);
    expect(() => admission.consume(request, proof)).toThrow();
    const expired = admission.challenge(request);
    expect(() =>
      new NativeAdmission("host", [entry], () => now).consume(request, {
        challenge: expired,
        signature: sign(null, nativeAdmissionBytes(expired), pair.privateKey).toString("base64url"),
      }),
    ).toThrow();
    now = expired.expiresAt;
    expect(() =>
      admission.consume(request, {
        challenge: expired,
        signature: sign(null, nativeAdmissionBytes(expired), pair.privateKey).toString("base64url"),
      }),
    ).toThrow();
  });
});

it("retires pending and consumed authority after owner registry changes", async () => {
  const pair = generateKeyPairSync("ed25519");
  const entry = {
    installationId: "desktop",
    hostId: "host",
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    fingerprint: nativeAdmissionFingerprint(pair.publicKey),
  };
  const path = join(await mkdtemp(join(tmpdir(), "native-reload-")), "registry.json");
  const registry = (generation: string, entries: unknown[]) =>
    JSON.stringify({ version: 1, generation: generation.repeat(64), entries });
  await writeFile(path, registry("a", [entry]));
  const owner = new NativeAdmissionOwner(path, "host", false, () => 1000);
  const request = {
    installationId: "desktop",
    hostId: "host",
    action: "assistant.issue",
    requestDigest: nativeAdmissionDigest("{}"),
  };
  const first = await owner.challenge(request);
  const proof = (challenge: typeof first) => ({
    challenge,
    signature: sign(null, nativeAdmissionBytes(challenge), pair.privateKey).toString("base64url"),
  });
  const revision = await owner.consume(request, proof(first));
  const pending = await owner.challenge(request);
  await writeFile(path, registry("b", []));
  expect(await owner.current("desktop", revision)).toBe(false);
  await expect(owner.consume(request, proof(pending))).rejects.toThrow();
  await writeFile(path, registry("c", [entry]));
  expect(await owner.current("desktop", revision)).toBe(false);
  await expect(owner.consume(request, proof(pending))).rejects.toThrow();
  await writeFile(path, "corrupt");
  expect(await owner.current("desktop", revision)).toBe(false);
});
