import { z } from "zod";
import { nativeAdmissionDigest, type NativeAdmissionOwner, type NativeAdmissionProof } from "../native/assistant-native-admission";

const identity = z.string().min(1).max(200);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const operation = z.strictObject({ environmentId: identity, threadId: identity, issuer: identity, relayId: identity, generationKey: identity, requestId: identity, operationHash: hash });
const envelope = z.strictObject({ operationJson: z.string().max(32000), proof: z.unknown() });
export type VoiceRetirementExpected = Omit<z.infer<typeof operation>, "issuer" | "relayId">;

/** Gather every closure before the shared native registry lease. */
export async function withVoiceGenerationsRetired<T>(ports: {
  admission: NativeAdmissionOwner;
  relay(expected: VoiceRetirementExpected, authorized: () => Promise<boolean>): Promise<{ relayId: string; envelope: unknown }>;
}, expected: VoiceRetirementExpected[], authorized: () => Promise<boolean>, effect: (valid: () => boolean) => Promise<T>): Promise<T> {
  if (!expected.length || expected.length > 1000 || !(await authorized())) throw new Error("Voice generation retirement authority unavailable.");
  const targets = expected.map(item => operation.omit({ issuer: true, relayId: true }).parse(item));
  const captured: Array<{ item: VoiceRetirementExpected; result: { relayId: string; envelope: unknown } }> = [];
  for (const item of targets) captured.push({ item, result: await ports.relay(item, authorized) });
  const consumed: Array<{ installationId: string; revision: string }> = [];
  for (const { item, result } of captured) {
    const value = envelope.parse(result.envelope);
    const receipt = operation.parse(JSON.parse(value.operationJson));
    for (const key of ["environmentId", "threadId", "generationKey", "requestId", "operationHash"] as const)
      if (receipt[key] !== item[key]) throw new Error("Voice generation retirement identity changed.");
    if (receipt.relayId !== result.relayId) throw new Error("Voice generation retirement relay changed.");
    const proof = value.proof as NativeAdmissionProof;
    const installationId = identity.parse(proof?.challenge?.installationId);
    const revision = await ports.admission.consume({ installationId, hostId: item.environmentId, action: "assistant.voice.generation.retired", requestDigest: nativeAdmissionDigest(value.operationJson) }, proof);
    consumed.push({ installationId, revision });
  }
  const first = consumed[0];
  if (consumed.some(value => value.revision !== first.revision) || !(await authorized()))
    throw new Error("Voice generation retirement native trust changed.");
  return ports.admission.withEffect(first.installationId, first.revision, async lease => {
    const valid = () => lease.valid();
    if (!valid() || !(await authorized())) throw new Error("Voice generation retirement authority revoked.");
    const result = await effect(valid);
    if (!valid() || !(await authorized())) throw new Error("Voice generation retirement outcome is uncertain.");
    return result;
  });
}
