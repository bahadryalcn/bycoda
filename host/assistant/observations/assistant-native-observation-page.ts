import { z } from "zod";
import {
  nativeAdmissionDigest,
  type NativeAdmissionOwner,
  type NativeAdmissionProof,
} from "../native/assistant-native-admission";
import type { NativeLibraryProof } from "../native/assistant-native-library-proof";

const identity = z.string().min(1).max(200);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const counter = z.number().int().nonnegative().safe();
const schema = z.strictObject({
  environmentId: identity,
  threadId: identity,
  issuer: identity,
  relayId: identity,
  requestId: identity,
  operationHash: hash,
  projectionRevision: counter,
  policyDigest: hash,
  privacyRevision: counter,
  source: z.enum(["note", "server", "native-session"]),
  projectId: identity.optional(),
  targetCwd: z.string().min(1).max(4096).optional(),
  page: z.strictObject({
    fingerprint: hash,
    offset: counter.max(2048),
    nextOffset: counter.max(2048),
    total: counter.max(2048),
    watermark: counter,
    sourceGap: z.boolean(),
    entries: z.array(z.strictObject({ sourceId: identity, revision: counter })).max(8),
  }),
});
export type NativeObservationCapture = NativeLibraryProof & {
  projectionRevision: number;
  policyDigest: string;
  privacyRevision: number;
};

/** Verify while the caller holds the original Native source permit. No client-selected installation. */
export async function verifyNativeObservationPage(
  admission: NativeAdmissionOwner,
  captured: NativeObservationCapture,
  expected: {
    relayId: string;
    requestId: string;
    operationHash: string;
    source: "note" | "server" | "native-session";
    offset: number;
    projectId?: string;
    targetCwd?: string;
  },
  envelope: unknown,
  valid: () => boolean,
) {
  if (!valid()) throw new Error("Native observation source changed.");
  const outer = z
    .strictObject({ operationJson: z.string().max(32000), proof: z.unknown() })
    .parse(envelope);
  const receipt = schema.parse(JSON.parse(outer.operationJson));
  for (const key of [
    "environmentId",
    "threadId",
    "issuer",
    "projectionRevision",
    "policyDigest",
    "privacyRevision",
  ] as const)
    if (receipt[key] !== captured[key])
      throw new Error("Native observation baseline source changed.");
  for (const key of ["relayId", "requestId", "operationHash", "source"] as const)
    if (receipt[key] !== expected[key])
      throw new Error("Native observation baseline request changed.");
  if (
    receipt.projectId !== expected.projectId ||
    receipt.targetCwd !== expected.targetCwd ||
    (expected.source === "native-session" && (!expected.projectId || !expected.targetCwd))
  )
    throw new Error("Native observation project identity changed.");
  if (receipt.page.offset !== expected.offset)
    throw new Error("Native observation baseline page changed.");
  if (
    receipt.page.nextOffset !== receipt.page.offset + receipt.page.entries.length ||
    receipt.page.nextOffset > receipt.page.total ||
    (receipt.page.offset < receipt.page.total && receipt.page.nextOffset === receipt.page.offset) ||
    (receipt.source === "server" && receipt.page.watermark === undefined)
  )
    throw new Error("Native observation baseline progression changed.");
  const proof = outer.proof as NativeAdmissionProof;
  if (proof?.challenge?.installationId !== captured.installationId)
    throw new Error("Native observation installation changed.");
  const revision = await admission.consume(
    {
      installationId: captured.installationId,
      hostId: captured.environmentId,
      action: "assistant.observations.baseline",
      requestDigest: nativeAdmissionDigest(outer.operationJson),
    },
    proof,
  );
  if (!valid() || revision !== captured.registryRevision)
    throw new Error("Native observation trust changed.");
  return receipt.page;
}

const completionSchema = schema.omit({ page: true }).extend({
  source: z.enum(["note", "server", "native-session"]),
  fingerprint: hash,
  watermark: counter,
  completed: z.literal(true),
});
export async function verifyNativeObservationCompletion(
  admission: NativeAdmissionOwner,
  captured: NativeObservationCapture,
  expected: {
    relayId: string;
    requestId: string;
    operationHash: string;
    source: "note" | "server" | "native-session";
    fingerprint: string;
    watermark: number;
    projectId?: string;
    targetCwd?: string;
  },
  envelope: unknown,
  valid: () => boolean,
) {
  if (!valid()) throw new Error("Native observation source changed.");
  const outer = z
    .strictObject({ operationJson: z.string().max(32000), proof: z.unknown() })
    .parse(envelope);
  const receipt = completionSchema.parse(JSON.parse(outer.operationJson));
  for (const key of [
    "environmentId",
    "threadId",
    "issuer",
    "projectionRevision",
    "policyDigest",
    "privacyRevision",
  ] as const)
    if (receipt[key] !== captured[key])
      throw new Error("Native observation completion source changed.");
  for (const key of [
    "relayId",
    "requestId",
    "operationHash",
    "source",
    "fingerprint",
    "watermark",
  ] as const)
    if (receipt[key] !== expected[key])
      throw new Error("Native observation completion identity changed.");
  if (
    receipt.projectId !== expected.projectId ||
    receipt.targetCwd !== expected.targetCwd ||
    (expected.source === "native-session" && (!expected.projectId || !expected.targetCwd))
  )
    throw new Error("Native observation project identity changed.");
  const proof = outer.proof as NativeAdmissionProof;
  if (proof?.challenge?.installationId !== captured.installationId)
    throw new Error("Native observation installation changed.");
  const revision = await admission.consume(
    {
      installationId: captured.installationId,
      hostId: captured.environmentId,
      action: "assistant.observations.complete",
      requestDigest: nativeAdmissionDigest(outer.operationJson),
    },
    proof,
  );
  if (!valid() || revision !== captured.registryRevision)
    throw new Error("Native observation trust changed.");
}
