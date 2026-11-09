import { randomUUID } from "node:crypto";
import {
  nativeAdmissionDigest,
  type NativeAdmissionOwner,
  type NativeAdmissionProof,
} from "./assistant-native-admission";
import { AssistantVisibilityFence } from "./assistant-visibility-fence";
import { z } from "zod";

const identity = z.string().min(1).max(200);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const path = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes("\0"));
const counter = z.number().int().nonnegative().safe();
const qualifiedSnapshot = z.strictObject({
  schemaVersion: z.literal(1),
  policyDigest: hash,
  issuer: identity,
  privacyRevision: counter,
  visibleProjects: z.array(z.strictObject({ cwd: path })).max(1000),
});
const captureSchema = z.strictObject({
  environmentId: identity,
  threadId: identity,
  issuer: identity,
  relayId: identity,
  projectId: identity,
  targetCwd: path,
  action: identity,
  requestId: identity,
  operationHash: hash,
  projectionRevision: counter,
  policyDigest: hash,
  privacyRevision: counter,
  visibleCwds: z.array(path).max(1000),
  sequence: counter,
});
const accountCaptureSchema = z.strictObject({
  environmentId: identity,
  threadId: identity,
  issuer: identity,
  relayId: identity,
  requestId: identity,
  operationHash: hash,
  projectionRevision: counter,
  policyDigest: hash,
  privacyRevision: counter,
  sequence: counter,
});
export type ExpectedVisibilityCapture = Pick<
  z.infer<typeof captureSchema>,
  | "environmentId"
  | "threadId"
  | "projectId"
  | "targetCwd"
  | "action"
  | "requestId"
  | "operationHash"
  | "relayId"
>;
export type VisibilityIdentity = {
  installationId: string;
  registryRevision: string;
  visibilityEpoch: number;
  policyGeneration: string;
};
export type ExpectedAccountCapture = Pick<
  z.infer<typeof accountCaptureSchema>,
  "environmentId" | "threadId" | "relayId" | "requestId" | "operationHash"
>;

/** Native signer supplies exact bytes only after the durable projection commit and issuer checks. */
export class AssistantVisibilityAdmission {
  private policy?: {
    epoch: number;
    revision: number;
    digest: string;
    installationId: string;
    registryRevision: string;
    issuer: string;
    privacyRevision: number;
    generation: string;
  };
  constructor(
    private readonly hostId: string,
    private readonly native: NativeAdmissionOwner,
    private readonly fence: AssistantVisibilityFence,
  ) {}

  async reopen(
    input: Record<string, unknown>,
    authorized: () => Promise<boolean>,
  ): Promise<{ epoch: number }> {
    if (
      Object.keys(input).sort().join(",") !== "operationJson,proof" ||
      typeof input.operationJson !== "string" ||
      Buffer.byteLength(input.operationJson, "utf8") > 1024 * 1024 ||
      !input.proof ||
      typeof input.proof !== "object"
    )
      throw new Error("Invalid Room visibility proof.");
    const operation: unknown = JSON.parse(input.operationJson);
    if (!operation || typeof operation !== "object" || Array.isArray(operation))
      throw new Error("Invalid Room visibility operation.");
    const value = operation as Record<string, unknown>;
    const projection = value.projection as Record<string, unknown> | null;
    if (
      Object.keys(value).sort().join(",") !== "epoch,projection" ||
      !Number.isSafeInteger(value.epoch) ||
      (value.epoch as number) < 0 ||
      !projection ||
      typeof projection !== "object" ||
      Array.isArray(projection) ||
      Object.keys(projection).sort().join(",") !== "actor,operationId,revision,snapshot,version" ||
      projection.version !== 1 ||
      !Number.isSafeInteger(projection.revision) ||
      (projection.revision as number) < 1 ||
      typeof projection.operationId !== "string" ||
      !projection.operationId ||
      projection.operationId.length > 200 ||
      typeof projection.actor !== "string" ||
      !projection.actor ||
      projection.actor.length > 200 ||
      !projection.snapshot ||
      typeof projection.snapshot !== "object" ||
      Array.isArray(projection.snapshot)
    )
      throw new Error("Invalid committed Room visibility projection.");
    const proof = input.proof as NativeAdmissionProof;
    const snapshot = qualifiedSnapshot.parse(projection.snapshot);
    if (snapshot.issuer !== projection.actor) throw new Error("Privacy projection issuer changed.");
    const installationId = proof?.challenge?.installationId;
    if (typeof installationId !== "string" || !(await authorized()))
      throw new Error("Room visibility authority unavailable.");
    const request = {
      installationId,
      hostId: this.hostId,
      action: "assistant.visibility.reopen",
      requestDigest: nativeAdmissionDigest(input.operationJson),
    };
    const revision = await this.native.consume(request, proof);
    if (!(await authorized()) || !(await this.native.current(installationId, revision)))
      throw new Error("Room visibility authority revoked.");
    const epoch = value.epoch as number;
    this.fence.reopen(epoch);
    this.policy = {
      epoch,
      revision: projection.revision as number,
      digest: snapshot.policyDigest,
      installationId,
      registryRevision: revision,
      issuer: snapshot.issuer,
      privacyRevision: snapshot.privacyRevision,
      generation: randomUUID(),
    };
    return { epoch };
  }

