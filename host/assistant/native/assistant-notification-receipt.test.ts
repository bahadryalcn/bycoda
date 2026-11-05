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
} from "./assistant-native-admission";
import { verifyAssistantNotificationReceipt } from "./assistant-notification-receipt";
it("accepts one exact enrolled native receipt and rejects changed identity or replay", async () => {
  const key = generateKeyPairSync("ed25519");
  const path = join(await mkdtemp(join(tmpdir(), "notification-proof-")), "registry.json");
  await writeFile(
    path,
    JSON.stringify({
      version: 1,
      generation: "a".repeat(64),
      entries: [
        {
          installationId: "desktop",
          hostId: "host",
          publicKey: key.publicKey.export({ type: "spki", format: "pem" }).toString(),
          fingerprint: nativeAdmissionFingerprint(key.publicKey),
        },
      ],
    }),
  );
  const admission = new NativeAdmissionOwner(path, "host");
  const expected = {
    environmentId: "host",
    threadId: "room",
    notificationId: "event",
    kind: "task.done" as const,
    requestId: "request",
    operationHash: "b".repeat(64),
  };
  const operationJson = JSON.stringify({
    ...expected,
    issuer: "window",
    relayId: "relay",
    state: "accepted",
    permission: "granted",
  });
  const challenge = await admission.challenge({
    installationId: "desktop",
    hostId: "host",
    action: "assistant.notification.receipt",
    requestDigest: nativeAdmissionDigest(operationJson),
  });
  const result = {
    relayId: "relay",
    envelope: {
      operationJson,
      proof: {
        challenge,
        signature: sign(null, nativeAdmissionBytes(challenge), key.privateKey).toString(
          "base64url",
        ),
      },
    },
  };
  await expect(
    verifyAssistantNotificationReceipt(
      admission,
      result,
      { ...expected, notificationId: "other" },
      async () => true,
    ),
  ).rejects.toThrow("identity changed");
  await expect(
    verifyAssistantNotificationReceipt(admission, result, expected, async () => true),
  ).resolves.toEqual({ state: "accepted", permission: "granted" });
  await expect(
    verifyAssistantNotificationReceipt(admission, result, expected, async () => true),
  ).rejects.toThrow();
});
