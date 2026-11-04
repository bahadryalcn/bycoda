import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { HostStore } from "./store";
import { HostEngine } from "./engine";
import { createHostServer } from "./server";
import { DesktopSessions } from "./desktopSessions";
import { defaultCrewPolicy } from "../src/features/crews/model/crew";

vi.mock("./provider-accounts", async (original) => {
  const module = await original<typeof import("./provider-accounts")>();
  return { ...module, hostProviderAccounts: () => module.hostProviderAccounts([]) };
});
vi.mock("../src/integrations/harness/providers/codex/codexCatalog", () => ({
  discoverCodexModels: async () => [{ id: "codex:fixture", name: "Fixture" }],
  refreshCodexCatalog: async () => {},
}));

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "crew-native-http-"));
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
    if (!directory.startsWith(join(tmpdir(), "crew-native-http-")))
      throw new Error("Unexpected fixture directory");
    rmSync(directory, { recursive: true, force: true });
  });
  const project = await engine.openProject(directory);
  const created = await engine.command({
    type: "create",
    workspaceMode: "current",
    commandId: "seed-create",
    projectId: project.id,
    harness: "codex",
    model: "codex:fixture",
    runtimeMode: "auto-accept-edits",
  });
  const seed = await store.session(created.sessionId);
  const id = "native-http-coordinator";
  const native = {
    ...seed,
    status: "running" as const,
    runId: undefined,
    session: { ...seed.session, id, busy: true },
  };
  vi.spyOn(DesktopSessions.prototype, "projectCwdAsync").mockImplementation(async (target) =>
    target === id ? project.cwd : undefined,
  );
  vi.spyOn(DesktopSessions.prototype, "metadataAsync").mockImplementation(async (target) =>
    target === id ? { cwd: project.cwd, harness: "codex", stored: true } : undefined,
  );
  vi.spyOn(DesktopSessions.prototype, "snapshotAsync").mockImplementation(async (target) =>
    target === id ? structuredClone(native) : undefined,
  );
  vi.spyOn(DesktopSessions.prototype, "snapshotMetaAsync").mockImplementation(async (target) => {
    if (target !== id) return undefined;
    const { blocks: _blocks, ...metadata } = native.session;
    return { ...structuredClone(native), session: metadata, lastUserText: "Coordinate work" };
  });
  vi.spyOn(DesktopSessions.prototype, "stampAsync").mockImplementation(async (target) =>
    target === id ? { updatedAt: 1, running: true } : undefined,
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
  const device = await store.issueDevice("Crew fixture owner");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
  const call = async (method: string, params: Record<string, unknown>, token = device.token) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }),
    });
    const value = (await response.json()) as { result?: any; error?: string };
    expect(value.error).toBeUndefined();
    return value.result;
  };
  const agent = (role: "coordinator" | "specialist" | "reviewer") => ({
    id: role,
    name: role,
    role,
    instructions: "Fixture role",
    selection: "fixed",
    candidates: [
      { id: role, harness: "codex", model: "codex:fixture", modelSettings: {}, capabilities: {} },
    ],
  });
  await call("crews.save", {
    projectId: project.id,
    definition: {
      id: "native-http-crew",
      projectId: project.id,
      name: "Native HTTP Crew",
      agents: [agent("coordinator"), agent("specialist"), agent("reviewer")],
      policy: defaultCrewPolicy,
    },
  });
  const grant = await call("conversation.access.issue", { sessionId: id });
  const tool = (action: string, input: Record<string, unknown>) =>
    call("conversation.tools.call", { action, input }, grant.token);
  return { store, project, id, call, tool, send };
}

it("attaches an authenticated desktop-only coding conversation through the real Crew HTTP route", async () => {
  const f = await fixture();
  await expect(f.store.session(f.id)).rejects.toThrow("Session not found on this machine");
  const input = {
    definitionId: "native-http-crew",
    requestId: "native-http-run",
    prompt: "Coordinate fixture work",
  };
  expect(await f.tool("crews.start", input)).toMatchObject({
    id: "native-http-run",
    status: "active",
    coordinatorSessionId: f.id,
  });
  expect(await f.tool("crews.start", input)).toMatchObject({
    id: "native-http-run",
    coordinatorSessionId: f.id,
  });
  const view = await f.tool("crews.get", { runId: "native-http-run" });
  expect(view).toMatchObject({ coordinatorSessionId: f.id, coordinatorStatus: "running" });
  await expect(f.store.session(f.id)).rejects.toThrow("Session not found on this machine");
  expect(f.send).not.toHaveBeenCalled();
});

it("routes Stop work to the running native desktop using a durable command receipt", async () => {
  const f = await fixture();
  const beat = () =>
    f.call("sessions.desktopLive", {
      clientId: "native-crew-window",
      pageToken: "7e1c4dc0-6f53-4a8c-b8d8-000000000001",
      sessions: [
        {
          id: f.id,
          busy: true,
          turnReceipt: {
            version: 1,
            sessionId: f.id,
            turnId: "7e1c4dc0-6f53-4a8c-b8d8-000000000002",
          },
        },
      ],
    });
  await beat();
  await f.tool("crews.start", {
    definitionId: "native-http-crew",
    requestId: "native-http-stop",
    prompt: "Coordinate fixture work",
  });
  expect(await f.tool("crews.stop", { runId: "native-http-stop" })).toMatchObject({
    status: "paused",
  });
  const pending = await beat();
  const cancel = pending.commands.find(
    (entry: { type: string; sessionId: string }) =>
      entry.type === "cancel" && entry.sessionId === f.id,
  );
  expect(cancel).toMatchObject({ type: "cancel", sessionId: f.id, runId: "desktop" });
  const receipt = await f.store.desktopCommandStatus(cancel.id, "crew:native-http-stop");
  expect(receipt).toMatchObject({ commandId: cancel.id, sessionId: f.id });
  await expect(f.store.session(f.id)).rejects.toThrow("Session not found on this machine");
  expect(f.send).not.toHaveBeenCalled();
});