  /** Body must retain the canonical effect promise, never an observer timeout. */
  currentIdentity(identity: VisibilityIdentity): boolean {
    const policy = this.policy;
    return (
      !!policy &&
      policy.epoch === this.fence.currentEpoch() &&
      policy.epoch === identity.visibilityEpoch &&
      policy.generation === identity.policyGeneration &&
      policy.installationId === identity.installationId &&
      policy.registryRevision === identity.registryRevision
    );
  }
  async withAccountCapture<T>(
    envelope: unknown,
    expected: {
      environmentId: string;
      threadId: string;
      relayId: string;
      requestId: string;
      operationHash: string;
    },
    authorized: () => Promise<boolean>,
    body: (valid: () => boolean, identity: VisibilityIdentity & { issuer: string }) => Promise<T>,
  ): Promise<T> {
    const policy = this.policy;
    const currentPolicy = () =>
      !!policy && this.policy === policy && this.fence.currentEpoch() === policy.epoch;
    const input = z
      .strictObject({ operationJson: z.string().max(128000), proof: z.unknown() })
      .parse(envelope);
    const capture = accountCaptureSchema.parse(JSON.parse(input.operationJson));
    for (const key of [
      "environmentId",
      "threadId",
      "relayId",
      "requestId",
      "operationHash",
    ] as const)
      if (capture[key] !== expected[key]) throw new Error("Native account source changed.");
    if (
      capture.environmentId !== this.hostId ||
      !capture.sequence ||
      !currentPolicy() ||
      capture.projectionRevision !== policy!.revision ||
      capture.policyDigest !== policy!.digest ||
      capture.privacyRevision !== policy!.privacyRevision ||
      !(await authorized())
    )
      throw new Error("Native account qualification unavailable.");
    const proof = input.proof as NativeAdmissionProof;
    const installationId = identity.parse(proof?.challenge?.installationId);
    const revision = await this.native.consume(
      {
        installationId,
        hostId: this.hostId,
        action: "assistant.account.capture",
        requestDigest: nativeAdmissionDigest(input.operationJson),
      },
      proof,
    );
    if (
      installationId !== policy!.installationId ||
      revision !== policy!.registryRevision ||
      capture.issuer !== policy!.issuer
    )
      throw new Error("Native account issuer or trust changed.");
    return this.native.withEffect(installationId, revision, async (registry) => {
      if (!currentPolicy() || !(await authorized()))
        throw new Error("Native account scope revoked.");
      const source = {
        issuer: capture.issuer,
        environmentId: this.hostId,
        threadId: capture.threadId,
      };
      this.fence.register(source, capture.sequence, [], policy!.epoch);
      const permit = this.fence.acquireSource(source);
      try {
        const valid = () => registry.valid() && currentPolicy() && permit.valid();
        if (!valid()) throw new Error("Native account scope revoked.");
        const result = await body(valid, {
          installationId,
          registryRevision: revision,
          visibilityEpoch: policy!.epoch,
          policyGeneration: policy!.generation,
          issuer: capture.issuer,
        });
        if (!valid() || !(await authorized())) throw new Error("Native account scope revoked.");
        return result;
      } finally {
        permit.release();
      }
    });
  }
  async withCapture<T>(
    envelope: unknown,
    expected: ExpectedVisibilityCapture,
    authorized: () => Promise<boolean>,
    body: (valid: () => boolean, identity: VisibilityIdentity) => Promise<T>,
  ): Promise<T> {
    return this.withCaptures([{ envelope, expected }], authorized, body);
  }

