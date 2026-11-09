import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../../store";
import { AssistantWorkspaceOwner, workspaceOperationJson } from "./assistant-workspace-owner";
import { createHash } from "node:crypto";
import {
  describeWorkspaceTransfer,
  transferAssistantWorkspaceOperation,
} from "./assistant-workspace-transfer";

it("persists one exact source, denies workers until owner acceptance and never reclaims an unknown handoff", async () => {
  const dir = mkdtempSync(join(tmpdir(), "assistant-workspace-owner-")),
    file = join(dir, "host.db");
  let store = new HostStore(file),
    owner = new AssistantWorkspaceOwner(store);
  try {
    await owner.ready;
    const source = {
      environmentId: store.environmentId,
      threadId: "room",
      projectId: "project",
      targetProjectCwd: "C:/fixture",
      targetDeviceHash: "a".repeat(64),
      installationId: "installation",
      registryRevision: "revision",
      visibilityEpoch: 1,
      policyGeneration: "policy",
      action: "workspace.sessions.submit" as const,
      originalInput: { requestId: "operation", sessionId: "session", text: "private prompt" },
      requestId: "operation",
    };
    const receipt = await owner.prepare(
      source,
      async () => true,
      () => true,
    );
    expect(receipt.operationHash).toBe(
      createHash("sha256").update(workspaceOperationJson(source)).digest("hex"),
    );
    expect(JSON.stringify(receipt)).not.toContain("private prompt");
    const auth = {
      environmentId: store.environmentId,
      threadId: "room",
      requestId: "operation",
      operationHash: receipt.operationHash,
    };
    expect(await owner.authorize(auth, source.targetDeviceHash)).toBe(false);
    expect(await owner.claim(receipt, () => true)).toBe(true);
    expect(await owner.claim(receipt, () => true)).toBe(false);
    await store.close();
    store = new HostStore(file);
    owner = new AssistantWorkspaceOwner(store);
    await owner.ready;
    expect(
      (
        await owner.status(
          source,
          async () => true,
          () => true,
        )
      )?.state,
    ).toBe("unknown");
    expect(await owner.authorize(auth, source.targetDeviceHash)).toBe(false);
    const accepted = await owner.settle(receipt, "ownerAccepted", () => true);
    expect(await owner.authorize(auth, "b".repeat(64))).toBe(false);
    expect(await owner.authorize(auth, source.targetDeviceHash)).toBe(true);
    expect((await owner.settle(accepted, "unknown", () => true)).state).toBe("ownerAccepted");
    await expect(
      owner.prepare(
        { ...source, originalInput: { ...source.originalInput, text: "different" } },
        async () => true,
        () => true,
      ),
    ).rejects.toThrow("reused");
    await expect(
      owner.status(
        { ...source, targetDeviceHash: "b".repeat(64) },
        async () => true,
        () => true,
      ),
    ).rejects.toThrow("source changed");
    await expect(
      owner.status(
        { ...source, visibilityEpoch: 2 },
        async () => true,
        () => true,
      ),
    ).rejects.toThrow("source changed");
    await expect(
      owner.status(
        { ...source, policyGeneration: "reopened" },
        async () => true,
        () => true,
      ),
    ).rejects.toThrow("source changed");
    expect((await owner.settle(accepted, "completed", () => true)).state).toBe("completed");
    expect(await owner.authorize(auth, source.targetDeviceHash)).toBe(false);
  } finally {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("commits signed ownership once and never replays an uncertain transfer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "assistant-workspace-transfer-"));
  const store = new HostStore(join(dir, "host.db")),
    owner = new AssistantWorkspaceOwner(store);
  try {
    await owner.ready;
    const source = {
      environmentId: store.environmentId,
      threadId: "room",
      projectId: "project",
      targetProjectCwd: "C:/fixture",
      targetDeviceHash: "a".repeat(64),
      installationId: "installation",
      registryRevision: "revision",
      visibilityEpoch: 1,
      policyGeneration: "policy",
      action: "workspace.projects.select" as const,
      originalInput: { requestId: "request" },
      requestId: "request",
    };
    let transfers = 0;
    const relay = async (input: {
      operationJson: string;
      operationHash: string;
      requestId: string;
    }) => {
      transfers++;
      expect(input.operationJson).toBe(workspaceOperationJson(source));
      expect(
        await owner.authorize(
          {
            environmentId: source.environmentId,
            threadId: source.threadId,
            requestId: source.requestId,
            operationHash: input.operationHash,
          },
          source.targetDeviceHash,
        ),
      ).toBe(false);
      return {};
    };
    const accepted = await transferAssistantWorkspaceOperation(
      owner,
      source,
      async () => true,
      () => true,
      relay,
      async () => ({ state: "ownerAccepted" }),
    );
    expect(accepted.state).toBe("ownerAccepted");
    expect(describeWorkspaceTransfer({ state: "completed", result: accepted })).toMatchObject({
      state: "accepted",
      receiptState: "completed",
      ownerState: "ownerAccepted",
    });
    expect(
      describeWorkspaceTransfer({ state: "completed", result: { state: "unknown" } }),
    ).toMatchObject({ state: "unknown", receiptState: "completed", ownerState: "unknown" });
    expect(
      (
        await transferAssistantWorkspaceOperation(
          owner,
          source,
          async () => true,
          () => true,
          relay,
          async () => ({ state: "ownerAccepted" }),
        )
      ).state,
    ).toBe("ownerAccepted");
    expect(transfers).toBe(1);
    const uncertain = {
      ...source,
      requestId: "uncertain",
      originalInput: { requestId: "uncertain" },
    };
    await expect(
      transferAssistantWorkspaceOperation(
        owner,
        uncertain,
        async () => true,
        () => true,
        async () => {
          throw new Error("lost receipt");
        },
        async () => ({ state: "ownerAccepted" }),
      ),
    ).rejects.toThrow("lost receipt");
    expect(
      (
        await transferAssistantWorkspaceOperation(
          owner,
          uncertain,
          async () => true,
          () => true,
          relay,
          async () => ({ state: "ownerAccepted" }),
        )
      ).state,
    ).toBe("unknown");
    expect(transfers).toBe(1);
    const premature = {
      ...source,
      requestId: "premature",
      originalInput: { requestId: "premature" },
    };
    await expect(
      transferAssistantWorkspaceOperation(
        owner,
        premature,
        async () => true,
        () => true,
        async () => ({}),
        async () => ({ state: "accepted" }),
      ),
    ).rejects.toThrow("preceded durable ownership acceptance");
    expect(
      (
        await owner.status(
          premature,
          async () => true,
          () => true,
        )
      )?.state,
    ).toBe("unknown");
  } finally {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
