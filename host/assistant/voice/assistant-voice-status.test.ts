import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  NativeAdmissionOwner,
  nativeAdmissionBytes,
  nativeAdmissionDigest,
  nativeAdmissionFingerprint,
} from "../native/assistant-native-admission";
import { captureLiveVoiceGeneration, type VoiceStatusExpected } from "./assistant-voice-status";

it("accepts only a fresh Native status for the original runtime, Room, Host and relay", async () => {
  const pair = generateKeyPairSync("ed25519");
  const path = join(await mkdtemp(join(tmpdir(), "voice-status-")), "registry.json");
  const entries = [
    {
      installationId: "native",
      hostId: "host",
      publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
      fingerprint: nativeAdmissionFingerprint(pair.publicKey),
    },
  ];
  await writeFile(path, JSON.stringify({ version: 1, generation: "a".repeat(64), entries }));
  const admission = new NativeAdmissionOwner(path, "host");
  const expected: VoiceStatusExpected = {
    environmentId: "host",
    threadId: "room",
    generationKey: "runtime",
    requestId: "request",
    operationHash: "b".repeat(64),
  };
  const receipt = async (
    overrides: Record<string, string> = {},
    action = "assistant.voice.generation.status",
  ) => {
    const relayId = "relay";
    const operationJson = JSON.stringify({ ...expected, issuer: "window", relayId, ...overrides });
    const challenge = await admission.challenge({
      installationId: "native",
      hostId: "host",
      action,
      requestDigest: nativeAdmissionDigest(operationJson),
    });
    return {
      relayId,
      envelope: {
        operationJson,
        proof: {
          challenge,
          signature: sign(null, nativeAdmissionBytes(challenge), pair.privateKey).toString(
            "base64url",
          ),
        },
      },
    };
  };
  for (const field of [
    "environmentId",
    "threadId",
    "generationKey",
    "requestId",
    "operationHash",
    "relayId",
  ]) {
    const value = field === "operationHash" ? "c".repeat(64) : "different";
    await expect(
      captureLiveVoiceGeneration(
        admission,
        expected,
        await receipt({ [field]: value }),
        async () => true,
      ),
    ).rejects.toThrow(/changed/);
  }
  await expect(
    captureLiveVoiceGeneration(
      admission,
      expected,
      await receipt({}, "assistant.voice.generation.retired"),
      async () => true,
    ),
  ).rejects.toThrow();
  const current = await receipt();
  await expect(
    captureLiveVoiceGeneration(admission, expected, current, async () => true),
  ).resolves.toMatchObject({ installationId: "native", issuer: "window" });
  await expect(
    captureLiveVoiceGeneration(admission, expected, current, async () => true),
  ).rejects.toThrow();
  let checks = 0;
  await expect(
    captureLiveVoiceGeneration(admission, expected, await receipt(), async () => ++checks === 1),
  ).rejects.toThrow("authority changed");
});
