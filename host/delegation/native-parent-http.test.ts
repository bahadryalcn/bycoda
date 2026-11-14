import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { HostStore } from "../store";
import { HostEngine } from "../engine";
import { createHostServer } from "../server";
import { DesktopSessions } from "../desktop/desktopSessions";

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
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
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
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  await vi.waitFor(async () =>
    expect((await store.session(sibling.sessionId)).status).toBe("idle"),
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
  const message = await call(
    "conversation.tools.call",
    { action: "agents.send", input: messageInput },
    childGrant.token,
  );
  expect(message.delivery).toBe("started");
  expect(
    await call(
      "conversation.tools.call",
      { action: "agents.send", input: messageInput },
      childGrant.token,
    ),
  ).toEqual(message);
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
  expect(
    (await store.session(sibling.sessionId)).session.blocks.some(
      (block) =>
        block.role === "user" &&
        block.text.includes("untrusted peer data") &&
        block.text.includes("What is your schema?"),
    ),
  ).toBe(true);
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
  });
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
  });
  // Even idle Native parents stay with the desktop execution owner.
  await expect(store.session(id)).rejects.toThrow("Session not found on this machine");
});
