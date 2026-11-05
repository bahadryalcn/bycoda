import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  nativeAdmissionDigest,
  type NativeAdmissionOwner,
  type NativeAdmissionProof,
} from "./assistant-native-admission";
const id = z.string().min(1).max(300);
const schema = z.strictObject({
  environmentId: id,
  threadId: id,
  issuer: id,
  relayId: id,
  projectId: id,
  targetCwd: z.string().min(1).max(4096),
  operationId: id,
  action: id,
  originalInput: z.record(z.string(), z.unknown()),
  result: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("unknown") }),
    z.strictObject({ state: z.literal("ownerAccepted") }),
    z.strictObject({ state: z.literal("accepted"), result: z.unknown() }),
  ]),
});
export type WorkspaceReceiptExpected = Omit<
  z.infer<typeof schema>,
  "issuer" | "relayId" | "result"
>;
export async function verifyWorkspaceReceipt(
  admission: NativeAdmissionOwner,
  captured: { relayId: string; envelope: unknown },
  expected: WorkspaceReceiptExpected,
  authorized: () => Promise<boolean>,
  source?: { installationId: string; registryRevision: string },
) {
  const envelope = z
    .strictObject({ operationJson: z.string().max(64000), proof: z.unknown() })
    .parse(captured.envelope);
  const value = schema.parse(JSON.parse(envelope.operationJson));
  for (const key of [
    "environmentId",
    "threadId",
    "projectId",
    "targetCwd",
    "operationId",
    "action",
  ] as const)
    if (value[key] !== expected[key]) throw new Error("Workspace receipt source changed.");
  if (
    value.relayId !== captured.relayId ||
    !isDeepStrictEqual(value.originalInput, expected.originalInput) ||
    !(await authorized())
  )
    throw new Error("Workspace receipt identity changed.");
  const proof = envelope.proof as NativeAdmissionProof;
  const installationId = id.parse(proof?.challenge?.installationId);
  if (source && installationId !== source.installationId)
    throw new Error("Workspace receipt installation changed.");
  const revision = await admission.consume(
    {
      installationId,
      hostId: expected.environmentId,
      action: "assistant.workspace.receipt",
      requestDigest: nativeAdmissionDigest(envelope.operationJson),
    },
    proof,
  );
  if (source && revision !== source.registryRevision)
    throw new Error("Workspace receipt registry changed.");
  if (!(await authorized()) || !(await admission.current(installationId, revision)))
    throw new Error("Workspace receipt authority changed.");
  return value.result;
}
