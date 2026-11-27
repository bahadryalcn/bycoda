import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { HostStore } from "../store";
import { HostEngine } from "../engine";
import { createHostServer } from "../server";
import { DesktopSessions } from "../desktop/desktopSessions";
import { WebSocket } from "ws";
import {
  DELEGATION_MESSAGES_STREAM,
  HOST_SCHEMA_VERSION,
  WS_SUBPROTOCOL,
  WS_WIRE_VERSION,
} from "../../src/shared/model/host-contracts";

vi.mock("../../src/integrations/harness/core/authStatus", () => ({
  readHarnessAuthStatus: async () => "signedIn",
}));
vi.mock("../providers/provider-accounts", async (original) => {
  const module = await original<typeof import("../providers/provider-accounts")>();
  return { ...module, hostProviderAccounts: () => module.hostProviderAccounts([]) };
});
vi.mock("../../src/integrations/harness/providers/codex/codexCatalog", () => ({
  discoverCodexModels: async () => [{ id: "codex:fixture", name: "Fixture" }],
  refreshCodexCatalog: async () => {},
}));

// A completion crosses the child's finish, a store wake, the notice queue and the parent's
// turn start: about 0.6–0.9 s here, past vi.waitFor's 1 s default on a loaded machine.
const COMPLETION_WAIT = { timeout: 10_000 };

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});

