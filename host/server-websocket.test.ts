import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { WebSocket } from "ws";
import { HostStore } from "./store";
import { HostEngine } from "./engine";
import { ModelCatalogCache } from "./providers/model-catalog-cache";
import type { HostProvider } from "./providers/providers";
import { DesktopSessions } from "./desktop/desktopSessions";
import { HostTerminals } from "./terminals/terminals";
import { AsyncHostNotes } from "./host-notes-async";
import { DevServersService } from "./dev-servers/dev-servers";
import { DevServerAccess } from "./dev-servers/dev-server-access";
import { execFileAsync as exec } from "../src/shared/lib/processExecution.node";
import { createHostServer } from "./server";
import type { HostSession } from "../src/features/connections/model/protocol";
import {
  WS_SUBPROTOCOL,
  RPC_ERROR_CODES,
  getHostRpcMethod,
} from "../src/shared/model/host-contracts";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

async function setup(provider: Partial<HostProvider> = {}, terminals?: HostTerminals) {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-ws-composition-"));
  const store = new HostStore(join(directory, "host.db"));
  const engine = new HostEngine(store, {
    codex: {
      send: async () => {},
      cancel: async () => {},
      stop: async () => {},
      bind: () => {},
      approve: () => {},
      answer: () => {},
      ...provider,
    },
  });
  const project = await engine.openProject(directory);
  const server = await createHostServer(
    engine,
    [],
    undefined,
    undefined,
    undefined,
    new DesktopSessions(() => []),
    undefined,
    undefined,
    undefined,
    undefined,
    terminals,
  );
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as AddressInfo).port;
  const device = await store.issueDevice("Fixture");
  const clients: WebSocket[] = [];
  const http = async (method: string, params = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: "POST",
      headers: { Authorization: `Bearer ${device.token}` },
      body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }),
    });
    expect(response.status).toBe(200);
    return (await response.json()).result;
  };
  const connect = async (token = device.token) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, WS_SUBPROTOCOL, {
      headers: { Authorization: `Bearer ${token}` },
    });
    clients.push(socket);
    await once(socket, "open");
    return socket;
  };
  let sequence = 0;
  const rpc = async (socket: WebSocket, method: string, params = {}) => {
    const id = `request-${++sequence}`;
    const result = new Promise<Record<string, any>>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Fixture RPC timed out: ${method}.`));
      }, 5000);
      const cleanup = () => {
        clearTimeout(timer);
        socket.off("message", receive);
      };
      const receive = (data: Buffer) => {
        const value = JSON.parse(String(data));
        if (value.id === id) {
          cleanup();
          resolve(value);
        }
      };
      socket.on("message", receive);
    });
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return await result;
  };
  const ready = async (token = device.token) => {
    const socket = await connect(token);
    const result = await rpc(socket, "connection.hello", {
      environmentId: store.environmentId,
      clientId: "fixture",
      clientKind: "desktop",
      supportedWireVersions: [2],
      supportedSchemaVersions: [1],
    });
    expect(result.result.capabilities).toEqual(
      expect.arrayContaining([
        "transport.ws.read.v2",
        "transport.ws.sessions.v2",
        "transport.ws.streams.v2",
        "transport.ws.bulk.v2",
      ]),
    );
    return socket;
  };
  cleanups.push(async () => {
    for (const client of clients) client.terminate();
    await server.closeResources();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await engine.close();
    await store.close();
    const target = resolve(directory);
    if (
      dirname(target) !== resolve(tmpdir()) ||
      !basename(target).startsWith("bycoda-ws-composition-")
    )
      throw new Error("Unexpected test cleanup path.");
    rmSync(target, { recursive: true, force: true });
  });
  const saveSession = async (text = "initial", sessionId = "fixture-session") => {
    const value: HostSession = {
      projectId: project.id,
      revision: 1,
      status: "idle",
      updatedAt: Date.now(),
      session: {
        id: sessionId,
        title: "Fixture",
        cwd: directory,
        harness: "codex",
        model: "codex:test",
        modelSettings: {},
        runtimeMode: "auto",
        blocks: [{ id: "initial-block", role: "assistant", text }],
      },
    };
    await store.save(value, {});
    return value;
  };
  return { store, project, server, device, http, connect, rpc, ready, saveSession, port };
}

describe("Host HTTP/WS read composition", () => {
  it("shares Crew request identities and preserves raw versus redacted views across HTTP/WS", async () => {
    const send = vi.fn(async () => {});
    const host = await setup({ send });
    // Only model discovery is a fixture port. Owners, stores and both transports
    // are real; no installed CLI, native probe or provider account is contacted.
    vi.spyOn(ModelCatalogCache.prototype, "read").mockResolvedValue({
      models: {
        codex: [{ id: "codex:test", harness: "codex", name: "Fixture" }],
        claude: [{ id: "claude:test", harness: "claude", name: "Review fixture" }],
      },
      errors: {},
    });
    vi.spyOn(host.server.tasks, "tick").mockResolvedValue(undefined);
    const socket = await host.ready();
    const projectId = host.project.id;
    const schema = await host.rpc(socket, "crews.schema", { projectId });
    expect(schema.error).toBeUndefined();
    const definition = {
      ...schema.result.definition,
      id: "composition-crew",
      name: "Shared crew",
      agents: schema.result.definition.agents.map((agent: { role: string }) => ({
        id: agent.role,
        name: agent.role,
        role: agent.role,
        instructions: "private-source-instructions",
        selection: "fixed",
        candidates: [
          {
            id: `${agent.role}-model`,
            harness: agent.role === "reviewer" ? "claude" : "codex",
            model: agent.role === "reviewer" ? "claude:test" : "codex:test",
            modelSettings: {},
            capabilities: {},
            cost: 1,
          },
        ],
      })),
    };
    const saved = await host.http("crews.save", { projectId, definition });
    const listed = await host.rpc(socket, "crews.list", { projectId });
    expect(listed.error).toBeUndefined();
    expect(listed.result.definitions).toContainEqual(saved);
    const start = {
      projectId,
      definitionId: saved.id,
      prompt: "Only a source fixture",
      requestId: "crew-start-retained",
      newConversation: true,
    };
    const original = await host.http("crews.start", start);
    const retry = await host.rpc(socket, "crews.start", start);
    expect(retry.error).toBeUndefined();
    expect(retry.result.id).toBe(original.id);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce(), { timeout: 5000 });
    expect(retry.result.definition.agents[0].instructions).toBe("private-source-instructions");
    expect(
      (await host.rpc(socket, "crews.pause", { projectId, runId: original.id })).result.status,
    ).toBe("paused");
    const request = {
      projectId,
      runId: original.id,
      requestId: "crew-message-retained",
      text: "Retain this request",
    };
    const firstMessage = await host.http("crews.request", request);
    const sameMessage = await host.rpc(socket, "crews.request", request);
    expect(sameMessage.error).toBeUndefined();
    expect(sameMessage.result.id).toBe(firstMessage.id);
    const read = await host.rpc(socket, "crews.get", { projectId, runId: original.id });
    expect(read.error).toBeUndefined();
    expect(
      read.result.definition.agents.every(
        (agent: { instructions: string }) => agent.instructions === "",
      ),
    ).toBe(true);
    expect(read.result).not.toHaveProperty("launch");
    expect(read.result).not.toHaveProperty("pendingDelivery");
    expect(
      read.result.messages.filter((message: { id: string }) => message.id === firstMessage.id),
    ).toHaveLength(1);
    const denied = await host.rpc(socket, "crews.list", {
      projectId,
      principal: { sessionId: "forged" },
    });
    expect(denied.error.code).toBe(RPC_ERROR_CODES.invalidParams);
    expect(send).toHaveBeenCalledOnce();
  });

  it("shares Steward configuration and declined proposals through the same HTTP/WS owners", async () => {
    const host = await setup();
    const socket = await host.ready();
    const description = await host.http("environment.describe");
    expect(description.capabilities).toContain("transport.ws.stewards.v2");
    const input = {
      id: "steward-composition",
      projectId: host.project.id,
      enabled: false,
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "auto",
      focus: "Preserve the source",
      maxProposals: 5,
      maxOpen: 10,
      autoStart: false,
      autoMerge: false,
      isolate: false,
      scheduleKind: "daily",
      minute: 0,
      time: "09:00",
      dayOfWeek: 1,
    };
    const saved = await host.http("stewards.save", { steward: input });
    expect((await host.rpc(socket, "stewards.list")).result).toEqual([saved]);
    const edited = await host.rpc(socket, "stewards.save", {
      steward: { ...saved, focus: "Retain full metadata", expectedConfiguration: saved },
    });
    expect(edited.error).toBeUndefined();
    expect((await host.http("stewards.list"))[0]).toEqual(edited.result);
    await host.http("tasks.save", {
      task: {
        id: "steward-proposal",
        projectId: host.project.id,
        title: "Retain this suggestion",
        prompt: "Only a source fixture",
        harness: "codex",
        model: "codex:test",
        runtimeMode: "auto",
        modelSettings: {},
        source: "steward",
        stewardId: input.id,
        isolate: false,
        status: "todo",
      },
    });
    const declined = await host.rpc(socket, "stewards.decline", { taskId: "steward-proposal" });
    expect(declined.error).toBeUndefined();
    expect(declined.result).toEqual({ declined: true });
    expect((await host.http("stewards.list"))[0].declined).toHaveLength(1);
    expect(await host.http("tasks.list")).toEqual([]);
    const missing = await host.rpc(socket, "stewards.runNow", { stewardId: "absent-steward" });
    expect(missing.error.code).not.toBe(RPC_ERROR_CODES.methodNotFound);
    expect((await host.rpc(socket, "stewards.delete", { stewardId: input.id })).result).toEqual({
      deleted: true,
    });
    expect(await host.http("stewards.list")).toEqual([]);
  });

  it("reconciles retained HTTP Sprint receipts through WS without repeating a metadata effect", async () => {
    const host = await setup();
    const socket = await host.ready();
    const input = {
      id: "sprint-ws",
      requestId: "create-sprint",
      name: "Shared plan",
      goal: "Keep the objective",
      projects: [
        {
          environmentId: host.store.environmentId,
          projectId: host.project.id,
          cwd: host.project.cwd,
          name: host.project.name,
        },
      ],
      capacityPoints: 10,
      projectCapacities: {},
    };
    const original = await host.http("sprints.create", { input });
    const retry = await host.rpc(socket, "sprints.create", { input });
    expect(retry.error).toBeUndefined();
    expect(retry.result).toEqual(original);
    const update = {
      name: "Updated once",
      requestId: "update-sprint",
      expectedRevision: original.revision,
    };
    const edited = await host.http("sprints.update", { id: input.id, input: update });
    const same = await host.rpc(socket, "sprints.update", { id: input.id, input: update });
    expect(same.error).toBeUndefined();
    expect(same.result).toEqual(edited);
    const found = await host.rpc(socket, "sprints.get", { id: input.id });
    expect(found.result.revision).toBe(edited.revision);
    const board = await host.rpc(socket, "sprints.list");
    expect(board.error).toBeUndefined();
    expect(getHostRpcMethod("sprints.list")!.resultSchema.parse(board.result)).toEqual(
      board.result,
    );
    expect((await host.rpc(socket, "sprints.get", { id: "missing-sprint" })).result).toBeNull();
    expect(await host.http("sprints.get", { id: "missing-sprint" })).toBeUndefined();
  });
  it("shares automation configuration and runs across HTTP/WS with a single fake-provider admission", async () => {
    const send = vi.fn(async () => {});
    const host = await setup({ send });
    const socket = await host.ready();
    const automation = {
      id: "auto-ws",
      name: "Fixture",
      prompt: "Keep this request",
      projectId: host.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
      modelSettings: {},
      scheduleKind: "daily",
      minute: 0,
      time: "09:00",
      dayOfWeek: 1,
      maxRunMinutes: 1,
      maxRunsPerDay: 2,
      enabled: false,
      isolate: false,
    };
    const saved = await host.rpc(socket, "automations.save", { automation });
    expect(saved.error).toBeUndefined();
    expect(await host.http("automations.list")).toEqual([saved.result]);
    const schedule = {
      scheduleKind: automation.scheduleKind,
      minute: 0,
      time: "09:00",
      dayOfWeek: 1,
    };
    const preview = await host.rpc(socket, "automations.preview", { schedule });
    expect(preview.error).toBeUndefined();
    expect(preview.result).toEqual(await host.http("automations.preview", { schedule }));
    const run = await host.rpc(socket, "automations.runNow", { automationId: automation.id });
    expect(run.error).toBeUndefined();
    expect(getHostRpcMethod("automations.runNow")!.resultSchema.parse(run.result)).toEqual(
      run.result,
    );
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce(), { timeout: 5000 });
    const history = await host.http("automations.runs", { automationId: automation.id });
    expect(history).toContainEqual(
      expect.objectContaining({ id: run.result.id, sessionId: run.result.sessionId }),
    );
    expect(send).toHaveBeenCalledOnce();
  });
  it("shares development-server discovery and binds the private relay to each request's device", async () => {
    const server = {
      id: "fixture-server",
      process: { pid: 42, name: "Fixture", startedAt: "birth" },
      endpoints: [{ address: "127.0.0.1", port: 3000, url: "http://127.0.0.1:3000" }],
      managed: false,
      state: "running" as const,
      name: "Fixture",
      association: "cwd" as const,
      logsAvailable: false,
    };
    const listing = { status: "ok" as const, servers: [server], scannedAt: 1 };
    vi.spyOn(DevServersService.prototype, "handle").mockImplementation(
      async (method, _params, _projects, authorize) => {
        await authorize?.();
        if (method === "devServers.details")
          return { server, descendants: [], affectedPorts: [3000] };
        return listing;
      },
    );
    const bridge = vi
      .spyOn(DevServerAccess.prototype, "handle")
      .mockImplementation(async (method, _params, _owner, authorize) => {
        await authorize?.();
        if (method === "devServers.bridgeCheck")
          return { ...server.endpoints[0], connectAddress: "127.0.0.1" };
        if (method === "devServers.bridgeRead") return { data: "aGk=", ended: false };
        throw new Error("Fixture private relay rejected");
      });
    const host = await setup();
    const socket = await host.ready();
    for (const method of ["devServers.list", "devServers.details"] as const) {
      const params = {
        projectId: host.project.id,
        ...(method.endsWith("details") ? { id: server.id } : {}),
      };
      const reply = await host.rpc(socket, method, params);
      expect(reply.error, method).toBeUndefined();
      expect(getHostRpcMethod(method)!.resultSchema.parse(reply.result)).toEqual(reply.result);
      expect(reply.result).toEqual(await host.http(method, params));
    }
    const target = {
      projectId: host.project.id,
      id: server.id,
      identity: server.process,
      address: "127.0.0.1",
      port: 3000,
    };
    expect((await host.rpc(socket, "devServers.bridgeCheck", target)).error).toBeUndefined();
    expect(bridge.mock.calls[0][2]).toBe(host.device.token);
    const second = await host.store.issueDevice("Second relay owner");
    const secondSocket = await host.ready(second.token);
    expect(
      (
        await host.rpc(secondSocket, "devServers.bridgeRead", {
          projectId: host.project.id,
          streamId: "fixture-stream",
        })
      ).result,
    ).toEqual({ data: "aGk=", ended: false });
    expect(bridge.mock.calls[1][2]).toBe(second.token);
    expect(getHostRpcMethod("devServers.bridgeRead")).toMatchObject({
      retry: "never",
      cancellation: "wait-only",
      cost: "read",
    });
  });
  it("preserves the legacy Goal review RPC while exposing a compatible canonical WS name", async () => {
    const host = await setup();
    const socket = await host.ready();
    expect((await host.rpc(socket, "goals.list")).result).toEqual(await host.http("goals.list"));
    expect(getHostRpcMethod("goals.list")).toMatchObject({
      retry: "never",
      cancellation: "wait-only",
    });
    const recheck = vi
      .spyOn(host.server.goals, "recheckFinalReview")
      .mockRejectedValue(new Error("Fixture review rejected"));
    const params = { goalId: "fixture-goal", expectedUpdatedAt: 1 };
    const canonical = await host.rpc(socket, "goals.finalReview.recheck", params);
    expect(canonical.error.code).not.toBe(RPC_ERROR_CODES.methodNotFound);
    expect(recheck).toHaveBeenCalledExactlyOnceWith(params.goalId, params.expectedUpdatedAt);
    expect((await host.rpc(socket, "goals.final-review.recheck", params)).error).toBeDefined();
    expect(recheck).toHaveBeenCalledOnce();
    const legacy = await fetch(`http://127.0.0.1:${host.port}/rpc`, {
      method: "POST",
      headers: { Authorization: `Bearer ${host.device.token}` },
      body: JSON.stringify({
        version: 1,
        environmentId: host.store.environmentId,
        method: "goals.final-review.recheck",
        params,
      }),
    });
    expect((await legacy.json()).error).toMatch(/Fixture review rejected/);
    expect(recheck).toHaveBeenCalledTimes(2);
  });
  it("shares task persistence and coherent history while binding retarget ownership per device", async () => {
    const send = vi.fn(async () => {});
    const host = await setup({ send });
    const socket = await host.ready();
    const task = {
      id: "task-ws-fixture",
      projectId: host.project.id,
      title: "Fixture",
      prompt: "Keep pending",
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "auto",
      maxRunMinutes: 0,
      isolate: false,
      review: false,
      status: "todo",
    };
    const saved = await host.rpc(socket, "tasks.save", { task });
    expect(saved.error).toBeUndefined();
    expect(saved.result.status).toBe("todo");
    expect(await host.http("tasks.list", { projectId: host.project.id })).toEqual([saved.result]);
    for (const [method, params] of [
      ["tasks.snapshotWithCursor", {}],
      ["tasks.events", { after: 0 }],
    ] as const) {
      const reply = await host.rpc(socket, method, params);
      expect(reply.error, method).toBeUndefined();
      expect(getHostRpcMethod(method)!.resultSchema.parse(reply.result)).toEqual(reply.result);
      expect(reply.result).toEqual(await host.http(method, params));
    }
    const retarget = vi.spyOn(host.server.tasks, "retarget").mockResolvedValue(saved.result);
    const params = { taskId: task.id, workspace: { checkoutCwd: host.project.cwd } };
    expect((await host.rpc(socket, "tasks.retarget", params)).error).toBeUndefined();
    expect(retarget.mock.calls[0][3]?.ownerId).toBe(
      createHash("sha256").update(host.device.id).digest("hex"),
    );
    const second = await host.store.issueDevice("Second task owner");
    const secondSocket = await host.ready(second.token);
    expect((await host.rpc(secondSocket, "tasks.retarget", params)).error).toBeUndefined();
    expect(retarget.mock.calls[1][3]?.ownerId).toBe(
      createHash("sha256").update(second.id).digest("hex"),
    );
    expect(retarget.mock.calls[0][3]?.authorizationId).not.toBe(
      retarget.mock.calls[1][3]?.authorizationId,
    );
    expect(getHostRpcMethod("tasks.notes.read")).toMatchObject({
      retry: "never",
      cancellation: "wait-only",
    });
    expect(
      (
        await host.rpc(socket, "tasks.delete", {
          taskId: task.id,
          expectedUpdatedAt: saved.result.updatedAt,
        })
      ).result,
    ).toEqual({ deleted: true });
    expect(send).not.toHaveBeenCalled();
  });
  it("uses the shared Git owner for WS staging and returns the same validated index through HTTP", async () => {
    const host = await setup();
    await exec("git", ["init", "--quiet"], { cwd: host.project.cwd });
    writeFileSync(join(host.project.cwd, "fixture.txt"), "fixture\n");
    const socket = await host.ready();
    const scope = { projectId: host.project.id };
    const staged = await host.rpc(socket, "git.action", {
      ...scope,
      action: "stage",
      path: "fixture.txt",
    });
    expect(staged.error).toBeUndefined();
    expect(staged.result).toBeNull();
    const index = await host.rpc(socket, "git.index", scope);
    expect(index.error).toBeUndefined();
    expect(getHostRpcMethod("git.index")!.resultSchema.parse(index.result)).toEqual(index.result);
    expect(index.result).toEqual(await host.http("git.index", scope));
    expect(index.result.files).toContainEqual(
      expect.objectContaining({ relative: "fixture.txt", staged: true }),
    );
    const branches = await host.rpc(socket, "git.branches", scope);
    expect(getHostRpcMethod("git.branches")!.resultSchema.parse(branches.result)).toEqual(
      branches.result,
    );
    expect(branches.result).toEqual(await host.http("git.branches", scope));
    expect((await exec("git", ["ls-files"], { cwd: host.project.cwd })).stdout.trim()).toBe(
      "fixture.txt",
    );
  });
  it("routes Notes through the shared scope and worker ports with validated WS payloads", async () => {
    const note = {
      id: "note",
      title: "Fixture",
      body: "body",
      tags: [],
      slug: "fixture",
      slugPending: false,
      createdAt: 1,
      updatedAt: 1,
    };
    const listed = { notes: [{ ...note, preview: true as const }], total: 1 };
    vi.spyOn(AsyncHostNotes.prototype, "list").mockResolvedValue(listed);
    vi.spyOn(AsyncHostNotes.prototype, "get").mockResolvedValue(note);
    const save = vi
      .spyOn(AsyncHostNotes.prototype, "save")
      .mockImplementation(async (_note, _expected, _cwd, authorize) => {
        expect(await authorize?.()).toBe(true);
        return note;
      });
    vi.spyOn(AsyncHostNotes.prototype, "delete").mockImplementation(
      async (_id, _expected, _cwd, authorize) => {
        expect(await authorize?.()).toBe(true);
        return { deleted: true };
      },
    );
    const host = await setup();
    const socket = await host.ready();
    for (const [method, params] of [
      ["notes.list", { projectId: host.project.id }],
      ["notes.get", { id: note.id }],
      [
        "notes.upsert",
        {
          note: { id: note.id, title: note.title, body: note.body, tags: [] },
          expectedUpdatedAt: 1,
        },
      ],
      ["notes.delete", { id: note.id, expectedUpdatedAt: 1 }],
    ] as const) {
      const reply = await host.rpc(socket, method, params);
      expect(reply.error, method).toBeUndefined();
      expect(getHostRpcMethod(method)!.resultSchema.parse(reply.result)).toEqual(reply.result);
      expect(reply.result).toEqual(await host.http(method, params));
    }
    expect(save).toHaveBeenCalledTimes(2);
  });
  it("shares project directory browsing and creation across HTTP/WS with strict WS params", async () => {
    const host = await setup();
    const socket = await host.ready();
    const params = { path: host.project.cwd, name: "created-via-ws" };
    const created = await host.rpc(socket, "projects.createDirectory", params);
    expect(created.error).toBeUndefined();
    expect(created.result.path).toBe(join(host.project.cwd, params.name));
    expect(
      getHostRpcMethod("projects.createDirectory")!.resultSchema.parse(created.result),
    ).toEqual(created.result);
    const browsed = await host.rpc(socket, "projects.browse", { path: host.project.cwd });
    expect(browsed.result).toEqual(await host.http("projects.browse", { path: host.project.cwd }));
    const directory = await host.rpc(socket, "projects.directory");
    expect(directory.error).toBeUndefined();
    expect(getHostRpcMethod("projects.directory")!.resultSchema.parse(directory.result)).toEqual(
      directory.result,
    );
    const opened = await host.rpc(socket, "projects.open", { cwd: created.result.path });
    expect(opened.error).toBeUndefined();
    expect(getHostRpcMethod("projects.open")!.resultSchema.parse(opened.result)).toEqual(
      opened.result,
    );
    expect(opened.result).toEqual(await host.http("projects.open", { cwd: created.result.path }));
    expect(
      (await host.rpc(socket, "projects.browse", { path: host.project.cwd, extra: true })).error,
    ).toMatchObject({ code: RPC_ERROR_CODES.invalidParams });
  });
  it("shares pipe-shell creation and output across HTTP and WS without replaying writes", async () => {
    let emit!: (data: string) => void;
    let exit!: (code: number | null) => void;
    const child = {
      write: vi.fn(async () => {}),
      stop: vi.fn(async () => {
        exit(0);
      }),
    };
    const launch = vi.fn((_profile, _cwd, output, onExit) => {
      emit = output;
      exit = onExit;
      return child;
    });
    const terminals = new HostTerminals(
      launch,
      () => ({
        profiles: [{ id: "fixture", name: "Fixture", path: "/fixture", kind: "sh" }],
        defaultId: "fixture",
        chosenId: null,
      }),
      async (root) => root,
    );
    const host = await setup({}, terminals);
    const socket = await host.ready();
    const create = { projectId: host.project.id, requestId: "create-via-ws" };
    const terminal = (await host.rpc(socket, "terminals.create", create)).result;
    expect(await host.http("terminals.create", create)).toEqual(terminal);
    expect(launch).toHaveBeenCalledOnce();
    const scope = { projectId: host.project.id, id: terminal.id };
    emit("shared output");
    expect((await host.rpc(socket, "terminals.read", scope)).result).toEqual(
      await host.http("terminals.read", scope),
    );
    expect((await host.rpc(socket, "terminals.write", { ...scope, data: "run\n" })).result).toEqual(
      { accepted: true },
    );
    expect(child.write).toHaveBeenCalledExactlyOnceWith("run\n");
    expect(
      (await host.rpc(socket, "terminals.write", { ...scope, data: "ignored", extra: true })).error,
    ).toMatchObject({ code: RPC_ERROR_CODES.invalidParams });
    expect(child.write).toHaveBeenCalledOnce();
    await host.http("terminals.close", scope);
    expect(
      (await host.rpc(socket, "terminals.list", { projectId: host.project.id })).result.terminals,
    ).toEqual([]);
  });
  it("uses the same environment/project services while preserving HTTP compatibility", async () => {
    const host = await setup();
    const socket = await host.ready();
    const descriptor = await host.http("environment.describe", { supportedProviders: [] });
    expect(
      (await host.rpc(socket, "environment.describe", { supportedProviders: [] })).result,
    ).toEqual(descriptor);
    expect(descriptor.capabilities).toContain("transport.ws.read.v2");
    expect(descriptor.capabilities).not.toContain("transport.ws.v2");
    const legacy = await host.http("environment.describe");
    expect(legacy.providers).toEqual([]);
    const projects = await host.http("projects.list");
    expect(projects).toContainEqual(expect.objectContaining({ id: host.project.id }));
    expect((await host.rpc(socket, "projects.list")).result).toEqual(projects);
    // Existing HTTP reads continue after the new transport has been negotiated.
    expect(await host.http("projects.list")).toEqual(projects);
  });

  it("honors real device revocation before another WS result", async () => {
    const host = await setup();
    const socket = await host.ready();
    await host.store.revokeDevice(host.device.id);
    const closed = once(socket, "close");
    expect(await host.rpc(socket, "projects.list")).toMatchObject({
      error: { code: RPC_ERROR_CODES.unauthorized },
    });
    await closed;
  });

  it.each(["ws", "http"] as const)(
    "sends live Stop through %s during SQLITE_FULL without inventing a receipt",
    async (transport) => {
      let finish!: () => void;
      const turn = new Promise<void>((done) => {
        finish = done;
      });
      const send = vi.fn(async () => {
        await turn;
      });
      const cancel = vi.fn(async () => {});
      const host = await setup({
        send,
        cancel,
        stop: async () => {
          finish();
        },
      });
      const value = await host.saveSession("initial", randomUUID());
      const socket = await host.ready();
      const accepted = await host.rpc(socket, "commands.dispatch", {
        type: "send",
        commandId: "start-run",
        sessionId: value.session.id,
        text: "wait",
      });
      await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
      try {
        await host.store.db.exec("CREATE TABLE full_control_fixture(value BLOB)");
        const pages = (await host.store.db.prepare("PRAGMA page_count").get())?.page_count;
        await host.store.db.exec(`PRAGMA max_page_count=${pages}`);
        await expect(
          host.store.db.prepare("INSERT INTO full_control_fixture VALUES(zeroblob(1048576))").run(),
        ).rejects.toThrow();
        expect(await host.rpc(socket, "environment.persistence.status")).toMatchObject({
          result: { state: "temporarily-blocked", reason: "full" },
        });
        expect(await host.http("environment.persistence.status")).toMatchObject({
          state: "temporarily-blocked",
          reason: "full",
        });
        const command = {
          type: "cancel",
          commandId: "stop-run",
          sessionId: value.session.id,
          runId: accepted.result.runId,
        };
        if (transport === "ws") {
          expect(await host.rpc(socket, "commands.dispatch", command)).toMatchObject({
            result: { commandId: "stop-run", runId: accepted.result.runId },
          });
        } else {
          const response = await fetch(`http://127.0.0.1:${host.port}/rpc`, {
            method: "POST",
            headers: { Authorization: `Bearer ${host.device.token}` },
            body: JSON.stringify({
              version: 1,
              environmentId: host.store.environmentId,
              method: "commands.dispatch",
              params: command,
            }),
          });
          expect(response.status).toBe(200);
          expect((await response.json()).result).toMatchObject({
            commandId: "stop-run",
            runId: accepted.result.runId,
          });
        }
        expect(cancel).toHaveBeenCalledExactlyOnceWith(value.session.id);
        expect(await host.store.receiptStatus("stop-run")).toBeUndefined();
      } finally {
        await host.store.db.exec("PRAGMA max_page_count=2147483647");
        try {
          expect(await host.rpc(socket, "environment.persistence.recover")).toMatchObject({
            result: { state: "ready" },
          });
        } finally {
          if (host.store.db.persistenceHealth().state !== "ready")
            await host.store.db.recoverPersistence();
          finish();
        }
      }
    },
  );

  it("shares confined file reads and CAS writes across HTTP and WS", async () => {
    const host = await setup();
    const socket = await host.ready();
    const project = { projectId: host.project.id };
    const created = await host.rpc(socket, "files.create", {
      ...project,
      parent: "",
      name: "notes/example.txt",
      isDir: false,
    });
    expect(created).toMatchObject({ result: "notes/example.txt" });
    const file = { ...project, path: created.result };
    expect(await host.http("files.read", file)).toBe("");
    expect(
      await host.http("files.write", { ...file, expected: "", content: "baseline" }),
    ).toBeNull();
    const writes = await Promise.all([
      host.rpc(socket, "files.write", { ...file, expected: "baseline", content: "first revision" }),
      host.rpc(socket, "files.write", {
        ...file,
        expected: "baseline",
        content: "competing revision",
      }),
    ]);
    expect(writes.filter((reply) => Object.hasOwn(reply, "result"))).toHaveLength(1);
    const current = await host.rpc(socket, "files.read", file);
    expect(["first revision", "competing revision"]).toContain(current.result);
    expect(
      (await host.rpc(socket, "files.list", { ...project, path: "notes" })).result,
    ).toContainEqual(expect.objectContaining({ path: file.path, isDir: false }));
    expect(
      (await host.rpc(socket, "files.search", { ...project, query: "example" })).result,
    ).toContainEqual(expect.objectContaining({ path: file.path }));
    expect((await host.rpc(socket, "files.index", project)).result).toContain(file.path);
    const matches = await host.rpc(socket, "files.searchContent", {
      ...project,
      query: "revision",
      include: "notes/example.txt",
    });
    expect(matches.result.matches).toContainEqual(expect.objectContaining({ relative: file.path }));
    expect(
      await host.rpc(socket, "files.read", { ...project, path: "../outside.txt" }),
    ).toHaveProperty("error");
  });

  it("shares queue content and lease epochs across HTTP and WS without duplicating its owner", async () => {
    const host = await setup();
    const value = await host.saveSession();
    const socket = await host.ready();
    const base = { sessionId: value.session.id, clientId: "desktop:one", leaseAware: true };
    const before = await host.http("sessions.queue.get", { ...base, legacyExtra: true });
    const row = { id: "queued-row", text: "keep this queued", attachments: [] };
    const changed = await host.rpc(socket, "sessions.queue.change", {
      ...base,
      before,
      after: { messages: [row], status: "paused" },
    });
    expect(changed).toMatchObject({ result: { messages: [row] } });
    expect(
      await host.http("sessions.queue.get", { ...base, clientId: "mobile:phone" }),
    ).toMatchObject({ messages: [row], revision: changed.result.revision });
    expect(
      await host.rpc(socket, "sessions.queue.lease", { ...base, clientId: "mobile:phone" }),
    ).toHaveProperty("error");
    const lease = await host.rpc(socket, "sessions.queue.lease", base);
    expect(lease.result.drain.holder).toBe(base.clientId);
    const newer = await host.http("sessions.queue.lease", {
      ...base,
      clientId: "desktop:two",
      takeover: true,
    });
    expect(newer.drain.epoch).toBeGreaterThan(lease.result.drain.epoch);
    expect(
      await host.rpc(socket, "sessions.queue.claim", {
        ...base,
        id: row.id,
        revision: newer.revision,
        epoch: lease.result.drain.epoch,
        steer: true,
      }),
    ).toHaveProperty("error");
    const claimed = await host.rpc(socket, "sessions.queue.claim", {
      ...base,
      clientId: "desktop:two",
      id: row.id,
      revision: newer.revision,
      epoch: newer.drain.epoch,
      steer: true,
    });
    expect(claimed.result.claim.clientId).toBe("desktop:two");
    const finished = await host.rpc(socket, "sessions.queue.finish", {
      ...base,
      clientId: "desktop:two",
      token: claimed.result.claim.token,
      epoch: newer.drain.epoch,
      accepted: true,
    });
    expect(finished.result.messages).toEqual([]);
    expect((await host.http("sessions.queue.get", base)).messages).toEqual([]);
    expect(
      await host.rpc(socket, "sessions.queue.get", { ...base, unsupported: true }),
    ).toMatchObject({ error: { code: RPC_ERROR_CODES.invalidParams } });
  });

  it("closes the new transport when Host resources drain", async () => {
    const host = await setup();
    const socket = await host.ready();
    const closed = once(socket, "close");
    await host.server.closeResources();
    await closed;
    expect(host.server.listenerCount("upgrade")).toBe(0);
  });

  it("shares session reads and a durable draft command across three paired clients", async () => {
    const host = await setup();
    const value = await host.saveSession();
    const devices = [
      host.device,
      await host.store.issueDevice("Second"),
      await host.store.issueDevice("Phone"),
    ];
    const clients = await Promise.all(devices.map((device) => host.ready(device.token)));
    const events = clients.map((socket) => {
      const messages: Array<{
        params: { kind: string; revision?: number; data?: { session?: { blocks: unknown[] } } };
      }> = [];
      socket.on("message", (data) => {
        const message = JSON.parse(String(data));
        if (message.method === "subscription.event") messages.push(message);
      });
      return messages;
    });
    await Promise.all(
      clients.map((socket) =>
        host.rpc(socket, "subscriptions.open", {
          subscriptionId: "shared-view",
          target: { kind: "session", sessionId: value.session.id },
        }),
      ),
    );
    await vi.waitFor(() =>
      events.forEach((messages) => expect(messages.at(-1)?.params.revision).toBe(1)),
    );
    const command = {
      type: "draft",
      commandId: "same-draft-command",
      sessionId: value.session.id,
      text: "From another client",
    };
    const receipt = await host.rpc(clients[0], "commands.dispatch", command);
    expect(receipt.error).toBeUndefined();
    expect(receipt.result.commandId).toBe(command.commandId);
    clients[0].terminate();
    await vi.waitFor(() =>
      events
        .slice(1)
        .forEach((messages) =>
          expect(messages.at(-1)?.params.revision).toBe(receipt.result.revision),
        ),
    );
    expect(
      (await host.rpc(clients[2], "commands.status", { commandId: command.commandId })).result,
    ).toEqual(receipt.result);
    expect(events[1].at(-1)?.params.kind).toBe("delta");
    expect((await host.rpc(clients[1], "commands.dispatch", command)).result).toEqual(
      receipt.result,
    );
    expect(
      (await host.store.session(value.session.id)).session.blocks.filter(
        (block) => block.text === command.text,
      ),
    ).toHaveLength(1);
    for (const method of ["sessions.get", "sessions.page", "sessions.sync"]) {
      const response = await host.rpc(clients[1], method, { sessionId: value.session.id });
      expect(response.error).toBeUndefined();
      expect(response.result).toBeTruthy();
    }
    const read = await host.rpc(clients[1], "sessions.get", {
      sessionId: value.session.id,
      revision: receipt.result.revision,
    });
    expect(read.result).toBeNull();
  });

  it("moves large session JSON to authenticated bulk chunks and purges them on committed deletion", async () => {
    const host = await setup();
    const value = await host.saveSession("large-content-".repeat(100_000));
    const socket = await host.ready();
    const result = await host.rpc(socket, "sessions.get", { sessionId: value.session.id });
    expect(result.error).toBeUndefined();
    const descriptor = result.result.$bulk;
    expect(descriptor.totalBytes).toBeGreaterThan(1_048_576);
    const chunks = [];
    const headers = { Authorization: `Bearer ${host.device.token}` };
    const url = `http://127.0.0.1:${host.port}/ws-bulk/${descriptor.transferId}`;
    for (let offset = 0; offset < descriptor.totalBytes; offset += descriptor.chunkBytes) {
      const response = await fetch(`${url}?offset=${offset}`, { headers });
      expect(response.status).toBe(200);
      chunks.push(Buffer.from(await response.arrayBuffer()));
    }
    const body = Buffer.concat(chunks);
    expect(createHash("sha256").update(body).digest("hex")).toBe(descriptor.sha256);
    expect(JSON.parse(body.toString()).session.blocks[0].text).toBe(value.session.blocks[0].text);
    await host.http("sessions.delete", { projectId: host.project.id, sessionId: value.session.id });
    expect((await fetch(`${url}?offset=0`, { headers })).status).toBe(404);
  });
  it("publishes a fresh authority snapshot when the authority generation changes", async () => {
    const host = await setup();
    const value = await host.saveSession();
    const socket = await host.ready();
    const events: Array<{
      subscriptionId: string;
      kind: string;
      revision?: number;
      data?: HostSession;
    }> = [];
    socket.on("message", (data) => {
      const message = JSON.parse(String(data));
      if (message.method === "subscription.event") events.push(message.params);
    });
    const target = { kind: "session", sessionId: value.session.id };
    await host.rpc(socket, "subscriptions.open", { subscriptionId: "before-authority", target });
    await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ kind: "snapshot", revision: 1 }));
    expect(events.at(-1)?.data?.authorityGeneration).toBeUndefined();

    // Exercise the real post-commit publication seam. This is a SQL fixture, not
    // evidence that the native writer cohort has been qualified for migration.
    await host.store.transaction(async () => {
      await host.store.db
        .prepare("INSERT INTO host_authority_heads VALUES(?,?,?,?,?)")
        .run(host.store.environmentId, value.session.id, 2, "fixture-migration", "host-active");
      await host.store.withAuthorityGeneration(value.session.id, 2, () =>
        host.store.save({ ...value, revision: value.revision + 1, authorityGeneration: 2 }, {}),
      );
      host.store.authorityDecisionCommitted({
        sessionId: value.session.id,
        authorityGeneration: 2,
        phase: "host-active",
        projectId: host.project.id,
      });
    });
    await vi.waitFor(() =>
      expect(events.at(-1)).toMatchObject({
        subscriptionId: "before-authority",
        kind: "resync-required",
      }),
    );
    await host.rpc(socket, "subscriptions.close", { subscriptionId: "before-authority" });
    await host.rpc(socket, "subscriptions.open", { subscriptionId: "after-authority", target });
    await vi.waitFor(() =>
      expect(events.at(-1)).toMatchObject({
        subscriptionId: "after-authority",
        kind: "snapshot",
        revision: 2,
        data: { revision: 2, authorityGeneration: 2 },
      }),
    );
  });
  it("purges retained project-list bulk after a session is deleted", async () => {
    const host = await setup();
    const value = await host.saveSession();
    await host.store.save(
      {
        ...value,
        revision: 2,
        session: { ...value.session, title: "private-title-".repeat(100_000) },
      },
      {},
    );
    const socket = await host.ready();
    const listed = await host.rpc(socket, "sessions.list", { projectId: host.project.id });
    expect(listed.error).toBeUndefined();
    const descriptor = listed.result.$bulk;
    expect(descriptor.totalBytes).toBeGreaterThan(1_048_576);
    const url = `http://127.0.0.1:${host.port}/ws-bulk/${descriptor.transferId}?offset=0`;
    const headers = { Authorization: `Bearer ${host.device.token}` };
    expect((await fetch(url, { headers })).status).toBe(200);
    await host.http("sessions.delete", { projectId: host.project.id, sessionId: value.session.id });
    expect((await fetch(url, { headers })).status).toBe(404);
  });
});
