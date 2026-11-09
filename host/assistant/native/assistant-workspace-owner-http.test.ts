import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { HostStore } from "../../store";
import { HostEngine } from "../../engine";
import { createHostServer } from "../../server";
import { AssistantWorkspaceOwner } from "./assistant-workspace-owner";

it("admits only the original paired device after durable workspace ownership transfer", async () => {
  const directory = mkdtempSync(join(tmpdir(), "assistant-workspace-owner-http-"));
  const store = new HostStore(join(directory, "host.db"));
  const engine = new HostEngine(store, {});
  const server = await createHostServer(engine, ["codex"]);
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const device = await store.issueDevice("Owner"),
      other = await store.issueDevice("Other");
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
    const call = async (input: Record<string, unknown>, token = device.token) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          version: 1,
          environmentId: store.environmentId,
          method: "native.services.assistant.workspace.authorize",
          params: { input },
        }),
      });
      return (await response.json()) as { result?: { authorized: boolean }; error?: string };
    };
    const owner = new AssistantWorkspaceOwner(store);
    await owner.ready;
    // Seed the committed receipt directly: native signature integration has a separate fixture.
    const source = {
      environmentId: store.environmentId,
      threadId: "room",
      projectId: "project",
      targetProjectCwd: "C:/fixture",
      targetDeviceHash: createHash("sha256").update(device.token).digest("hex"),
      installationId: "fixture",
      registryRevision: "fixture",
      visibilityEpoch: 0,
      policyGeneration: "fixture",
      action: "workspace.projects.select" as const,
      originalInput: { requestId: "request" },
      requestId: "request",
    };
    const receipt = await owner.prepare(
      source,
      async () => true,
      () => true,
    );
    const identity = {
      threadId: source.threadId,
      requestId: source.requestId,
      operationHash: receipt.operationHash,
    };
    expect(await call(identity)).toMatchObject({ result: { authorized: false } });
    expect(await owner.claim(receipt, () => true)).toBe(true);
    expect((await call(identity)).result).toEqual({ authorized: false });
    await owner.settle(receipt, "ownerAccepted", () => true);
    expect((await call(identity)).result).toEqual({ authorized: true });
    expect((await call(identity, other.token)).result).toEqual({ authorized: false });
    expect((await call({ ...identity, operationHash: "b".repeat(64) })).result).toEqual({
      authorized: false,
    });
    await owner.settle(receipt, "completed", () => true);
    expect((await call(identity)).result).toEqual({ authorized: false });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await server.closeResources();
    await engine.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});