it("delegates through an authenticated Native parent absent from the Host session store", async () => {
  const directory = mkdtempSync(join(tmpdir(), "delegation-native-http-"));
  const store = new HostStore(join(directory, "host.db"));
  const send = vi.fn(async () => {});
  const engine = new HostEngine(store, {
    codex: {
      send,
      stop: async () => {},
      cancel: async () => {},
      bind: () => {},
      approve: () => {},
      answer: () => {},
    },
  });
  cleanups.push(async () => {
    await engine.close();
    await store.close();
    if (!directory.startsWith(join(tmpdir(), "delegation-native-http-")))
      throw new Error("Unexpected fixture directory");
    rmSync(directory, { recursive: true, force: true });
  });
  const project = await engine.openProject(directory);
  const created = await engine.command({
    type: "create",
    workspaceMode: "current",
    commandId: "seed",
    projectId: project.id,
    harness: "codex",
    model: "codex:fixture",
    runtimeMode: "auto-accept-edits",
  });
  const seed = await store.session(created.sessionId);
  const id = "desktop-only-parent";
  const native = {
    ...seed,
    runId: undefined,
    status: "running" as "running" | "idle",
    session: {
      ...seed.session,
      id,
      busy: true,
      modelSettings: { crossSubagents: "auto" },
      blocks: [{ id: "native-turn", role: "user" as const, text: "Discuss physics" }],
    },
  };
  vi.spyOn(DesktopSessions.prototype, "projectCwdAsync").mockImplementation(async (target) =>
    target === id ? project.cwd : undefined,
  );
  vi.spyOn(DesktopSessions.prototype, "metadataAsync").mockImplementation(async (target) =>
    target === id ? { cwd: project.cwd, harness: "codex", running: true } : undefined,
  );
  vi.spyOn(DesktopSessions.prototype, "snapshotAsync").mockImplementation(async (target) =>
    target === id ? structuredClone(native) : undefined,
  );
  const server = await createHostServer(engine, ["codex"]);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await server.closeResources();
  });
  const device = await store.issueDevice("Native delegation fixture");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
  const call = async (method: string, params: Record<string, unknown>, token = device.token) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }),
    });
    const result = (await response.json()) as { result?: any; error?: string };
    expect(result.error).toBeUndefined();
    return result.result;
  };
  await expect(store.session(id)).rejects.toThrow("Session not found on this machine");
  const grant = await call("conversation.access.issue", { sessionId: id });
  const input = { requestId: "native-delegate", title: "Physics", prompt: "Read-only discussion" };
  const run = await call(
    "conversation.tools.call",
    { action: "agents.delegate", input },
    grant.token,
  );
  expect(run).toMatchObject({
    status: "running",
    model: { harness: "codex", model: "codex:fixture" },
  });
  expect(
    await call("conversation.tools.call", { action: "agents.delegate", input }, grant.token),
  ).toMatchObject({ runId: run.runId, sessionId: run.sessionId });
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce(), COMPLETION_WAIT);
  expect((await store.session(run.sessionId)).session.modelSettings.delegationParent).toContain(id);
  await expect(store.session(id)).rejects.toThrow("Session not found on this machine");
  const sibling = await call(
    "conversation.tools.call",
    {
      action: "agents.delegate",
      input: { ...input, requestId: "sibling", title: "Sibling" },
    },
    grant.token,
  );
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2), COMPLETION_WAIT);
  await vi.waitFor(
    async () => expect((await store.session(sibling.sessionId)).status).toBe("idle"),
    COMPLETION_WAIT,
  );
  const childGrant = await call("conversation.access.issue", { sessionId: run.sessionId });
  const members = await call(
    "conversation.tools.call",
    { action: "agents.list", input: {} },
    childGrant.token,
  );
  expect(members.self).toBe(run.runId);
  expect(members.agents.map((agent: { runId: string }) => agent.runId)).toContain(sibling.runId);
  const messageInput = {
    requestId: "peer-question",
    runId: sibling.runId,
    message: "What is your schema?",
  };
  const description = await call("environment.describe", {});
  expect(description.capabilities).toContain(DELEGATION_MESSAGES_STREAM);
  const socket = new WebSocket(
    url.replace(/^http/, "ws").replace(/\/rpc$/, "/ws"),
    WS_SUBPROTOCOL,
    {
      headers: { Authorization: `Bearer ${device.token}` },
    },
  );
  cleanups.push(async () => socket.terminate());
  const frames: { id?: string; params?: { subscriptionId?: string; data?: unknown } }[] = [];
  socket.on("message", (raw) => frames.push(JSON.parse(raw.toString())));
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const request = (id: string, method: string, params: unknown) =>
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  request("hello", "connection.hello", {
    environmentId: store.environmentId,
    supportedWireVersions: [WS_WIRE_VERSION],
    supportedSchemaVersions: [HOST_SCHEMA_VERSION],
    clientId: "delegation-fixture",
    clientKind: "desktop",
  });
  await vi.waitFor(() => expect(frames.some((frame) => frame.id === "hello")).toBe(true));
  for (const [subscriptionId, sessionId] of [
    ["target", sibling.sessionId],
    ["source", run.sessionId],
  ]) {
    request(subscriptionId, "subscriptions.open", {
      subscriptionId,
      target: { kind: "delegationMessages", sessionId },
    });
  }
  const snapshots = (subscriptionId: string) =>
    frames.flatMap((frame) =>
      frame.params?.subscriptionId === subscriptionId && Array.isArray(frame.params.data)
        ? [frame.params.data]
        : [],
    );
  await vi.waitFor(() => {
    expect(snapshots("target").at(-1)).toEqual([]);
    expect(snapshots("source").at(-1)).toEqual([]);
  }, COMPLETION_WAIT);
  const message = await call(
    "conversation.tools.call",
    { action: "agents.send", input: messageInput },
    childGrant.token,
  );
  // The sibling already finished: a peer message does not restart it.
  expect(message).toMatchObject({ delivery: "failed", error: expect.stringContaining("finished") });
  await vi.waitFor(() => {
    expect(snapshots("target").at(-1)).toEqual([
      expect.objectContaining({
        text: messageInput.message,
        sender: "Physics",
        delivery: "failed",
      }),
    ]);
    expect(snapshots("source").flat()).toEqual([]);
  }, COMPLETION_WAIT);
  expect(
    await call(
      "conversation.tools.call",
      { action: "agents.send", input: messageInput },
      childGrant.token,
    ),
  ).toEqual(message);
  expect(send).toHaveBeenCalledTimes(2);
  await call(
    "conversation.tools.call",
    {
      action: "agents.delegate",
      input: { ...input, requestId: "background", notifyOnCompletion: true },
    },
    grant.token,
  );
  await vi.waitFor(async () => {
    const row = await store.db
      .prepare("SELECT payload FROM session_queues WHERE session_id=?")
      .get(id);
    expect(row?.payload).toContain("Subagent completion:");
  }, COMPLETION_WAIT);
  await expect(store.session(id)).rejects.toThrow("Session not found on this machine");
  native.status = "idle";
  native.session.busy = false;
  engine.onUnblocked?.();
  await engine.command({
    type: "configure",
    commandId: "host-parent-config",
    sessionId: created.sessionId,
    expectedRevision: (await store.session(created.sessionId)).revision,
    harness: "codex",
    model: "codex:fixture",
    runtimeMode: "auto-accept-edits",
    modelSettings: { crossSubagents: "auto" },
  });
  const hostGrant = await call("conversation.access.issue", { sessionId: created.sessionId });
  await call(
    "conversation.tools.call",
    {
      action: "agents.delegate",
      input: { ...input, requestId: "host-background", notifyOnCompletion: true },
    },
    hostGrant.token,
  );
  await vi.waitFor(async () => {
    const parent = await store.session(created.sessionId);
    expect(
      parent.session.blocks.some(
        (block) => block.role === "user" && block.text.includes("Subagent completion:"),
      ),
    ).toBe(true);
  }, COMPLETION_WAIT);
  // Even idle Native parents stay with the desktop execution owner.
  await expect(store.session(id)).rejects.toThrow("Session not found on this machine");
});
