import { expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../../store";
import { RoomAttestationSigner, type RoomAttestation } from "./assistant-room-attestation";
import { AssistantRoomDelegation, roomDelegationScopeHash } from "./assistant-room-delegation";
import { hostRoomDelegationStore } from "./assistant-room-delegation-store";
it("binds two Host stores using fixture source verification and preserves uncertain target receipts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "room-two-host-"));
  const source = new HostStore(join(directory, "source.db")),
    target = new HostStore(join(directory, "target.db"));
  try {
    await Promise.all([source.ready, target.ready]);
    const origin = source.environmentId,
      destination = target.environmentId,
      thread = "real-room",
      project = "target-project";
    expect(origin).not.toBe(destination);
    let live = true;
    const signer = new RoomAttestationSigner(
      join(directory, "origin-key"),
      origin,
      async (id) => (live && id === thread ? { id } : null),
      () => 1000,
    );
    const publicKey = await signer.publicKey();
    const execute = vi.fn(async () => {
      throw new Error("receipt lost");
    });
    const targetOwner = new AssistantRoomDelegation({
      targetEnvironmentId: destination,
      store: hostRoomDelegationStore(target),
      now: () => 1000,
      verifyOrigin: async (o, key) =>
        live && o.environmentId === origin && o.threadId === thread && key === publicKey,
      approve: async (operation) => ({ approved: true, operationHash: operation.operationHash }),
      execute,
    });
    const grant = await targetOwner.issue({
      requestId: "owner-review",
      originEnvironmentId: origin,
      originNativeRevision: "a".repeat(64),
      targetEnvironmentId: destination,
      threadId: thread,
      projectId: project,
      originPublicKey: publicKey,
      actions: ["tasks.update"],
      expiresAt: 10_000,
    });
    const makeCall = async () => {
      const action = "tasks.update" as const,
        requestId = "original",
        input = { taskId: "task", expectedRevision: 4 };
      const challenge = await targetOwner.challenge({
        grantId: grant.grantId,
        token: grant.token,
        action,
        requestId,
        input,
      });
      const attestation: RoomAttestation = {
        version: 1,
        originEnvironmentId: origin,
        originNativeRevision: "a".repeat(64),
        targetEnvironmentId: destination,
        threadId: thread,
        projectId: project,
        grantId: grant.grantId,
        action,
        requestId,
        scopeHash: roomDelegationScopeHash(action, input),
        nonce: challenge.nonce,
        expiresAt: challenge.expiresAt,
      };
      return {
        ...grant,
        originEnvironmentId: origin,
        originNativeRevision: "a".repeat(64),
        threadId: thread,
        projectId: project,
        action,
        requestId,
        input,
        attestation,
        signature: await signer.attest(attestation, async () => live),
      };
    };
    const first = await makeCall();
    await expect(targetOwner.call(first)).rejects.toThrow("receipt lost");
    expect(await targetOwner.call(await makeCall())).toMatchObject({
      state: "uncertain",
      requestId: "original",
    });
    expect(execute).toHaveBeenCalledOnce();
    live = false;
    await expect(targetOwner.call(first)).rejects.toThrow("authority unavailable");
    await targetOwner.revoke(grant.grantId);
  } finally {
    await target.close();
    await source.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("routes proof-bound calls between two Host stores without granting a paired device native authority", async () => {
  const { generateKeyPairSync, sign } = await import("node:crypto");
  const { writeFileSync } = await import("node:fs");
  const {
    NativeAdmissionOwner,
    nativeAdmissionBytes,
    nativeAdmissionDigest,
    nativeAdmissionFingerprint,
  } = await import("../native/assistant-native-admission");
  const { createRoomNativeSourceAdapter } = await import("./assistant-room-native-adapter");
  const { createRoomNativeTargetAdapter } = await import("./assistant-room-native-target");
  const directory = mkdtempSync(join(tmpdir(), "room-native-two-host-"));
  const source = new HostStore(join(directory, "source.db")),
    target = new HostStore(join(directory, "target.db"));
  try {
    await Promise.all([source.ready, target.ready]);
    const origin = source.environmentId,
      destination = target.environmentId,
      native = generateKeyPairSync("ed25519"),
      installationId = "desktop";
    const registry = (host: string) => {
      const path = join(directory, `${host}.json`);
      writeFileSync(
        path,
        JSON.stringify({
          version: 1,
          generation: "a".repeat(64),
          entries: [
            {
              installationId,
              hostId: host,
              publicKey: native.publicKey.export({ type: "spki", format: "pem" }).toString(),
              fingerprint: nativeAdmissionFingerprint(native.publicKey),
            },
          ],
        }),
      );
      return path;
    };
    const sourceRegistry = registry(origin),
      sourceTrust = new NativeAdmissionOwner(sourceRegistry, origin),
      targetTrust = new NativeAdmissionOwner(registry(destination), destination);
    const signer = new RoomAttestationSigner(join(directory, "source-key"), origin, async (id) =>
      id === "thread" ? { id } : null,
    );
    const sourceApi = createRoomNativeSourceAdapter({
      environmentId: origin,
      admission: sourceTrust,
      signer,
      thread: async (id) => (id === "thread" ? { id } : null),
    });
    const execute = vi.fn(async () => ({ ok: true }));
    let targetVisible = true;
    const targetApi = createRoomNativeTargetAdapter({
      environmentId: destination,
      admission: targetTrust,
      store: hostRoomDelegationStore(target),
      withProject: async (_id, _actions, _request, _hash, _native, _authorized, body) =>
        body(() => targetVisible, "/target/project"),
      execute,
    });
    const proof = async (
      owner: InstanceType<typeof NativeAdmissionOwner>,
      host: string,
      action: string,
      value: unknown,
    ) => {
      const operationJson = JSON.stringify(value),
        request = {
          installationId,
          hostId: host,
          action: `assistant.delegation.${action}`,
          requestDigest: nativeAdmissionDigest(operationJson),
        },
        challenge = await owner.challenge(request);
      return {
        operationJson,
        proof: {
          challenge,
          signature: sign(null, nativeAdmissionBytes(challenge), native.privateKey).toString(
            "base64url",
          ),
        },
      };
    };
    const key = await signer.publicKey();
    const originOp = {
      threadId: "thread",
      targetEnvironmentId: destination,
      projectId: "project",
      publicKey: key,
    };
    const sourceIdentity = (await sourceApi(
      "origin",
      await proof(sourceTrust, origin, "origin", originOp),
      async () => true,
    )) as { originNativeRevision: string };
    expect(sourceIdentity).toMatchObject({
      threadId: "thread",
      environmentId: origin,
      publicKey: key,
    });
    const spec = {
      requestId: "issue",
      originEnvironmentId: origin,
      originNativeRevision: sourceIdentity.originNativeRevision,
      targetEnvironmentId: destination,
      threadId: "thread",
      projectId: "project",
      originPublicKey: key,
      actions: ["tasks.get"],
      expiresAt: Date.now() + 60000,
    };
    const grant = (await targetApi(
      "issue",
      await proof(targetTrust, destination, "issue", spec),
      async () => true,
    )) as { grantId: string; token: string };
    const input = { taskId: "task" },
      requestId = "request",
      action = "tasks.get" as const;
    const challengeOp = { grantId: grant.grantId, token: grant.token, action, requestId, input };
    const challenge = (await targetApi(
      "challenge",
      await proof(targetTrust, destination, "challenge", challengeOp),
      async () => true,
    )) as { nonce: string; expiresAt: number };
    const attestation: RoomAttestation = {
      version: 1,
      originEnvironmentId: origin,
      originNativeRevision: sourceIdentity.originNativeRevision,
      targetEnvironmentId: destination,
      threadId: "thread",
      projectId: "project",
      grantId: grant.grantId,
      action,
      requestId,
      scopeHash: roomDelegationScopeHash(action, input),
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt,
    };
    const signed = (await sourceApi(
      "attest",
      await proof(sourceTrust, origin, "attest", attestation),
      async () => true,
    )) as { signature: string };
    const call = {
      ...challengeOp,
      originEnvironmentId: origin,
      threadId: "thread",
      projectId: "project",
      attestation,
      signature: signed.signature,
    };
    expect(
      await targetApi(
        "call",
        await proof(targetTrust, destination, "call", call),
        async () => true,
      ),
    ).toEqual({ ok: true });
    expect(execute).toHaveBeenCalledOnce();
    targetVisible = false;
    await expect(
      targetApi("call", await proof(targetTrust, destination, "call", call), async () => true),
    ).rejects.toThrow();
    expect(execute).toHaveBeenCalledOnce();
    writeFileSync(
      sourceRegistry,
      JSON.stringify({
        version: 1,
        generation: "b".repeat(64),
        entries: [
          {
            installationId,
            hostId: origin,
            publicKey: native.publicKey.export({ type: "spki", format: "pem" }).toString(),
            fingerprint: nativeAdmissionFingerprint(native.publicKey),
          },
        ],
      }),
    );
    await expect(
      sourceApi(
        "attest",
        await proof(sourceTrust, origin, "attest", attestation),
        async () => true,
      ),
    ).rejects.toThrow("admission changed");
    await expect(
      targetApi("issue", { operationJson: JSON.stringify(spec), proof: {} }, async () => true),
    ).rejects.toThrow();
  } finally {
    await target.close();
    await source.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
