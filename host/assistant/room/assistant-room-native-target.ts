import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import {
  NativeAdmissionOwner,
  nativeAdmissionDigest,
  type NativeAdmissionProof,
} from "../native/assistant-native-admission";
import {
  AssistantRoomDelegation,
  type DelegatedRoomPrincipal,
  type DelegatedRoomAction,
  type DelegationStore,
} from "./assistant-room-delegation";

const envelope = z.strictObject({
  operationJson: z.string().min(2).max(32768),
  proof: z.unknown(),
});
const id = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const delegatedAction = z.enum([
  "sessions.list",
  "sessions.read",
  "tasks.list",
  "tasks.get",
  "tasks.create",
  "tasks.update",
]);
const issue = z.strictObject({
  requestId: id,
  originEnvironmentId: id,
  originNativeRevision: z.string().regex(/^[a-f0-9]{64}$/),
  targetEnvironmentId: id,
  threadId: id,
  projectId: id,
  originPublicKey: z.string().min(1).max(1000),
  actions: z.array(delegatedAction).min(1).max(6),
  expiresAt: z.number().int().nonnegative(),
});
const challenge = z.strictObject({
  grantId: id,
  token: z.string().min(1).max(500),
  action: delegatedAction,
  requestId: id,
  input: z.record(z.string(), z.unknown()),
});
const proofData = z.strictObject({
  version: z.literal(1),
  originEnvironmentId: id,
  originNativeRevision: z.string().regex(/^[a-f0-9]{64}$/),
  targetEnvironmentId: id,
  threadId: id,
  projectId: id,
  grantId: id,
  action: delegatedAction,
  requestId: id,
  scopeHash: z.string().regex(/^[a-f0-9]{64}$/),
  nonce: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.number().int().nonnegative(),
});
const call = z.strictObject({
  grantId: id,
  token: z.string().min(1).max(500),
  originEnvironmentId: id,
  threadId: id,
  projectId: id,
  action: delegatedAction,
  requestId: id,
  input: z.record(z.string(), z.unknown()),
  attestation: proofData,
  signature: z.string().min(1).max(200),
});
const revoke = z.strictObject({ grantId: id });
type Context = {
  origin?: { environmentId: string; threadId: string; publicKey?: string };
  approved: boolean;
  current: () => Promise<boolean>;
  installationId: string;
  revision: string;
  transport: () => Promise<boolean>;
};

