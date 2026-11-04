import { z } from "zod";
import { nativeAdmissionDigest, type NativeAdmissionOwner, type NativeAdmissionProof } from "./assistant-native-admission";
const identity = z.string().min(1).max(200);
const receiptSchema = z.strictObject({ environmentId: identity, threadId: identity, issuer: identity, relayId: identity, notificationId: identity, kind: z.enum(["task.done", "task.needsInput"]), requestId: identity, operationHash: z.string().regex(/^[a-f0-9]{64}$/), state: z.enum(["accepted", "suppressed", "unknown"]), permission: z.enum(["prompt", "granted", "denied", "unsupported"]) });
export type AssistantNotificationReceiptExpected = Omit<z.infer<typeof receiptSchema>, "issuer" | "state" | "permission" | "relayId">;
/** Called while the caller retains its project/policy disclosure lease. It performs
 * only registry reads and one-shot proof consumption; never acquires another lease. */
export async function verifyAssistantNotificationReceipt(admission: NativeAdmissionOwner, result: { relayId: string; envelope: unknown }, expected: AssistantNotificationReceiptExpected, authorized: () => Promise<boolean>) {
  const value = z.strictObject({ operationJson: z.string().max(32000), proof: z.unknown() }).parse(result.envelope);
  const receipt = receiptSchema.parse(JSON.parse(value.operationJson));
  for (const key of ["environmentId", "threadId", "notificationId", "kind", "requestId", "operationHash"] as const)
    if (receipt[key] !== expected[key]) throw new Error("Assistant notification receipt identity changed.");
  if (receipt.relayId !== result.relayId || !(await authorized())) throw new Error("Assistant notification authority changed.");
  const proof = value.proof as NativeAdmissionProof;
  const installationId = identity.parse(proof?.challenge?.installationId);
  const revision = await admission.consume({ installationId, hostId: expected.environmentId, action: "assistant.notification.receipt", requestDigest: nativeAdmissionDigest(value.operationJson) }, proof);
  if (!(await authorized()) || !(await admission.current(installationId, revision))) throw new Error("Assistant notification native authority changed.");
  return { state: receipt.state, permission: receipt.permission };
}
