import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { HostStore } from "../../store";
import {
  NativeAdmissionOwner,
  nativeAdmissionBytes,
  nativeAdmissionDigest,
  nativeAdmissionFingerprint,
} from "../native/assistant-native-admission";
import { RoomAttestationSigner, type RoomAttestation } from "./assistant-room-attestation";
import {
  roomDelegationScopeHash,
  type DelegatedRoomAction,
  type DelegatedRoomPrincipal,
} from "./assistant-room-delegation";
import { hostRoomDelegationStore } from "./assistant-room-delegation-store";
import { createRoomNativeTargetAdapter } from "./assistant-room-native-target";
it("accepts only reviewed native target scope and signed Room reads; denies unsupported actions and revoked grants", async () => {
  const dir = mkdtempSync(join(tmpdir(), "room-target-")),
    store = new HostStore(join(dir, "host.db"));
  try {
    await store.ready;
    const host = store.environmentId,
      registry = join(dir, "registry.json"),
      native = generateKeyPairSync("ed25519"),
      installationId = "desktop";
    const entry = {
      installationId,
      hostId: host,
      publicKey: native.publicKey.export({ type: "spki", format: "pem" }).toString(),
      fingerprint: nativeAdmissionFingerprint(native.publicKey),
    };
    writeFileSync(
      registry,
      JSON.stringify({ version: 1, generation: "a".repeat(64), entries: [entry] }),
    );
    const admission = new NativeAdmissionOwner(registry, host, false),
      signer = new RoomAttestationSigner(join(dir, "origin-key"), "origin", async (id) => ({ id })),
      execute = vi.fn(
        async (
          _action: DelegatedRoomAction,
          _input: Record<string, unknown>,
          _principal: DelegatedRoomPrincipal,
          _requestId: string,
          _authorized: () => Promise<boolean>,
        ) => ({ items: ["fixture"] }),
      );
    let projectCurrent = true;
    let projectCwd = "/original";
    const target = createRoomNativeTargetAdapter({
      environmentId: host,
      admission,
      store: hostRoomDelegationStore(store),
      withProject: async (_id, _actions, _request, _hash, _native, _authorized, body) =>
        body(() => projectCurrent, projectCwd),
      execute,
    });
    const invoke = async (
      action: "issue" | "issue.status" | "challenge" | "call" | "revoke",
      value: unknown,
    ) => {
      const operationJson = JSON.stringify(value),
        request = {
          installationId,
          hostId: host,
          action: `assistant.delegation.${action}`,
          requestDigest: nativeAdmissionDigest(operationJson),
        },
        challenge = await admission.challenge(request);
      return target(
        action,
        {
          operationJson,
          proof: {
            challenge,
            signature: sign(null, nativeAdmissionBytes(challenge), native.privateKey).toString(
              "base64url",
            ),
          },
        },
        async () => true,
      );
    };
    const scope = {
      requestId: "issue",
      originEnvironmentId: "origin",
      originNativeRevision: "a".repeat(64),
      targetEnvironmentId: host,
      threadId: "thread",
      projectId: "project",
      originPublicKey: await signer.publicKey(),
      actions: ["tasks.get", "tasks.update"],
      expiresAt: Date.now() + 60_000,
    };
    await expect(invoke("issue", { ...scope, actions: ["tasks.delete"] })).rejects.toThrow();
    const grant = (await invoke("issue", scope)) as { grantId: string; token: string };
    const status = await invoke("issue.status", { requestId: "issue" });
    expect(status).toMatchObject({ state: "completed", result: { grantId: grant.grantId } });
    expect(JSON.stringify(status)).not.toContain(grant.token);
    const action = "tasks.get" as const,
      input = { taskId: "task" },
      requestId = "read";
    const challenge = (await invoke("challenge", {
      grantId: grant.grantId,
      token: grant.token,
      action,
      requestId,
      input,
    })) as { nonce: string; expiresAt: number };
    const attestation: RoomAttestation = {
      version: 1,
      originEnvironmentId: "origin",
      originNativeRevision: "a".repeat(64),
      targetEnvironmentId: host,
      threadId: "thread",
      projectId: "project",
      grantId: grant.grantId,
      action,
      requestId,
      scopeHash: roomDelegationScopeHash(action, input),
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt,
    };
    const signature = await signer.attest(attestation, async () => true);
    expect(
      await invoke("call", {
        grantId: grant.grantId,
        token: grant.token,
        originEnvironmentId: "origin",
        threadId: "thread",
        projectId: "project",
        action,
        requestId,
        input,
        attestation,
        signature,
      }),
    ).toEqual({ items: ["fixture"] });
    expect(execute).toHaveBeenCalledOnce();
    projectCwd = "/retargeted";
    await expect(
      invoke("call", {
        grantId: grant.grantId,
        token: grant.token,
        originEnvironmentId: "origin",
        threadId: "thread",
        projectId: "project",
        action,
        requestId,
        input,
        attestation,
        signature,
      }),
    ).rejects.toThrow("project path changed");
    projectCwd = "/original";
    const revokeReadId = "revoked-read";
    const revokeChallenge = (await invoke("challenge", {
      grantId: grant.grantId,
      token: grant.token,
      action,
      requestId: revokeReadId,
      input,
    })) as { nonce: string; expiresAt: number };
    const revokeProof: RoomAttestation = {
      ...attestation,
      requestId: revokeReadId,
      nonce: revokeChallenge.nonce,
      expiresAt: revokeChallenge.expiresAt,
    };
    execute.mockImplementationOnce(async (_action, _input, _principal, _id, authorized) => {
      projectCurrent = false;
      expect(await authorized()).toBe(false);
      return { items: ["private"] };
    });
    await expect(
      invoke("call", {
        grantId: grant.grantId,
        token: grant.token,
        originEnvironmentId: "origin",
        threadId: "thread",
        projectId: "project",
        action,
        requestId: revokeReadId,
        input,
        attestation: revokeProof,
        signature: await signer.attest(revokeProof, async () => true),
      }),
    ).rejects.toThrow("admission revoked");
    projectCurrent = true;
    const change = { taskId: "task", title: "changed", expectedUpdatedAt: 10 },
      writeAction = "tasks.update" as const,
      writeId = "original-write";
    const makeWrite = async () => {
      const fresh = (await invoke("challenge", {
        grantId: grant.grantId,
        token: grant.token,
        action: writeAction,
        requestId: writeId,
        input: change,
      })) as { nonce: string; expiresAt: number };
      const proof: RoomAttestation = {
        ...attestation,
        action: writeAction,
        requestId: writeId,
        scopeHash: roomDelegationScopeHash(writeAction, change),
        nonce: fresh.nonce,
        expiresAt: fresh.expiresAt,
      };
      return {
        grantId: grant.grantId,
        token: grant.token,
        originEnvironmentId: "origin",
        threadId: "thread",
        projectId: "project",
        action: writeAction,
        requestId: writeId,
        input: change,
        attestation: proof,
        signature: await signer.attest(proof, async () => true),
      };
    };
    execute.mockRejectedValueOnce(new Error("lost acknowledgement"));
    await expect(invoke("call", await makeWrite())).rejects.toThrow("lost acknowledgement");
    expect(await invoke("call", await makeWrite())).toMatchObject({
      state: "uncertain",
      requestId: writeId,
    });
    expect(execute).toHaveBeenCalledTimes(3);
    writeFileSync(
      registry,
      JSON.stringify({ version: 1, generation: "b".repeat(64), entries: [entry] }),
    );
    await expect(
      invoke("challenge", { grantId: grant.grantId, token: grant.token, action, requestId, input }),
    ).rejects.toThrow("grant admission was revoked");
    await invoke("revoke", { grantId: grant.grantId });
    await expect(
      invoke("challenge", { grantId: grant.grantId, token: grant.token, action, requestId, input }),
    ).rejects.toThrow("grant admission was revoked");
    expect(execute).toHaveBeenCalledTimes(3);
  } finally {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