  /** Capture every target before acquiring the one shared native registry lease. */
  async withCaptures<T>(
    inputs: Array<{ envelope: unknown; expected: ExpectedVisibilityCapture }>,
    authorized: () => Promise<boolean>,
    body: (valid: () => boolean, identity: VisibilityIdentity & { issuer: string }) => Promise<T>,
    accountInputs: Array<{ envelope: unknown; expected: ExpectedAccountCapture }> = [],
  ): Promise<T> {
    if ((!inputs.length && !accountInputs.length) || inputs.length + accountInputs.length > 1000)
      throw new Error("Invalid native source scope count.");
    const policy = this.policy;
    const captures: Array<{
      value: z.infer<typeof captureSchema>;
      installationId: string;
      revision: string;
    }> = [];
    const accounts: Array<{
      value: z.infer<typeof accountCaptureSchema>;
      installationId: string;
      revision: string;
    }> = [];
    const currentPolicy = () =>
      !!policy && this.policy === policy && this.fence.currentEpoch() === policy.epoch;
    for (const { envelope, expected } of inputs) {
      const input = z
        .strictObject({ operationJson: z.string().max(128000), proof: z.unknown() })
        .parse(envelope);
      const capture = captureSchema.parse(JSON.parse(input.operationJson));
      for (const key of [
        "environmentId",
        "threadId",
        "projectId",
        "targetCwd",
        "action",
        "requestId",
        "operationHash",
        "relayId",
      ] as const)
        if (capture[key] !== expected[key]) throw new Error("Native project scope changed.");
      if (
        capture.environmentId !== this.hostId ||
        !capture.sequence ||
        !capture.visibleCwds.includes(expected.targetCwd)
      )
        throw new Error("Project scope unavailable.");
      if (
        !currentPolicy() ||
        capture.projectionRevision !== policy!.revision ||
        capture.policyDigest !== policy!.digest ||
        capture.privacyRevision !== policy!.privacyRevision ||
        !(await authorized())
      )
        throw new Error("Native project qualification unavailable.");
      const proof = input.proof as NativeAdmissionProof;
      const installationId = identity.parse(proof?.challenge?.installationId);
      const revision = await this.native.consume(
        {
          installationId,
          hostId: this.hostId,
          action: "assistant.visibility.capture",
          requestDigest: nativeAdmissionDigest(input.operationJson),
        },
        proof,
      );
      if (
        installationId !== policy!.installationId ||
        revision !== policy!.registryRevision ||
        capture.issuer !== policy!.issuer
      )
        throw new Error("Native project issuer or trust changed.");
      captures.push({ value: capture, installationId, revision });
    }
    for (const { envelope, expected } of accountInputs) {
      const input = z
        .strictObject({ operationJson: z.string().max(128000), proof: z.unknown() })
        .parse(envelope);
      const capture = accountCaptureSchema.parse(JSON.parse(input.operationJson));
      for (const key of [
        "environmentId",
        "threadId",
        "relayId",
        "requestId",
        "operationHash",
      ] as const)
        if (capture[key] !== expected[key]) throw new Error("Native account source changed.");
      if (
        capture.environmentId !== this.hostId ||
        !capture.sequence ||
        !currentPolicy() ||
        capture.projectionRevision !== policy!.revision ||
        capture.policyDigest !== policy!.digest ||
        capture.privacyRevision !== policy!.privacyRevision ||
        !(await authorized())
      )
        throw new Error("Native account qualification unavailable.");
      const proof = input.proof as NativeAdmissionProof;
      const installationId = identity.parse(proof?.challenge?.installationId);
      const revision = await this.native.consume(
        {
          installationId,
          hostId: this.hostId,
          action: "assistant.account.capture",
          requestDigest: nativeAdmissionDigest(input.operationJson),
        },
        proof,
      );
      if (
        installationId !== policy!.installationId ||
        revision !== policy!.registryRevision ||
        capture.issuer !== policy!.issuer
      )
        throw new Error("Native account issuer or trust changed.");
      accounts.push({ value: capture, installationId, revision });
    }
    const first = captures[0] ?? accounts[0];
    if (
      [...captures, ...accounts].some(
        (item) =>
          item.installationId !== first.installationId ||
          item.revision !== first.revision ||
          item.value.issuer !== first.value.issuer,
      )
    )
      throw new Error("Native project scopes do not share one trusted native issuer.");
    if (!currentPolicy() || !(await authorized())) throw new Error("Native project scope revoked.");
    return this.native.withEffect(first.installationId, first.revision, async (registry) => {
      if (!currentPolicy() || !(await authorized()))
        throw new Error("Native project scope revoked.");
      const permits: Array<{ valid(): boolean; release(): void }> = [];
      try {
        const threads = new Map<string, { projects: typeof captures; accounts: typeof accounts }>();
        for (const capture of captures) {
          const group = threads.get(capture.value.threadId) ?? { projects: [], accounts: [] };
          group.projects.push(capture);
          threads.set(capture.value.threadId, group);
        }
        for (const account of accounts) {
          const group = threads.get(account.value.threadId) ?? { projects: [], accounts: [] };
          group.accounts.push(account);
          threads.set(account.value.threadId, group);
        }
        for (const [threadId, group] of threads) {
          const source = { issuer: first.value.issuer, environmentId: this.hostId, threadId };
          const targets = group.projects.map(({ value }) => ({
            projectId: value.projectId,
            cwd: value.targetCwd,
          }));
          this.fence.register(
            source,
            Math.max(...[...group.projects, ...group.accounts].map((item) => item.value.sequence)),
            targets,
            policy!.epoch,
          );
          for (const target of targets) permits.push(this.fence.acquire(source, target));
          if (group.accounts.length) permits.push(this.fence.acquireSource(source));
        }
        const valid = () =>
          registry.valid() && currentPolicy() && permits.every((permit) => permit.valid());
        if (!valid()) throw new Error("Native project scope revoked.");
        const result = await body(valid, {
          installationId: first.installationId,
          registryRevision: first.revision,
          visibilityEpoch: policy!.epoch,
          policyGeneration: policy!.generation,
          issuer: first.value.issuer,
        });
        if (!valid() || !(await authorized()))
          throw new Error("Native project scope revoked; inspect its original receipt.");
        return result;
      } finally {
        for (const permit of permits) permit.release();
      }
    });
  }
}