/** Exact-reviewed target bridge. No model or paired-device request can create native proof. */
export function createRoomNativeTargetAdapter(ports: {
  environmentId: string;
  admission: NativeAdmissionOwner;
  store: DelegationStore;
  /** Holds the target Host's real Room project privacy lease across admission and effect. */
  withProject<T>(
    projectId: string,
    actions: readonly DelegatedRoomAction[],
    requestId: string,
    operationHash: string,
    expectedNative: { installationId: string; revision: string },
    authorized: () => Promise<boolean>,
    body: (valid: () => boolean, projectCwd: string) => Promise<T>,
  ): Promise<T>;
  execute(
    action: DelegatedRoomAction,
    input: Record<string, unknown>,
    principal: DelegatedRoomPrincipal,
    requestId: string,
    authorized: () => Promise<boolean>,
  ): Promise<unknown>;
}) {
  const contexts = new AsyncLocalStorage<Context>();
  const owner = new AssistantRoomDelegation({
    targetEnvironmentId: ports.environmentId,
    store: ports.store,
    verifyOrigin: async (origin, publicKey) => {
      const context = contexts.getStore();
      return (
        !!context?.origin &&
        context.origin.environmentId === origin.environmentId &&
        context.origin.threadId === origin.threadId &&
        (!context.origin.publicKey || context.origin.publicKey === publicKey) &&
        (await context.current())
      );
    },
    approve: async (operation) => {
      const context = contexts.getStore();
      return context?.approved && (await context.current())
        ? { approved: true, operationHash: operation.operationHash }
        : {};
    },
    execute: async (action, input, principal, requestId, delegationCurrent) => {
      const context = contexts.getStore();
      if (!context) throw new Error("Native target admission unavailable.");
      const authorized = async () => (await context.current()) && (await delegationCurrent());
      if (!(await authorized())) throw new Error("Native target admission revoked.");
      const result = await ports.execute(action, input, principal, requestId, authorized);
      if (!(await authorized())) throw new Error("Native target admission revoked.");
      return result;
    },
  });
  return async (
    action: "issue" | "issue.status" | "challenge" | "call" | "revoke",
    raw: Record<string, unknown>,
    authorized: () => Promise<boolean>,
  ) => {
    const request = envelope.parse(raw),
      proof = request.proof as NativeAdmissionProof;
    const installationId = id.parse(proof?.challenge?.installationId);
    const revision = await ports.admission.consume(
      {
        installationId,
        hostId: ports.environmentId,
        action: `assistant.delegation.${action}`,
        requestDigest: nativeAdmissionDigest(request.operationJson),
      },
      proof,
    );
    const current = async () =>
      (await authorized()) && (await ports.admission.current(installationId, revision));
    if (!(await current())) throw new Error("Native target admission revoked.");
    let input: unknown;
    try {
      input = JSON.parse(request.operationJson);
    } catch {
      throw new Error("Invalid approved native operation.");
    }
    if (action === "issue.status")
      return owner.issueStatus(z.strictObject({ requestId: id }).parse(input).requestId);
    if (action === "issue") {
      const value = issue.parse(input);
      if (value.targetEnvironmentId !== ports.environmentId)
        throw new Error("Target Host changed.");
      return ports.withProject(
        value.projectId,
        value.actions,
        value.requestId,
        nativeAdmissionDigest(request.operationJson),
        { installationId, revision },
        current,
        async (valid, projectCwd) => {
          if (!projectCwd || projectCwd.length > 4096)
            throw new Error("Target project path unavailable.");
          const projectCurrent = async () =>
            valid() && value.expiresAt > Date.now() && (await current()) && valid();
          if (!(await projectCurrent())) throw new Error("Target project admission revoked.");
          const grant = await contexts.run(
            {
              origin: {
                environmentId: value.originEnvironmentId,
                threadId: value.threadId,
                publicKey: value.originPublicKey,
              },
              approved: true,
              current: projectCurrent,
              installationId,
              revision,
              transport: authorized,
            },
            () => owner.issue(value),
          );
          await ports.store.atomic(() =>
            ports.store.saveReceipt(`delegation-binding:${grant.grantId}`, {
              signature: revision,
              state: "completed",
              result: {
                installationId,
                revision,
                targetEnvironmentId: value.targetEnvironmentId,
                projectId: value.projectId,
                projectCwd,
                actions: value.actions,
                expiresAt: value.expiresAt,
              },
            }),
          );
          if (!(await projectCurrent()))
            throw new Error(
              "Target admission revoked; inspect the original grant before retrying.",
            );
          return grant;
        },
      );
    }
    if (action === "revoke") {
      await owner.revoke(revoke.parse(input).grantId);
      return { revoked: true };
    }
    const grantId =
      action === "challenge" ? challenge.parse(input).grantId : call.parse(input).grantId;
    const binding = await ports.store.receipt(`delegation-binding:${grantId}`);
    if (
      !binding ||
      binding.signature !== revision ||
      !binding.result ||
      typeof binding.result !== "object" ||
      (binding.result as { installationId?: unknown }).installationId !== installationId ||
      !(await current())
    )
      throw new Error("Original native grant admission was revoked.");
    if (action === "challenge") return owner.challenge(challenge.parse(input));
    const value = call.parse(input);
    const policy = binding.result as {
      targetEnvironmentId?: unknown;
      projectId?: unknown;
      projectCwd?: unknown;
      actions?: unknown;
      expiresAt?: unknown;
    };
    if (
      policy.targetEnvironmentId !== ports.environmentId ||
      policy.projectId !== value.projectId ||
      typeof policy.projectCwd !== "string" ||
      !policy.projectCwd ||
      !Array.isArray(policy.actions) ||
      !policy.actions.includes(value.action) ||
      typeof policy.expiresAt !== "number" ||
      policy.expiresAt <= Date.now()
    )
      throw new Error("Reviewed target project policy unavailable.");
    return ports.withProject(
      value.projectId,
      [value.action],
      value.requestId,
      nativeAdmissionDigest(request.operationJson),
      { installationId, revision },
      current,
      async (valid, projectCwd) => {
        if (projectCwd !== policy.projectCwd)
          throw new Error("Target project path changed; reconnect explicitly.");
        const projectCurrent = async () =>
          valid() && (policy.expiresAt as number) > Date.now() && (await current()) && valid();
        if (!(await projectCurrent())) throw new Error("Target project admission revoked.");
        return contexts.run(
          {
            origin: { environmentId: value.originEnvironmentId, threadId: value.threadId },
            approved: value.action === "tasks.create" || value.action === "tasks.update",
            current: projectCurrent,
            installationId,
            revision,
            transport: authorized,
          },
          () => owner.call(value),
        );
      },
    );
  };
}
