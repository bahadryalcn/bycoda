import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { afterEach, expect, it, vi } from "vitest";
import { HostEngine } from "../../engine";
import * as voiceTools from "../../voice/voice-tools";
import { HostStore } from "../../store";
import { createHostServer } from "../../server";
import { ConversationDesktopRelay } from "../../conversation/conversation-tools";
import {
  HOST_SCHEMA_VERSION,
  WS_SUBPROTOCOL,
  WS_WIRE_VERSION,
  WS_LIMITS,
  RPC_ERROR_CODES,
} from "../../../src/shared/model/host-contracts";

const probe = vi.hoisted(() => vi.fn());
vi.mock("../../../src/integrations/harness/providers/codex/codexCatalog", () => ({
  discoverCodexModels: probe,
  refreshCodexCatalog: async () => {},
}));
vi.mock("../../providers/provider-accounts", async (original) => {
  const module = await original<typeof import("../../providers/provider-accounts")>();
  return { ...module, hostProviderAccounts: () => module.hostProviderAccounts([]) };
});
// Fixture-only credentials; never touch the OS vault or developer profile.
vi.mock("../../social/social-credentials", () => ({
  OsSocialCredentials: class {
    private values = new Map<string, unknown>();
    async get(id: string) {
      return this.values.get(id);
    }
    async set(id: string, value: unknown) {
      this.values.set(id, value);
    }
    async delete(id: string) {
      this.values.delete(id);
    }
  },
}));
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function fixture() {
  probe.mockResolvedValue([
    {
      id: "codex:özel",
      harness: "codex",
      name: "Türkçe 😀",
      nativeId: "upstream",
      aliasTarget: "current",
      provider: { id: "vendor", name: "Sağlayıcı" },
      settings: [
        {
          id: "custom",
          label: "Ayar",
          kind: "select",
          value: "yüksek",
          options: [{ value: "yüksek", label: "Yüksek" }],
          description: "Açıklama",
        },
      ],
      contextWindow: 128000,
    },
  ]);
  const base = resolve("temp/verification/2026-10-29-native-services-ws/fixtures");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "host-")),
    projectPath = join(root, "project");
  await mkdir(projectPath);
  await writeFile(
    join(projectPath, "package.json"),
    JSON.stringify({ scripts: { format: "oxfmt --write ." } }),
  );
  await writeFile(join(projectPath, "formatted.js"), "unchanged disk");
  const store = new HostStore(join(root, "host.db"));
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
  const project = await engine.openProject(projectPath);
  const server = await createHostServer(engine, ["codex"]);
  const clients: WebSocket[] = [];
  cleanups.push(async () => {
    for (const client of clients) client.terminate();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await server.closeResources();
    await engine.close();
    await store.close();
    if (!resolve(root).startsWith(base + sep)) throw new Error("Unsafe fixture path");
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    device = await store.issueDevice("Fixture owner"),
    other = await store.issueDevice("Fixture other");
  const http = async (method: string, params: unknown = {}, token = device.token) => {
    const response = await fetch(`${endpoint}/rpc`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }),
    });
    return {
      status: response.status,
      ...((await response.json()) as { result?: any; error?: string }),
    };
  };
  const callHttp = async (method: string, params: unknown = {}) => {
    const value = await http(method, params);
    expect(value.error, method).toBeUndefined();
    expect(value.status).toBe(200);
    return value.result;
  };
  const decode = async (result: any, token: string) => {
    if (!result?.$bulk) return result;
    const descriptor = result.$bulk,
      chunks: Buffer[] = [];
    for (let offset = 0; offset < descriptor.totalBytes; offset += descriptor.chunkBytes) {
      const response = await fetch(
        `${endpoint}/ws-bulk/${descriptor.transferId}?offset=${offset}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(response.status).toBe(200);
      chunks.push(Buffer.from(await response.arrayBuffer()));
    }
    const bytes = Buffer.concat(chunks);
    expect(bytes.length).toBe(descriptor.totalBytes);
    expect(sha(bytes)).toBe(descriptor.sha256);
    return JSON.parse(bytes.toString());
  };
  const connect = async (token = device.token) => {
    const socket = new WebSocket(endpoint.replace("http:", "ws:") + "/ws", WS_SUBPROTOCOL, {
      headers: { Authorization: `Bearer ${token}` },
    });
    clients.push(socket);
    const pending = new Map<
      string,
      {
        resolve(value: any): void;
        reject(error: Error): void;
        timer: ReturnType<typeof setTimeout>;
      }
    >();
    socket.on("message", (data) => {
      const value = JSON.parse(data.toString()),
        waiter = pending.get(value.id);
      if (waiter) {
        pending.delete(value.id);
        clearTimeout(waiter.timer);
        waiter.resolve(value);
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      for (const value of pending.values()) {
        clearTimeout(value.timer);
        value.reject(new Error("Closed"));
      }
      pending.clear();
    });
    await new Promise<void>((done, reject) => {
      socket.once("open", done);
      socket.once("error", reject);
    });
    const request = (method: string, params: unknown = {}) =>
      new Promise<any>((done, reject) => {
        const id = randomUUID(),
          timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`Missing ${method}`));
          }, 35000);
        pending.set(id, { resolve: done, reject, timer });
        socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      });
    const hello = await request("connection.hello", {
      environmentId: store.environmentId,
      supportedWireVersions: [WS_WIRE_VERSION],
      supportedSchemaVersions: [HOST_SCHEMA_VERSION],
      clientId: "native-fixture",
      clientKind: "desktop",
    });
    expect(hello.result.capabilities).toEqual(
      expect.arrayContaining(["native.services.v1", "transport.ws.models.v1"]),
    );
    const call = async (method: string, params: unknown = {}) => {
      const response = await request(method, params);
      expect(response.error, `${method}: ${JSON.stringify(response.error)}`).toBeUndefined();
      return decode(response.result, token);
    };
    return { socket, request, call };
  };
  const session = await engine.command({
    type: "create",
    workspaceMode: "current",
    commandId: randomUUID(),
    projectId: project.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  });
  return {
    root,
    projectPath,
    store,
    engine,
    project,
    device,
    other,
    endpoint,
    session,
    http,
    callHttp,
    connect,
    decode,
  };
}
async function stage(
  channel: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["connect"]>>,
  target: string,
  params: unknown,
) {
  const bytes = Buffer.from(JSON.stringify(params)),
    uploadId = randomUUID();
  expect(bytes.length).toBeGreaterThan(WS_LIMITS.maxMessageBytes);
  await channel.call("native.services.upload.begin", {
    uploadId,
    target,
    byteLength: bytes.length,
    sha256: sha(bytes),
  });
  for (let offset = 0; offset < bytes.length; offset += 65536)
    await channel.call("native.services.upload.append", {
      uploadId,
      offset,
      data: bytes.subarray(offset, offset + 65536).toString("base64"),
    });
  return { uploadId };
}

it("preserves full owner catalog/settings over HTTP+WS and denies account inventory to scoped credentials", async () => {
  const f = await fixture(),
    ws = await f.connect();
  const http = await f.callHttp("models.list", {
    projectId: f.project.id,
    progressive: false,
    ignoredLegacyField: true,
  });
  const timeout = vi.spyOn(globalThis, "setTimeout");
  const wire = await ws.call("models.list", { projectId: f.project.id });
  expect(timeout.mock.calls.map((args) => args[1])).toContain(60_000);
  timeout.mockRestore();
  expect(wire).toEqual(http);
  expect(wire.models.codex[0].settings[0].options[0].label).toBe("Yüksek");
  expect(wire.accounts).toEqual({
    codex: [{ id: "default", label: "Host default", color: expect.any(String) }],
  });
  expect((await ws.request("models.list", { progressive: "true" })).error.code).toBe(
    RPC_ERROR_CODES.invalidParams,
  );
  const grant = await ws.call("native.services.conversation.access.issue", {
    sessionId: f.session.sessionId,
  });
  expect((await f.http("models.list", {}, grant.token)).error).toContain("Conversation Tools");
  const scoped = await f.http(
    "conversation.tools.call",
    { action: "models.list", input: {} },
    grant.token,
  );
  expect(scoped.error).toBeUndefined();
  expect(scoped.result.accounts).toBeUndefined();
  await f.store.revokeDevice(f.device.id);
  expect((await ws.request("models.list", {})).error.code).toBe(RPC_ERROR_CODES.unauthorized);
});

it("binds native emergency Stop to the authenticated owner over WS and strict HTTP fallback", async () => {
  const f = await fixture(),
    ws = await f.connect();
  expect(await ws.call("native.services.desktop.stop")).toEqual({ stopped: true });
  expect(await f.callHttp("desktop.stop")).toEqual({ stopped: true });
  expect((await f.callHttp("desktop.request", { op: "status" })).status.stopped).toBe(true);
  expect(
    (await f.callHttp("assistant.request", { op: "snapshot" })).snapshot.profile.setupComplete,
  ).toBe(false);
  expect(
    (await ws.call("assistant.request", { op: "snapshot" })).snapshot.profile.setupComplete,
  ).toBe(false);
  expect(
    (await ws.request("native.services.desktop.stop", { principal: "owner" })).error,
  ).toBeDefined();
  expect((await f.http("desktop.stop", { op: "resume" })).error).toBeDefined();
  const scoped = await ws.call("native.services.conversation.access.issue", {
    sessionId: f.session.sessionId,
  });
  expect((await f.http("desktop.stop", {}, scoped.token)).error).toBeDefined();
});
it("exposes only sanitized native desktop status to a current authenticated owner", async () => {
  const f = await fixture(),
    ws = await f.connect();
  const expected = { enabled: false, active: false, stopped: false };
  expect(await ws.call("native.services.desktop.status")).toEqual(expected);
  expect(await f.callHttp("desktop.status")).toEqual(expected);
  expect(
    (await ws.request("native.services.desktop.status", { op: "resume" })).error,
  ).toBeDefined();
  expect((await f.http("desktop.status", { principal: "owner" })).error).toBeDefined();
  const scoped = await ws.call("native.services.conversation.access.issue", {
    sessionId: f.session.sessionId,
  });
  expect((await f.http("desktop.status", {}, scoped.token)).error).toBeDefined();
  await f.store.revokeDevice(f.device.id);
  expect((await ws.request("native.services.desktop.status")).error).toBeDefined();
  expect((await f.http("desktop.status")).error).toBeDefined();
});
it("changes only canonical owner presence through finite authenticated native routes", async () => {
  const f = await fixture(),
    ws = await f.connect();
  const get = "native.services.assistant.presence.get",
    set = "native.services.assistant.presence.set";
  const initial = await ws.call(get);
  expect(initial).toMatchObject({ setupComplete: false });
  expect(
    Object.keys(initial).every((key) =>
      ["state", "choice", "setupComplete", "assistantName"].includes(key),
    ),
  ).toBe(true);
  expect(await ws.call(set, { state: "away" })).toMatchObject({
    state: "away",
    setupComplete: false,
  });
  expect((await f.callHttp("assistant.request", { op: "snapshot" })).snapshot.presence.state).toBe(
    "away",
  );
  expect(await f.callHttp(set, { state: "dnd" })).toMatchObject({
    state: "dnd",
    setupComplete: false,
  });
  for (const params of [
    { state: "idle" },
    { state: "present", principal: "owner" },
    { state: "present", projectId: f.project.id },
  ])
    expect((await ws.request(set, params)).error).toBeDefined();
  expect((await ws.request(get, { state: "away" })).error).toBeDefined();
  const scoped = await ws.call("native.services.conversation.access.issue", {
    sessionId: f.session.sessionId,
  });
  expect((await f.http(set, { state: "present" }, scoped.token)).error).toBeDefined();
  await f.store.revokeDevice(f.device.id);
  expect((await ws.request(set, { state: "present" })).error).toBeDefined();
  expect((await f.http(get)).error).toBeDefined();
});
it("finishes causal Voice tool proof over actual scoped HTTP before returning a conditional result envelope", async () => {
  // Keep this HTTP provenance fixture within the documented proof scan budget.
  const catalog = voiceTools.voiceToolCatalog().filter((tool) => tool.action === "tools.list");
  vi.spyOn(voiceTools, "voiceToolCatalog").mockReturnValue(catalog);
  const f = await fixture();
  const { thread } = await f.callHttp("assistant.request", { op: "threads.open" });
  const { message } = await f.callHttp("assistant.request", {
    op: "threads.append",
    threadId: thread.id,
    role: "user",
    via: "voice",
    text: "Synthetic owner turn for the isolated HTTP provenance test.",
    idempotencyKey: "causal-http-owner",
  });
  const { voiceContext } = await f.callHttp("assistant.request", {
    op: "voice.context.open",
    threadId: thread.id,
    ownerMessageId: message.id,
    generationKey: "http-generation",
    requestId: "http-context-open",
    seedMessageIds: [],
    contextProjectIds: [f.project.id],
    summaryUsed: false,
  });
  expect(voiceContext.status).toBe("known");
  const request = {
    threadId: thread.id,
    family: "conversation",
    action: "tools.list",
    input: {},
    requestId: "http-read",
    causalContextId: voiceContext.id,
  };
  const result = await f.callHttp("voice.tools.call", request);
  expect(result.voiceContext).toMatchObject({
    id: voiceContext.id,
    status: "known",
    projectIds: [f.project.id],
  });
  expect(result.voiceDisclosure).toMatchObject({
    contextId: voiceContext.id,
    requestId: "http-read",
    verified: true,
    projectIds: [],
  });
  expect(result.value).toBeDefined();
  expect(Object.keys(result).sort()).toEqual(["value", "voiceContext", "voiceDisclosure"]);
  const transcript = await f.callHttp("assistant.request", {
    op: "threads.messages",
    threadId: thread.id,
  });
  const annotated = transcript.messages.find((item: any) => item.id === message.id);
  expect(annotated.projectIds).toEqual([f.project.id]);
  expect(annotated.toolActions).toEqual([
    {
      id: result.voiceDisclosure.id,
      family: "conversation",
      action: "tools.list",
      status: "completed",
      createdAt: expect.any(Number),
    },
  ]);
  expect(Object.keys(annotated.toolActions[0]).sort()).toEqual([
    "action",
    "createdAt",
    "family",
    "id",
    "status",
  ]);
  const legacy = await f.callHttp("voice.tools.call", {
    threadId: thread.id,
    family: "conversation",
    action: "tools.list",
    input: {},
  });
  expect(legacy).not.toHaveProperty("voiceContext");
  expect(legacy).not.toHaveProperty("voiceDisclosure");
  const repeated = await f.http("voice.tools.call", request);
  expect(repeated.error).toBeDefined();
});
it("returns a verified current Voice disclosure without promoting an already unknown generation", async () => {
  // Keep this HTTP provenance fixture within the documented proof scan budget.
  const catalog = voiceTools.voiceToolCatalog().filter((tool) => tool.action === "tools.list");
  vi.spyOn(voiceTools, "voiceToolCatalog").mockReturnValue(catalog);
  const f = await fixture();
  // Global Room owns this synthetic voice turn and its owner-scoped catalog read.
  const { thread } = await f.callHttp("assistant.request", { op: "threads.open" });
  const { message } = await f.callHttp("assistant.request", {
    op: "threads.append",
    threadId: thread.id,
    role: "user",
    via: "voice",
    text: "Synthetic unknown-generation owner turn.",
    idempotencyKey: "unknown-http-owner",
  });
  const { voiceContext } = await f.callHttp("assistant.request", {
    op: "voice.context.open",
    threadId: thread.id,
    ownerMessageId: message.id,
    generationKey: "unknown-http-generation",
    requestId: "unknown-http-open",
    seedMessageIds: [],
    contextProjectIds: [f.project.id],
    summaryUsed: false,
  });
  await f.callHttp("assistant.request", {
    op: "voice.context.invalidate",
    id: voiceContext.id,
    requestId: "renderer-disclosure",
    reason: "unverified-tool",
  });
  const result = await f.callHttp("voice.tools.call", {
    threadId: thread.id,
    family: "conversation",
    action: "tools.list",
    input: {},
    requestId: "unknown-http-read",
    causalContextId: voiceContext.id,
  });
  expect(result.voiceContext.status).toBe("unknown");
  expect(result.voiceDisclosure).toMatchObject({
    verified: true,
    requestId: "unknown-http-read",
    projectIds: [],
  });
  const { voiceContext: current } = await f.callHttp("assistant.request", {
    op: "voice.context.get",
    id: voiceContext.id,
  });
  expect(current.status).toBe("unknown");
  const transcript = await f.callHttp("assistant.request", {
    op: "threads.messages",
    threadId: thread.id,
  });
  expect(transcript.messages.find((item: any) => item.id === message.id)).not.toHaveProperty(
    "toolActions",
  );
});

it("routes descriptions, real bound grants and terminal append through both transports without token-scope substitution", async () => {
  const f = await fixture(),
    ws = await f.connect();
  for (const kind of ["conversation", "runtimeLogs", "social"]) {
    expect(await ws.call(`native.services.${kind}.bridge.describe`)).toEqual(
      await f.callHttp(`${kind}.bridge.describe`),
    );
    const issued = await ws.call(`native.services.${kind}.access.issue`, {
      sessionId: f.session.sessionId,
    });
    expect(issued).toMatchObject({
      environmentId: f.store.environmentId,
      scope: { sessionId: f.session.sessionId, projectId: f.project.id, provider: "codex" },
    });
    expect(typeof issued.token).toBe("string");
    expect(
      (await f.http("native.services.social.native.status", {}, issued.token)).error,
    ).toBeDefined();
    expect(
      (
        await ws.request(`native.services.${kind}.access.issue`, {
          sessionId: f.session.sessionId,
          expectedScope: { ...issued.scope, projectId: "wrong-project" },
        })
      ).error.data.delivery,
    ).toBe("unknown");
  }
  const append = {
    cwd: f.projectPath,
    terminalId: "fixture-terminal",
    sequence: 0,
    data: Buffer.from("Türkçe log\n").toString("base64"),
    interrupted: false,
    closed: false,
  };
  expect(await ws.call("native.services.runtimeLogs.terminals.append", append)).toEqual({
    accepted: true,
  });
  expect(
    await f.callHttp("runtimeLogs.terminals.append", {
      ...append,
      sequence: 1,
      data: "",
      closed: true,
    }),
  ).toEqual({ accepted: true });
  expect(
    (
      await ws.request("native.services.conversation.desktop.authorize", {
        id: "missing",
        action: "ptyMobile.write",
        arbitrary: true,
      })
    ).error.code,
  ).toBe(RPC_ERROR_CODES.invalidParams);
});

it("keeps secret and SSH permission checks owner-bound across HTTP and WS contracts", async () => {
  const f = await fixture(),
    ws = await f.connect(),
    foreign = await f.connect(f.other.token);
  const relays = new Set<ConversationDesktopRelay>();
  const take = ConversationDesktopRelay.prototype.take;
  vi.spyOn(ConversationDesktopRelay.prototype, "take").mockImplementation(function (
    this: ConversationDesktopRelay,
    owner,
  ) {
    relays.add(this);
    return take.call(this, owner);
  });
  await ws.call("native.services.conversation.desktop.take");
  const relay = [...relays][0];
  const method = "native.services.conversation.desktop.authorize";
  for (const action of ["secrets.input.authorize", "servers.ssh.execute"]) {
    let fullAccess = true;
    let authorized = true;
    const pending = relay
      .call(
        action,
        {},
        f.projectPath,
        {
          kind: "session",
          projectId: f.project.id,
          sessionId: f.session.sessionId,
          provider: "codex",
        },
        () => authorized,
        () => fullAccess,
      )
      .catch((error: unknown) => error);
    const [request] = await ws.call("native.services.conversation.desktop.take");
    const params = {
      id: request.id,
      action: action === "servers.ssh.execute" ? "servers.ssh.execute.permission" : action,
    };
    const expected =
      action === "servers.ssh.execute"
        ? { authorized: true, fullAccess: true }
        : { authorized: true };
    expect(await ws.call(method, params)).toEqual(expected);
    expect(await f.callHttp(method, params)).toEqual(expected);
    expect(await foreign.call(method, params)).toEqual({ authorized: false });
    expect((await f.http(method, params, f.other.token)).result).toEqual({ authorized: false });
    expect((await ws.request(method, { ...params, fullAccess: true })).error.code).toBe(
      RPC_ERROR_CODES.invalidParams,
    );
    if (action === "servers.ssh.execute") {
      fullAccess = false;
      expect(await ws.call(method, params)).toEqual({ authorized: true, fullAccess: false });
      expect(await f.callHttp(method, params)).toEqual({ authorized: true, fullAccess: false });
    }
    authorized = false;
    expect(await ws.call(method, params)).toEqual({ authorized: false });
    expect(await f.callHttp(method, params)).toEqual({ authorized: false });
    await ws.call("native.services.conversation.desktop.finish", {
      id: request.id,
      result: { cancelled: true },
    });
    expect(await pending).toBeInstanceOf(Error);
  }
});

it("commits an actual >1MiB desktop completion once to its real owner-bound mailbox", async () => {
  const f = await fixture(),
    ws = await f.connect(),
    foreign = await f.connect(f.other.token);
  const observedRelays = new Set<ConversationDesktopRelay>();
  const take = ConversationDesktopRelay.prototype.take;
  vi.spyOn(ConversationDesktopRelay.prototype, "take").mockImplementation(function (
    this: ConversationDesktopRelay,
    owner,
  ) {
    observedRelays.add(this);
    return take.call(this, owner);
  });
  await ws.call("native.services.conversation.desktop.take");
  const relay = [...observedRelays][0];
  const pending = relay.call("ptyMobile.write", { fixture: "request" }, f.projectPath, {
    kind: "session",
    projectId: f.project.id,
    sessionId: f.session.sessionId,
    provider: "codex",
  });
  const [request] = await ws.call("native.services.conversation.desktop.take");
  expect(
    await foreign.call("native.services.conversation.desktop.authorize", {
      id: request.id,
      action: "ptyMobile.write",
    }),
  ).toEqual({ authorized: false });
  expect(
    (
      await foreign.request("native.services.conversation.desktop.finish", {
        id: request.id,
        result: "forged",
      })
    ).error.data.delivery,
  ).toBe("unknown");
  expect(
    await ws.call("native.services.conversation.desktop.authorize", {
      id: request.id,
      action: "ptyMobile.write",
    }),
  ).toEqual({ authorized: true });
  const result = { text: "ş".repeat(600000) },
    key = await stage(ws, "native.services.conversation.desktop.finish", {
      id: request.id,
      result,
    });
  const committed = await ws.call("native.services.upload.commit", key);
  expect(committed).toMatchObject({ state: "completed", result: { accepted: true } });
  expect(await pending).toEqual(result);
  expect(await ws.call("native.services.upload.commit", key)).toEqual(committed);
  expect(await f.callHttp("native.services.upload.status", key)).toEqual(committed);
});

it("stages an actual >1MiB formatter request and preserves its full bulk result without writing disk", async () => {
  const f = await fixture(),
    ws = await f.connect(),
    source = `const text =\n  "${"€".repeat(400000)}";\n`,
    path = join(f.projectPath, "formatted.js");
  const params = { command: "format_text_file", args: { path, source, cursorOffset: 7 } };
  const key = await stage(ws, "native.services.workspace.format", params);
  const committed = await ws.call("native.services.upload.commit", key);
  expect(committed).toMatchObject({ state: "completed", result: { cursorOffset: 7 } });
  expect(committed.result.formatted).toBe(source);
  expect(await ws.call("native.services.upload.status", key)).toEqual(committed);
  expect(await readFile(path, "utf8")).toBe("unchanged disk");
  const small = {
    command: "format_text_file",
    args: { path, source: 'const text = "Türkçe 😀";\n', cursorOffset: 2 },
  };
  expect(await f.callHttp("workspace.run", small)).toEqual(
    await ws.call("native.services.workspace.format", small),
  );
});

it("uses real owner enrollment/register/authority/reset services over WS with isolated in-memory credentials", async () => {
  const a = await fixture(),
    b = await fixture(),
    source = await a.connect(),
    authority = await b.connect();
  expect((await source.call("native.services.social.native.status")).authority).toBeNull();
  const enrollment = await source.call("native.services.social.native.enroll", {
    environmentId: b.store.environmentId,
  });
  const mapping = { [a.project.id]: b.project.id };
  expect(
    await authority.call("native.services.social.native.register", {
      environmentId: a.store.environmentId,
      endpoint: a.endpoint,
      token: enrollment.token,
      mapping,
    }),
  ).toMatchObject({ connected: true, mapping });
  expect(
    (
      await source.call("native.services.social.native.authority", {
        environmentId: b.store.environmentId,
        endpoint: b.endpoint,
        mapping,
      })
    ).authority,
  ).toEqual({ environmentId: b.store.environmentId, mapping });
  expect((await source.call("native.services.social.native.reset")).authority).toBeNull();
  expect(
    (await a.http("native.services.social.native.status", {}, enrollment.token)).error,
  ).toBeDefined();
});

it("preserves actual mailbox effects across upload cancellation and socket loss without replay", async () => {
  const f = await fixture(),
    ws = await f.connect();
  const observedRelays = new Set<ConversationDesktopRelay>();
  const take = ConversationDesktopRelay.prototype.take;
  vi.spyOn(ConversationDesktopRelay.prototype, "take").mockImplementation(function (
    this: ConversationDesktopRelay,
    owner,
  ) {
    observedRelays.add(this);
    return take.call(this, owner);
  });
  await ws.call("native.services.conversation.desktop.take");
  const relay = [...observedRelays][0];
  const principal = {
    kind: "session" as const,
    projectId: f.project.id,
    sessionId: f.session.sessionId,
    provider: "codex",
  };
  const first = relay.call("ptyMobile.write", {}, f.projectPath, principal);
  void first.catch(() => {});
  const [firstRequest] = await ws.call("native.services.conversation.desktop.take");
  const result = { text: "ş".repeat(600000) };
  const cancelledKey = await stage(ws, "native.services.conversation.desktop.finish", {
    id: firstRequest.id,
    result,
  });
  const cancelled = await ws.call("native.services.upload.cancel", cancelledKey);
  expect(cancelled.state).toBe("cancelled");
  expect(await ws.call("native.services.upload.commit", cancelledKey)).toEqual(cancelled);
  expect(
    await ws.call("native.services.conversation.desktop.authorize", {
      id: firstRequest.id,
      action: "ptyMobile.write",
    }),
  ).toEqual({ authorized: true });
  await f.callHttp("conversation.desktop.finish", {
    id: firstRequest.id,
    result: "explicit completion",
  });
  expect(await first).toBe("explicit completion");

  let release!: () => void, began!: () => void;
  const held = new Promise<void>((done) => {
      release = done;
    }),
    started = new Promise<void>((done) => {
      began = done;
    });
  cleanups.push(async () => {
    release();
  });
  const finish = ConversationDesktopRelay.prototype.finish;
  const finished = vi
    .spyOn(ConversationDesktopRelay.prototype, "finish")
    .mockImplementation(async function (
      this: ConversationDesktopRelay,
      ...args: Parameters<ConversationDesktopRelay["finish"]>
    ) {
      began();
      await held;
      return finish.apply(this, args);
    });
  const second = relay.call("ptyMobile.write", {}, f.projectPath, principal);
  void second.catch(() => {});
  const [request] = await ws.call("native.services.conversation.desktop.take");
  const key = await stage(ws, "native.services.conversation.desktop.finish", {
    id: request.id,
    result,
  });
  const commit = ws.request("native.services.upload.commit", key);
  const detached = expect(commit).rejects.toThrow("Closed");
  await started;
  ws.socket.terminate();
  await detached;
  const resumed = await f.connect();
  expect((await resumed.call("native.services.upload.status", key)).state).toBe("committing");
  expect((await resumed.call("native.services.upload.cancel", key)).state).toBe("committing");
  release();
  expect(await second).toEqual(result);
  expect(finished).toHaveBeenCalledTimes(1);
});
