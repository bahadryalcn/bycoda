import { z } from "zod";
import { nativeAdmissionDigest, type NativeAdmissionOwner, type NativeAdmissionProof } from "../native/assistant-native-admission";

const id = z.string().min(1).max(200);
const receiptSchema = z.strictObject({ environmentId: id, threadId: id, issuer: id, relayId: id, generationKey: id, requestId: id, operationHash: z.string().regex(/^[a-f0-9]{64}$/) });
export type VoiceStatusExpected = Omit<z.infer<typeof receiptSchema>, "issuer" | "relayId">;

/** Capture before taking a registry/privacy lease; status alone is not a reservation. */
async function captureVoiceGeneration(admission: NativeAdmissionOwner, expected: VoiceStatusExpected, result: { relayId: string; envelope: unknown }, authorized: () => Promise<boolean>, purpose: "status" | "source") {
  if (!(await authorized())) throw new Error("Voice narration authority changed.");
  const envelope = z.strictObject({ operationJson: z.string().max(32000), proof: z.unknown() }).parse(result.envelope);
  const receipt = receiptSchema.parse(JSON.parse(envelope.operationJson));
  for (const field of ["environmentId", "threadId", "generationKey", "requestId", "operationHash"] as const)
    if (receipt[field] !== expected[field]) throw new Error("Voice narration generation identity changed.");
  if (receipt.relayId !== result.relayId) throw new Error("Voice narration relay changed.");
  const proof = envelope.proof as NativeAdmissionProof;
  const installationId = id.parse(proof?.challenge?.installationId);
  const revision = await admission.consume({ installationId, hostId: expected.environmentId, action: `assistant.voice.generation.${purpose}`, requestDigest: nativeAdmissionDigest(envelope.operationJson) }, proof);
  if (!(await authorized())) throw new Error("Voice narration authority changed.");
  return { installationId, revision, issuer: receipt.issuer };
}
export const captureLiveVoiceGeneration = (admission: NativeAdmissionOwner, expected: VoiceStatusExpected, result: { relayId: string; envelope: unknown }, authorized: () => Promise<boolean>) => captureVoiceGeneration(admission, expected, result, authorized, "status");
export const captureVoiceRuntimeSource = (admission: NativeAdmissionOwner, expected: VoiceStatusExpected, result: { relayId: string; envelope: unknown }, authorized: () => Promise<boolean>) => captureVoiceGeneration(admission, expected, result, authorized, "source");
