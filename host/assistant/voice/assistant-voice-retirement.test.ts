import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { NativeAdmissionOwner, nativeAdmissionBytes, nativeAdmissionDigest, nativeAdmissionFingerprint } from "../native/assistant-native-admission";
import { withVoiceGenerationsRetired, type VoiceRetirementExpected } from "./assistant-voice-retirement";

it("requires exact native-signed generation receipts and gathers all closures before commit", async () => {
  const pair = generateKeyPairSync("ed25519");
  const secondPair = generateKeyPairSync("ed25519");
  const path = join(await mkdtemp(join(tmpdir(), "voice-retirement-")), "registry.json");
  const entry = (installationId: string, key: typeof pair) => ({ installationId, hostId: "host", publicKey: key.publicKey.export({ type: "spki", format: "pem" }).toString(), fingerprint: nativeAdmissionFingerprint(key.publicKey) });
  const entries = [entry("desktop", pair), entry("desktop-two", secondPair)];
  await writeFile(path, JSON.stringify({ version: 1, generation: "a".repeat(64), entries }));
  const admission = new NativeAdmissionOwner(path, "host");
  const one: VoiceRetirementExpected = { environmentId: "host", threadId: "thread", generationKey: "generation", requestId: "request", operationHash: "b".repeat(64) };
  let count = 0;
  let tamper = false;
  const relay = async (item: VoiceRetirementExpected) => {
    const relayId = `relay-${++count}`;
    const operationJson = JSON.stringify({ ...item, generationKey: tamper ? "wrong" : item.generationKey, issuer: "window", relayId });
    const chosen = item.generationKey === "second" ? secondPair : pair;
    const installationId = chosen === pair ? "desktop" : "desktop-two";
    const challenge = await admission.challenge({ installationId, hostId: "host", action: "assistant.voice.generation.retired", requestDigest: nativeAdmissionDigest(operationJson) });
    return { relayId, envelope: { operationJson, proof: { challenge, signature: sign(null, nativeAdmissionBytes(challenge), chosen.privateKey).toString("base64url") } } };
  };
  tamper = true;
  await expect(withVoiceGenerationsRetired({ admission, relay }, [one], async () => true, async () => "leak")).rejects.toThrow("identity changed");
  tamper = false;
  const events: string[] = [];
  const result = await withVoiceGenerationsRetired({ admission, relay: async item => { events.push(item.generationKey); return relay(item); } }, [one, { ...one, generationKey: "second", requestId: "request-2" }], async () => true, async valid => { expect(valid()).toBe(true); events.push("commit"); return "done"; });
  expect(result).toBe("done");
  expect(events).toEqual(["generation", "second", "commit"]);
  const replay = await relay(one);
  const replayPorts = { admission, relay: async () => replay };
  await expect(withVoiceGenerationsRetired(replayPorts, [one], async () => true, async () => "done")).resolves.toBe("done");
  await expect(withVoiceGenerationsRetired(replayPorts, [one], async () => true, async () => "leak")).rejects.toThrow();
  const forged = await relay(one);
  const wrongKey = generateKeyPairSync("ed25519");
  forged.envelope.proof.signature = sign(null, nativeAdmissionBytes(forged.envelope.proof.challenge), wrongKey.privateKey).toString("base64url");
  await expect(withVoiceGenerationsRetired({ admission, relay: async () => forged }, [one], async () => true, async () => "leak")).rejects.toThrow();
  let calls = 0;
  await expect(withVoiceGenerationsRetired({ admission, relay: async item => {
    const value = await relay(item);
    if (++calls === 1) await writeFile(path, JSON.stringify({ version: 1, generation: "b".repeat(64), entries: [entries[1]] }));
    return value;
  } }, [one, { ...one, generationKey: "second", requestId: "other" }], async () => true, async () => "leak")).rejects.toThrow();
});
