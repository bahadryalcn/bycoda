import { z } from "zod";
import {
  NativeAdmissionOwner,
  nativeAdmissionDigest,
  type NativeAdmissionProof,
} from "../native/assistant-native-admission";
import { RoomAttestationSigner, type RoomAttestation } from "./assistant-room-attestation";

const identity = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const challengeSchema = z.strictObject({
  installationId: identity,
  hostId: identity,
  action: z
    .string()
    .regex(
      /^assistant\.(delegation\.(origin|attest|issue|issue\.status|challenge|call|revoke)|visibility\.(reopen|capture)|account\.capture|observations\.(ingest|baseline|complete)|voice\.generation\.(retired|status|source)|notification\.receipt|workspace\.receipt)$/,
    ),
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
const envelopeSchema = z.strictObject({
  operationJson: z.string().min(2).max(32768),
  proof: z.unknown(),
});
const originSchema = z.strictObject({
  threadId: identity,
  targetEnvironmentId: identity,
  projectId: identity,
  publicKey: z.string().min(1).max(1000),
});

/** Source-side adapter. Target effects require a separate revocation-safe owner. */
export function createRoomNativeSourceAdapter(ports: {
  environmentId: string;
  admission: NativeAdmissionOwner;
  signer: RoomAttestationSigner;
  thread(id: string): Promise<{ id: string } | null>;
}) {
  return async (
    action:
      | "publicKey"
      | "origin"
      | "nativeChallenge"
      | "attest"
      | "issue"
      | "issue.status"
      | "challenge"
      | "call"
      | "revoke",
    input: Record<string, unknown>,
    authorized: () => Promise<boolean>,
  ): Promise<unknown> => {
    if (!(await authorized())) throw new Error("Native source authority unavailable.");
    if (action === "publicKey")
      return { environmentId: ports.environmentId, publicKey: await ports.signer.publicKey() };
    if (action === "nativeChallenge")
      return ports.admission.challenge(challengeSchema.parse(input));
    if (action !== "origin" && action !== "attest")
      throw new Error("Room target delegation owner is unavailable.");
    const envelope = envelopeSchema.parse(input);
    const candidate = envelope.proof as NativeAdmissionProof;
    const installationId = identity.parse(candidate?.challenge?.installationId);
    const request = {
      installationId,
      hostId: ports.environmentId,
      action: `assistant.delegation.${action}`,
      requestDigest: nativeAdmissionDigest(envelope.operationJson),
    };
    const revision = await ports.admission.consume(request, candidate);
    const stillAuthorized = async () =>
      (await authorized()) && (await ports.admission.current(installationId, revision));
    if (!(await stillAuthorized())) throw new Error("Native source admission revoked.");
    let operation: unknown;
    try {
      operation = JSON.parse(envelope.operationJson);
    } catch {
      throw new Error("Invalid approved native operation.");
    }
    return ports.admission.withEffect(installationId, revision, async (lease) => {
      const current = async () => lease.valid() && (await authorized());
      if (!(await current())) throw new Error("Native source admission revoked.");
      if (action === "origin") {
        const source = originSchema.parse(operation);
        if (
          source.targetEnvironmentId === ports.environmentId ||
          source.publicKey !== (await ports.signer.publicKey()) ||
          (await ports.thread(source.threadId))?.id !== source.threadId ||
          !(await current())
        )
          throw new Error("Original Room source unavailable.");
        return {
          environmentId: ports.environmentId,
          threadId: source.threadId,
          publicKey: source.publicKey,
          originNativeRevision: revision,
        };
      }
      if (!operation || typeof operation !== "object" || Array.isArray(operation))
        throw new Error("Invalid Room attestation.");
      if ((operation as RoomAttestation).originNativeRevision !== revision)
        throw new Error("Original native Room admission changed; request a new delegation.");
      const signature = await ports.signer.attest(operation as RoomAttestation, current);
      if (!(await current())) throw new Error("Native source admission revoked.");
      return { signature };
    });
  };
}
