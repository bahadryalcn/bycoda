import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../../store";
import { hostRoomDelegationStore } from "./assistant-room-delegation-store";
import { AssistantRoomDelegation, roomDelegationScopeHash } from "./assistant-room-delegation";
import { RoomAttestationSigner, type RoomAttestation } from "./assistant-room-attestation";

it("retains issued grant and uncertain write receipt across Host store restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "room-delegation-"));
  const path = join(directory, "host.db");
  const make = (store: HostStore, execute: () => Promise<unknown>) =>
    new AssistantRoomDelegation({
      targetEnvironmentId: "target",
      store: hostRoomDelegationStore(store),
      now: () => 1000,
      verifyOrigin: async () => true,
      approve: async (operation) => ({ approved: true, operationHash: operation.operationHash }),
      execute,
    });
  let store = new HostStore(path);
  try {
    const first = make(store, async () => {
      throw new Error("lost");
    });
    const signer = new RoomAttestationSigner(
      join(directory, "key"),
      "origin",
      async (id) => ({ id }),
      () => 1000,
    );
    const grant = await first.issue({
      requestId: "issue",
      originEnvironmentId: "origin",
      originNativeRevision: "a".repeat(64),
      targetEnvironmentId: "target",
      threadId: "thread",
      projectId: "project",
      originPublicKey: await signer.publicKey(),
      actions: ["tasks.update"],
      expiresAt: 2000,
    });
    const makeCall = async (owner: AssistantRoomDelegation) => {
      const input = { title: "test" },
        action = "tasks.update" as const;
      const challenge = await owner.challenge({
        grantId: grant.grantId,
        token: grant.token,
        action,
        requestId: "write",
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
        requestId: "write",
        scopeHash: roomDelegationScopeHash(action, input),
        nonce: challenge.nonce,
        expiresAt: 2000,
      };
      return {
        ...grant,
        originEnvironmentId: "origin",
        originNativeRevision: "a".repeat(64),
        threadId: "thread",
        projectId: "project",
        action,
        requestId: "write",
        input,
        attestation,
        signature: await signer.attest(attestation, async () => true),
      };
    };
    await expect(first.call(await makeCall(first))).rejects.toThrow("lost");
    await store.close();
    store = new HostStore(path);
    const second = make(store, async () => {
      throw new Error("must never execute");
    });
    expect(await second.call(await makeCall(second))).toMatchObject({
      state: "uncertain",
      requestId: "write",
    });
    const afterRevoke = await makeCall(second);
    await second.revoke(grant.grantId);
    await expect(second.call(afterRevoke)).rejects.toThrow("authority unavailable");
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
