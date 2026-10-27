import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { HostEngine } from "./engine";
import { HostStore } from "./store";
import { createHostServer } from "./server";

vi.mock("../src/integrations/harness/providers/codex/codexCatalog", () => ({
  discoverCodexModels: async () => [],
  refreshCodexCatalog: async () => {},
}));

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-file-revert-rpc-"));
  const store = new HostStore(join(directory, "host.db"));
  const engine = new HostEngine(store, {
    codex: {
      send: async () => {},
      stop: async () => {},
      cancel: async () => {},
      bind: () => {},
      approve: () => {},
      answer: () => {},
    },
  });
  const project = await engine.openProject(directory);
  const server = await createHostServer(engine, []);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await server.closeResources();
    await engine.close();
    await store.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  const owner = await store.issueDevice("Owner");
  const call = async (method: string, params: unknown = {}, token = owner.token) => {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }),
    });
    return {
      status: response.status,
      value: (await response.json()) as { result?: any; error?: string },
    };
  };
  const created = await engine.command({
    type: "create",
    workspaceMode: "current",
    commandId: crypto.randomUUID(),
    projectId: project.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  });
  const original = await store.session(created.sessionId);
  const checkout = join(directory, "checkout");
  await mkdir(checkout);
  await store.save(
    {
      ...original,
      revision: original.revision + 1,
      session: {
        ...original.session,
        worktreeCwd: checkout,
        blocks: [
          { id: "user-message", role: "user", text: "Edit this" },
          { id: "assistant-message", role: "assistant", text: "Done" },
        ],
      },
    },
    { type: "test.seed" },
  );
  return { store, engine, server, owner, call, checkout, sessionId: created.sessionId };
}

describe("session file revert owner RPC", () => {
  it("advertises support and derives the checkout and message from the host session", async () => {
    const f = await fixture();
    const plan = vi.spyOn(f.engine.checkpoints, "filesRevertPlan").mockResolvedValue({ files: [] });
    const revert = vi
      .spyOn(f.engine.checkpoints, "filesRevert")
      .mockResolvedValue({ reverted: [], skipped: [] });
    expect((await f.call("environment.describe")).value.result.capabilities).toContain(
      "sessions.edit-from-here.v1",
    );
    const input = {
      sessionId: f.sessionId,
      userBlockId: "user-message",
      cwd: "/caller-selected",
      planToken: "reviewed-plan",
    };
    expect((await f.call("sessions.files.revertPlan", input)).value.result).toEqual({ files: [] });
    expect(plan).toHaveBeenCalledWith(f.sessionId, f.checkout, "user-message");
    expect((await f.call("sessions.files.revert", input)).value.result).toEqual({
      reverted: [],
      skipped: [],
    });
    expect(revert).toHaveBeenCalledWith(f.sessionId, f.checkout, "user-message", "reviewed-plan");
  });

  it("denies invalid, scoped and revoked credentials before reaching file history", async () => {
    const f = await fixture();
    const plan = vi.spyOn(f.engine.checkpoints, "filesRevertPlan").mockResolvedValue({ files: [] });
    const revert = vi
      .spyOn(f.engine.checkpoints, "filesRevert")
      .mockResolvedValue({ reverted: [], skipped: [] });
    const scoped = (await f.call("conversation.access.issue", { sessionId: f.sessionId })).value
      .result;
    expect(scoped.token).toBeTruthy();
    const input = { sessionId: f.sessionId, userBlockId: "user-message" };
    for (const method of ["sessions.files.revertPlan", "sessions.files.revert"]) {
      expect((await f.call(method, input, "invalid-token")).status).toBe(401);
      expect((await f.call(method, input, scoped.token)).value.error).toContain(
        "Conversation Tools",
      );
    }
    await f.store.revokeDevice(f.owner.id);
    expect((await f.call("sessions.files.revert", input)).status).toBe(401);
    expect(plan).not.toHaveBeenCalled();
    expect(revert).not.toHaveBeenCalled();
  });

  it("rejects missing or non-user messages and running sessions before reverting", async () => {
    const f = await fixture();
    const revert = vi
      .spyOn(f.engine.checkpoints, "filesRevert")
      .mockResolvedValue({ reverted: [], skipped: [] });
    for (const userBlockId of ["missing", "assistant-message"]) {
      expect(
        (await f.call("sessions.files.revert", { sessionId: f.sessionId, userBlockId })).value
          .error,
      ).toContain("User message not found");
    }
    expect(
      (
        await f.call("sessions.files.revert", {
          sessionId: f.sessionId,
          userBlockId: "user-message",
          planToken: { invalid: true },
        })
      ).value.error,
    ).toContain("Invalid file revert plan token");
    expect(
      (await f.call("sessions.files.revert", { sessionId: "foreign", userBlockId: "user-message" }))
        .value.error,
    ).toContain("host-executed session");
    const current = await f.store.session(f.sessionId);
    await f.store.save(
      { ...current, revision: current.revision + 1, status: "running" },
      { type: "test.running" },
    );
    expect(
      (
        await f.call("sessions.files.revert", {
          sessionId: f.sessionId,
          userBlockId: "user-message",
        })
      ).value.error,
    ).toContain("Stop the session");
    expect(revert).not.toHaveBeenCalled();
  });
});
