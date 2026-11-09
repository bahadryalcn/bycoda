import { expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  AssistantRoomDelegation,
  roomDelegationScopeHash,
  type DelegationPorts,
  type DelegationStore,
} from "./assistant-room-delegation";
import type { RoomAttestation } from "./assistant-room-attestation";
function setup() {
  const grants = new Map<string, any>(),
    receipts = new Map<string, any>();
  const store: DelegationStore = {
    atomic: async (fn) => fn(),
    grant: async (id) => grants.get(id),
    saveGrant: async (v) => {
      grants.set(v.grantId, v);
    },
    receipt: async (id) => receipts.get(id),
    saveReceipt: async (id, v) => {
      receipts.set(id, v);
    },
  };
  const keys = generateKeyPairSync("ed25519");
  let live = true;
  const execute = vi.fn(async () => ({ accepted: true }));
  const ports: DelegationPorts = {
    targetEnvironmentId: "target",
    store,
    now: () => 1000,
    verifyOrigin: async (o) => live && o.environmentId === "origin" && o.threadId === "thread",
    approve: async (op) => ({ approved: true, operationHash: op.operationHash }),
    execute,
  };
  const service = new AssistantRoomDelegation(ports);
  const issue = () =>
    service.issue({
      requestId: "issue",
      originEnvironmentId: "origin",
      originNativeRevision: "a".repeat(64),
      targetEnvironmentId: "target",
      threadId: "thread",
      projectId: "project",
      originPublicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      actions: ["tasks.get", "tasks.update"],
      expiresAt: 2000,
    });
  async function call(
    grant: { grantId: string; token: string },
    action: "tasks.get" | "tasks.update",
    requestId = "r",
    input: Record<string, unknown> = {},
  ) {
    const challenge = await service.challenge({
      grantId: grant.grantId,
      token: grant.token,
      action,
      requestId,
      input,
    });
    const attestation: RoomAttestation = {
      version: 1,
      originEnvironmentId: "origin",
      originNativeRevision: "a".repeat(64),
      targetEnvironmentId: "target",
      threadId: "thread",
      projectId: "project",
      grantId: grant.grantId,
      action,
      requestId,
      scopeHash: roomDelegationScopeHash(action, input),
      nonce: challenge.nonce,
      expiresAt: 2000,
    };
    const a = attestation;
    const bytes = Buffer.from(
      JSON.stringify([
        "bycoda-room-attestation-v1",
        a.originEnvironmentId,
        a.originNativeRevision,
        a.targetEnvironmentId,
        a.threadId,
        a.projectId,
        a.grantId,
        a.action,
        a.requestId,
        a.scopeHash,
        a.nonce,
        a.expiresAt,
      ]),
    );
    return {
      ...grant,
      originEnvironmentId: "origin",
      originNativeRevision: "a".repeat(64),
      threadId: "thread",
      projectId: "project",
      action,
      requestId,
      input,
      attestation,
      signature: sign(null, bytes, keys.privateKey).toString("base64url"),
    };
  }
  return {
    service,
    issue,
    execute,
    ports,
    call,
    offline: () => {
      live = false;
    },
  };
}
it("binds scope, Hosts, thread, nonce and expiry; rejects replay and revocation", async () => {
  const f = setup(),
    grant = await f.issue(),
    call = await f.call(grant, "tasks.get");
  expect(await f.service.call(call)).toEqual({ accepted: true });
  await expect(f.service.call(call)).rejects.toThrow("already used");
  await expect(
    f.service.call({ ...(await f.call(grant, "tasks.get")), signature: "A".repeat(86) }),
  ).rejects.toThrow("attestation");
  await expect(
    f.service.call({ ...(await f.call(grant, "tasks.get")), projectId: "other" }),
  ).rejects.toThrow("authority unavailable");
  await expect(
    f.service.call({ ...(await f.call(grant, "tasks.get")), token: "wrong" }),
  ).rejects.toThrow("authority unavailable");
  f.offline();
  await expect(f.service.call(await f.call(grant, "tasks.get"))).rejects.toThrow(
    "authority unavailable",
  );
  await f.service.revoke(grant.grantId);
});
it("preserves uncertain original operation and never repeats an effect", async () => {
  const f = setup(),
    grant = await f.issue();
  f.execute.mockRejectedValueOnce(new Error("connection lost"));
  await expect(
    f.service.call(await f.call(grant, "tasks.update", "original", { text: "one" })),
  ).rejects.toThrow("connection lost");
  expect(
    await f.service.call(await f.call(grant, "tasks.update", "original", { text: "one" })),
  ).toMatchObject({ state: "uncertain" });
  await expect(
    f.service.call(await f.call(grant, "tasks.update", "original", { text: "changed" })),
  ).rejects.toThrow("reused with different operation");
  expect(f.execute).toHaveBeenCalledOnce();
});
it("does not reissue a lost grant or bypass native approval", async () => {
  const f = setup();
  await f.issue();
  await expect(f.issue()).rejects.toThrow("already attempted");
  const denied = setup();
  denied.ports.approve = async () => ({ approved: false });
  await expect(denied.issue()).rejects.toThrow("native approval");
});
it("revocation fences new calls and drains admitted effects", async () => {
  const f = setup(),
    grant = await f.issue();
  let finish!: () => void, entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.execute.mockImplementationOnce(async () => {
    entered();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { accepted: true };
  });
  const active = f.service
    .call(await f.call(grant, "tasks.update", "active"))
    .catch((error) => error);
  await started;
  const later = await f.call(grant, "tasks.get", "later");
  let revoked = false;
  const revocation = f.service.revoke(grant.grantId).then(() => {
    revoked = true;
  });
  await Promise.resolve();
  expect(revoked).toBe(false);
  await expect(f.service.call(later)).rejects.toThrow("authority unavailable");
  finish();
  expect((await active).message).toContain("revoked");
  await revocation;
  expect(revoked).toBe(true);
});
