import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { request } from "node:http";
import { HostStore } from "./store";
import { HostEngine } from "./engine";
import { createHostServer } from "./server";
import { McpTokens, MCP_GROUPS } from "./mcp-tokens";
import { mcpCatalog, externalMcpCatalog } from "./mcp-http";
import { conversationToolCatalog } from "./conversation-tools";
import { HOST_PROTOCOL_VERSION } from "../src/features/connections/model/protocol";
import { SOCIAL_TOOLS, socialToolName } from "../src/features/social/model/social";
import { socialToolCatalog } from "./social-tools";
import { ConversationDesktopRelay } from "./conversation-tools";
import { SharedBrowser } from "./shared-browser";
import { ConversationWorkspaceTools } from "./conversation-workspace-tools";
import { parseLocalSessionLink } from "../src/features/sessions/model/localSessionReference";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
  vi.unstubAllEnvs();
});

async function setup(providers: Parameters<typeof createHostServer>[1] = []) {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-mcp-http-"));
  const desktopPath = join(dir, "desktop.db");
  vi.stubEnv("BYCODA_DESKTOP_DB", desktopPath);
  const desktop = new DatabaseSync(desktopPath);
  desktop.exec(
    "CREATE TABLE notes(id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',tags_json TEXT NOT NULL DEFAULT '[]',source_session_id TEXT,source_cwd TEXT,slug_pending INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)",
  );
  desktop.close();
  const store = new HostStore(join(dir, "host.db"));
  const project = await store.addProject(dir, "MCP test");
  const foreign = await store.addProject(join(dir, "foreign"), "Other");
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
  const server = await createHostServer(engine, providers);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const device = await store.issueDevice("Owner");
  cleanup.push(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    await server.closeResources();
    await engine.close();
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const tokens = new McpTokens(store);
  const grant = async (scopes: object, projectId = project.id) =>
    await tokens.create({
      name: "Test",
      projectId,
      scopes,
      expiresAt: Date.now() + 60_000,
    });
  const rpc = async (method: string, params: object = {}, token = device.token) => {
    const res = await fetch(`${url}/rpc`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        version: HOST_PROTOCOL_VERSION,
        environmentId: store.environmentId,
        method,
        params,
      }),
    });
    return { status: res.status, headers: res.headers, body: (await res.json()) as any };
  };
  const send = async (
    token: string,
    method = "tools/list",
    params: object = {},
    route = "/mcp",
    headers: Record<string, string> = {},
  ) => {
    const res = await fetch(url + route, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return { status: res.status, headers: res.headers, body: (await res.json()) as any };
  };
  return { store, engine, project, foreign, server, tokens, grant, rpc, send, url, desktopPath };
}

it("keeps bounded managed discovery inside external grants and preserves complete session discovery", async () => {
  const s = await setup();
  const grant = await s.grant({ conversation: ["read"] });
  const search = await s.send(grant.token, "tools/call", {
    name: "conversation_tools_search",
    arguments: { family: "browser", limit: 2 },
  });
  const external = JSON.parse(search.body.result.content[0].text);
  expect(external.tools).toEqual([]);
  const hidden = await s.send(grant.token, "tools/call", {
    name: "conversation_tools_describe",
    arguments: { ids: ["conversation:browser.open"] },
  });
  const hiddenDescription = JSON.parse(JSON.parse(hidden.body.result.content[0].text).content);
  expect(hiddenDescription.tools).toEqual([
    {
      id: "conversation:browser.open",
      supported: false,
      capability: { state: "unsupported", evidence: null },
    },
  ]);
  const created = await s.engine.command({
    type: "create",
    workspaceMode: "current",
    commandId: "discovery-test",
    projectId: s.project.id,
    harness: "codex",
    model: "fixture",
    runtimeMode: "supervised",
  });
  const token = (await s.server.conversationAccess.issueSessionGrant(created.sessionId)).token;
  const rpc = await s.rpc(
    "conversation.tools.call",
    { action: "tools.search", input: { family: "browser", limit: 2 } },
    token,
  );
  expect(rpc.body.result.tools).toHaveLength(2);
  expect(rpc.body.result.nextCursor).toBeTruthy();
  expect(rpc.body.result.tools.every((tool: any) => tool.capability === "unknown")).toBe(true);
  const status = await s.send(token, "tools/call", {
    name: "conversation_tools_status",
    arguments: { ids: ["conversation:browser.preview"] },
  });
  expect(JSON.parse(status.body.result.content[0].text).tools[0].capability.state).toBe("unknown");
});

it("composes a scoped mobile preview and mounted project panel through the real MCP route", async () => {
  const s = await setup();
  const created = await s.engine.command({
    type: "create",
    workspaceMode: "current",
    commandId: "preview-test",
    projectId: s.project.id,
    harness: "codex",
    model: "fixture",
    runtimeMode: "supervised",
  });
  const token = (await s.server.conversationAccess.issueSessionGrant(created.sessionId)).token;
  let viewport = { width: 1280, height: 720 };
  const browser = vi
    .spyOn(SharedBrowser.prototype, "dispatchForSession")
    .mockImplementation(async (method, params) => {
      if (method === "browser.resize")
        viewport = { width: Number(params.width), height: Number(params.height) };
      return {
        open: true,
        controlling: true,
        leaseId: "own-lease",
        url: "http://127.0.0.1:3000/",
        viewport,
        ...(method === "browser.frame"
          ? { data: "aGVsbG8=", mimeType: "image/png", ...viewport }
          : {}),
      };
    });
  const ui = vi.spyOn(ConversationDesktopRelay.prototype, "call").mockResolvedValue({
    open: true,
    panels: [{ id: "panel", tab: "browser", machine: "project", mounted: true }],
  });
  const args = {
    requestId: "same-preview",
    url: "http://127.0.0.1:3000/",
    width: 390,
    height: 844,
  };
  const first = await s.send(token, "tools/call", {
    name: "conversation_browser_preview",
    arguments: args,
  });
  const content = first.body.result.content;
  expect(first.body.result.isError).toBeUndefined();
  expect(JSON.parse(content[0].text)).toMatchObject({
    execution: { state: "succeeded" },
    presentation: { state: "mounted" },
    evidence: { frame: { width: 390, height: 844 } },
  });
  expect(content[0].text).not.toContain("aGVsbG8=");
  expect(content[1]).toEqual({ type: "image", data: "aGVsbG8=", mimeType: "image/png" });
  expect(ui).toHaveBeenCalledWith(
    "ui.tools.open",
    { tab: "browser", projectHost: true },
    s.project.cwd,
    expect.objectContaining({ sessionId: created.sessionId }),
    expect.any(Function),
  );
  const before = browser.mock.calls.length;
  await s.send(token, "tools/call", { name: "conversation_browser_preview", arguments: args });
  expect(browser).toHaveBeenCalledTimes(before);
  expect(
    browser.mock.calls.every(
      ([, params]) => params.projectId === s.project.id && params.sessionId === created.sessionId,
    ),
  ).toBe(true);
});

it("returns the same verified Host references through scoped RPC and external MCP while preserving read authority", async () => {
  const s = await setup();
  const created = await s.engine.command({
    type: "create",
    workspaceMode: "current",
    commandId: "reference-test",
    projectId: s.project.id,
    harness: "codex",
    model: "fixture",
    runtimeMode: "supervised",
  });
  const snapshot = await s.store.session(created.sessionId);
  snapshot.revision += 1;
  snapshot.session.title = "Title [escaped]";
  snapshot.session.blocks = [
    { id: "turn-one", role: "user", text: "U".repeat(7000) },
    { id: "private", role: "reasoning", text: "private evidence" },
    { id: "answer", role: "assistant", text: "A".repeat(7000) },
  ];
  await s.store.save(snapshot, { type: "test" });
  const scoped = (await s.server.conversationAccess.issueSessionGrant(created.sessionId)).token;
  const external = (await s.grant({ conversation: ["read"] })).token;
  const listing = (
    await s.rpc("conversation.tools.call", { action: "sessions.list", input: {} }, scoped)
  ).body.result;
  const entry = listing.sessions.find((row: any) => row.id === created.sessionId);
  expect(parseLocalSessionLink(entry.link)).toEqual({
    locator: {
      kind: "host",
      environmentId: s.store.environmentId,
      sessionId: created.sessionId,
    },
  });
  const externalList = await s.send(external, "tools/call", {
    name: "conversation_sessions_list",
    arguments: {},
  });
  expect(
    JSON.parse(externalList.body.result.content[0].text).sessions.find(
      (row: any) => row.id === created.sessionId,
    ).link,
  ).toBe(entry.link);
  for (const token of [scoped, external]) {
    const reply = await s.send(token, "tools/call", {
      name: "conversation_sessions_read",
      arguments: { sessionId: created.sessionId, maxChars: 200, limit: 1 },
    });
    const page = JSON.parse(reply.body.result.content[0].text);
    expect(page.link).toBe(entry.link);
    expect(parseLocalSessionLink(page.turns[0].link)?.turnId).toBe("turn-one");
    expect(page.turns[0].user.text).toHaveLength(200);
    expect(JSON.stringify(page)).not.toContain("private evidence");
    const denied = await s.send(token, "tools/call", {
      name: "conversation_sessions_send",
      arguments: { sessionId: created.sessionId, prompt: "Not authorized" },
    });
    expect(denied.body.result?.isError ?? !!denied.body.error).toBe(true);
  }
  const foreign = (await s.grant({ conversation: ["read"] }, s.foreign.id)).token;
  const denied = await s.send(foreign, "tools/call", {
    name: "conversation_sessions_read",
    arguments: { sessionId: created.sessionId },
  });
  expect(denied.body.result.isError).toBe(true);
});

it("returns Native owner references from the mixed external catalog without migrating sessions", async () => {
  const s = await setup(["codex"]);
  const db = new DatabaseSync(s.desktopPath);
  try {
    db.exec(
      "CREATE TABLE sessions(id TEXT PRIMARY KEY,cwd TEXT,harness TEXT,model TEXT,model_settings TEXT,provider_session_id TEXT,runtime_mode TEXT,title TEXT,blocks_json TEXT,created_at INTEGER,updated_at INTEGER,has_user_message INTEGER DEFAULT 1,is_draft INTEGER DEFAULT 0); CREATE TABLE native_authority_identity(id INTEGER PRIMARY KEY,source_store_id TEXT,source_profile_id TEXT); INSERT INTO native_authority_identity VALUES(1,'native-store','native-profile')",
    );
    db.prepare(
      "INSERT INTO sessions(id,cwd,harness,model,runtime_mode,title,blocks_json,created_at,updated_at) VALUES(?,?,'codex','fixture','supervised',?,?,1,1)",
    ).run(
      "native-target",
      s.project.cwd,
      "Native title",
      JSON.stringify([{ id: "native-turn", role: "user", text: "Read without migration" }]),
    );
    const { token } = await s.grant({ conversation: ["read"] });
    const list = await s.send(token, "tools/call", {
      name: "conversation_sessions_list",
      arguments: {},
    });
    const rows = JSON.parse(list.body.result.content[0].text).sessions;
    expect(parseLocalSessionLink(rows[0].link)?.locator).toEqual({
      kind: "native",
      sourceStoreId: "native-store",
      sourceProfileId: "native-profile",
      sessionId: "native-target",
    });
    const reply = await s.send(token, "tools/call", {
      name: "conversation_sessions_read",
      arguments: { sessionId: "native-target" },
    });
    const page = JSON.parse(reply.body.result.content[0].text);
    expect(page.link).toBe(rows[0].link);
    expect(parseLocalSessionLink(page.turns[0].link)?.turnId).toBe("native-turn");
    expect(await s.store.sessionAuthority("native-target")).toBeUndefined();
    expect(db.prepare("SELECT title FROM sessions WHERE id='native-target'").get()?.title).toBe(
      "Native title",
    );
  } finally {
    db.close();
  }
});

it("rechecks owner authority after token creation preparation without blocking revocation", async () => {
  const s = await setup();
  const owner = await s.store.issueDevice("Revoked MCP owner");
  const original = McpTokens.prototype.create;
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const create = vi.spyOn(McpTokens.prototype, "create").mockImplementation(async function (input) {
    entered();
    await gate;
    return await original.call(this, input);
  });
  const pending = s.rpc(
    "mcp.tokens.create",
    {
      name: "Must not issue",
      projectId: s.project.id,
      scopes: { conversation: ["read"] },
      expiresAt: Date.now() + 60_000,
    },
    owner.token,
  );
  try {
    await started;
    await s.store.revokeToken(owner.token);
    release();
    const response = await pending;
    expect(response.status).toBe(401);
    expect(response.body.error).toMatch(/authoriz|revoked/i);
    expect(await s.tokens.list()).toEqual([]);
  } finally {
    release();
    await pending;
    create.mockRestore();
  }
});

describe("Streamable HTTP MCP", () => {
  it("marks only pre-dispatch rejection as safe to renew and preserves ambiguous post-commit 401", async () => {
    const s = await setup();
    const rejected = await s.send("x".repeat(43), "tools/list", {}, "/mcp/conversation");
    expect(rejected.status).toBe(401);
    expect(rejected.headers.get("X-Bycoda-Auth-Stage")).toBe("before-dispatch");
    const grant = await s.grant({ conversation: ["read", "write"] });
    const originalCall = ConversationWorkspaceTools.prototype.call;
    const originalGet = McpTokens.prototype.get;
    let committed = false;
    const call = vi
      .spyOn(ConversationWorkspaceTools.prototype, "call")
      .mockImplementation(async function (...args) {
        const result = await originalCall.apply(this, args);
        if (args[0] === "notes.create") committed = true;
        return result;
      });
    const get = vi.spyOn(McpTokens.prototype, "get").mockImplementation(async function (token) {
      if (committed && token === grant.token) return undefined;
      return await originalGet.call(this, token);
    });
    try {
      const result = await s.send(
        grant.token,
        "tools/call",
        {
          name: "conversation_notes_create",
          arguments: {
            id: "committed-before-auth-loss",
            title: "Committed",
            body: "Do not replay",
          },
        },
        "/mcp/conversation",
      );
      expect(committed).toBe(true);
      expect(result.status).toBe(401);
      expect(result.headers.get("X-Bycoda-Auth-Stage")).toBeNull();
      expect(call).toHaveBeenCalledTimes(1);
      const db = new DatabaseSync(s.desktopPath);
      try {
        expect(
          db.prepare("SELECT body FROM notes WHERE id = ?").get("committed-before-auth-loss"),
        ).toEqual({ body: "Do not replay" });
      } finally {
        db.close();
      }
    } finally {
      call.mockRestore();
      get.mockRestore();
    }
  });
  it("accepts escaped editor saves for a session while keeping external request limits", async () => {
    const s = await setup();
    const created = await s.engine.command({
      type: "create",
      workspaceMode: "current",
      commandId: "large-editor-save",
      projectId: s.project.id,
      harness: "codex",
      model: "test",
      runtimeMode: "supervised",
    });
    const token = (await s.server.conversationAccess.issueSessionGrant(created.sessionId)).token;
    writeFileSync(join(s.project.cwd, "large.txt"), "");
    const snapshot = JSON.parse(
      (
        await s.send(token, "tools/call", {
          name: "conversation_files_read",
          arguments: { path: "large.txt" },
        })
      ).body.result.content[0].text,
    );
    const content = "\n".repeat(600000);
    const params = {
      name: "conversation_files_write",
      arguments: { path: "large.txt", expectedHash: snapshot.hash, content },
    };
    const saved = await s.send(token, "tools/call", params);
    expect(saved.status).toBe(200);
    expect(saved.body.result.isError).toBeUndefined();
    expect(JSON.parse(saved.body.result.content[0].text).saved).toBe(true);
    expect(readFileSync(join(s.project.cwd, "large.txt"), "utf8")).toBe(content);
    const external = await s.grant({ conversation: ["write"] });
    expect((await s.send(external.token, "tools/call", params)).status).toBe(413);
  });
  it("uses the shared annotation image adapter over session HTTP MCP", async () => {
    const s = await setup();
    const created = await s.engine.command({
      type: "create",
      workspaceMode: "current",
      commandId: "annotation-mcp",
      projectId: s.project.id,
      harness: "codex",
      model: "fixture",
      runtimeMode: "supervised",
    });
    const token = (await s.server.conversationAccess.issueSessionGrant(created.sessionId)).token;
    const data = Buffer.alloc(64 * 1024, "a").toString("base64");
    const dispatch = vi.spyOn(SharedBrowser.prototype, "dispatchForSession").mockResolvedValue({
      annotationId: "selection",
      selection: {
        sessionId: created.sessionId,
        projectId: s.project.id,
        trust: "untrusted-page-data",
        element: { text: "Save" },
        limitations: ["Private fields masked"],
        screenshot: { mimeType: "image/jpeg", data, width: 1280, height: 720 },
      },
    });
    try {
      for (const action of ["select", "read"]) {
        const result = await s.send(
          token,
          "tools/call",
          {
            name: `conversation_browser_annotation_${action}`,
            arguments: {
              leaseId: "lease",
              navigationId: "navigation",
              annotationId: "selection",
              ...(action === "select" ? { x: 50, y: 35 } : {}),
            },
          },
          "/mcp/conversation",
        );
        expect(result.body.result.isError).not.toBe(true);
        const content = result.body.result.content;
        expect(content[1]).toEqual({ type: "image", mimeType: "image/jpeg", data });
        expect(content[0].text.length).toBeLessThan(1000);
        expect(content[0].text).not.toContain(data);
        expect(JSON.parse(content[0].text)).toMatchObject({
          selection: { trust: "untrusted-page-data", limitations: ["Private fields masked"] },
        });
      }
      expect(dispatch).toHaveBeenCalledWith(
        "browser.annotation.select",
        expect.objectContaining({ sessionId: created.sessionId, projectId: s.project.id }),
        token,
      );
    } finally {
      dispatch.mockRestore();
    }
  });
  it("negotiates stateless HTTP and serves the existing catalogs and schemas", async () => {
    const s = await setup();
    const grant = await s.grant({
      conversation: ["read", "write"],
      social: ["read", "write"],
      "runtime-logs": ["read"],
    });
    const { token } = grant;
    expect(
      (await s.send(token, "initialize", { protocolVersion: "2025-06-18" })).body.result
        .protocolVersion,
    ).toBe("2025-06-18");
    expect((await s.send(token)).body.result.tools).toHaveLength(
      MCP_GROUPS.flatMap((group) => externalMcpCatalog(group, grant)).length,
    );
    expect(mcpCatalog("conversation")).toEqual(conversationToolCatalog());
    for (const tool of SOCIAL_TOOLS) {
      expect(
        mcpCatalog("social").find((entry) => entry.name === socialToolName(tool))?.inputSchema,
      ).toEqual(socialToolCatalog().find((entry) => entry.action === tool)?.inputSchema);
    }
    expect(
      (await s.send(token, "tools/list", {}, "/mcp/social")).body.result.tools.every((tool: any) =>
        tool.name.startsWith("social_"),
      ),
    ).toBe(true);
    expect(
      (await s.send(token, "tools/list", {}, "/mcp?scope=runtime-logs")).body.result.tools,
    ).toHaveLength(2);
    expect(
      (await s.send(token, "tools/call", { name: "runtime_logs_sources", arguments: {} })).body
        .result.isError,
    ).toBeUndefined();
  });

  it.each(MCP_GROUPS)("enforces independent read/write scopes for %s", async (group) => {
    const s = await setup();
    for (const mode of ["read", "write"] as const) {
      const grant = await s.grant({ [group]: [mode] });
      const { token } = grant;
      const listed = (await s.send(token)).body.result.tools;
      expect(listed.map((tool: any) => tool.name)).toEqual(
        externalMcpCatalog(group, grant).map((tool) => tool.name),
      );
      const denied = mcpCatalog(group).find(
        (tool) => tool.annotations.readOnlyHint !== (mode === "read"),
      );
      if (denied)
        expect((await s.send(token, "tools/call", { name: denied.name })).body.result.isError).toBe(
          true,
        );
      const other = MCP_GROUPS.find((value) => value !== group)!;
      expect((await s.send(token, "tools/list", {}, `/mcp/${other}`)).status).toBe(401);
    }
  });

  it.each([["read"], ["write"], ["read", "write"]] as const)(
    "advertises only external project capabilities for grants %j",
    async (...modes) => {
      const s = await setup();
      const grant = await s.grant({ conversation: modes });
      const tools = (await s.send(grant.token, "tools/list", {}, "/mcp/conversation")).body.result
        .tools;
      const names = tools.map((tool: any) => tool.name);
      for (const forbidden of [
        "skills_search",
        "skills_read",
        "ui_workspace_list",
        "ui_tools_open",
        "devices_list",
        "tasks_list",
        "automations_create",
        "inbox_list",
        "inbox_comment",
        "inbox_review",
        "inbox_prAction",
      ])
        expect(names).not.toContain(`conversation_${forbidden}`);
      expect(
        tools.every((tool: any) =>
          tool.annotations.readOnlyHint
            ? modes.includes("read" as never)
            : modes.includes("write" as never),
        ),
      ).toBe(true);
      if (modes.includes("read" as never)) {
        expect(names).toContain("conversation_notes_list");
        expect(names).toContain("conversation_sessions_list");
        const nested = (
          await s.send(grant.token, "tools/call", {
            name: "conversation_tools_list",
            arguments: {},
          })
        ).body;
        const nestedTools = JSON.parse(nested.result.content[0].text).tools;
        expect(nestedTools.map((tool: any) => tool.name)).toEqual(names);
        const sessions = (
          await s.send(grant.token, "tools/call", {
            name: "conversation_sessions_list",
            arguments: {},
          })
        ).body;
        expect(sessions.result.isError).toBeUndefined();
      }
      if (modes.includes("write" as never)) expect(names).toContain("conversation_notes_create");
      const refused = (
        await s.send(grant.token, "tools/call", {
          name: "conversation_skills_search",
          arguments: { query: "review" },
        })
      ).body;
      expect(refused.result.isError).toBe(true);
    },
  );

  it("persists hashes only, supports owner RPC lifecycle, revocation and expiry across store instances", async () => {
    const s = await setup();
    const created = await s.rpc("mcp.tokens.create", {
      name: "External",
      projectId: s.project.id,
      scopes: { "runtime-logs": ["read"] },
      expiresAt: Date.now() + 10000,
    });
    const { token, id } = created.body.result;
    expect(created.status).toBe(200);
    const rows = JSON.stringify(await s.store.db.prepare("SELECT * FROM mcp_tokens").all());
    expect(rows).not.toContain(token);
    expect((await s.rpc("mcp.tokens.list")).body.result.tokens[0]).not.toHaveProperty("token");
    expect((await s.rpc("mcp.tokens.create", {}, token)).status).toBe(401);
    expect((await s.send(token)).status).toBe(200);
    expect((await s.rpc("mcp.tokens.revoke", { id })).body.result.revoked).toBe(true);
    expect((await s.send(token)).status).toBe(401);
    const live = await s.grant({ "runtime-logs": ["read"] });
    const future = new McpTokens(s.store, () => live.expiresAt);
    expect(await future.get(live.token)).toBeUndefined();
    expect((await new McpTokens(s.store).get(live.token))?.id).toBe(live.id);
  });

  it("rejects rebinding, unsafe origins, URL credentials, bad protocol and oversized requests", async () => {
    const s = await setup();
    const { token } = await s.grant({ "runtime-logs": ["read"] });
    expect(
      (await s.send(token, "ping", {}, "/mcp", { Origin: "https://attacker.invalid" })).status,
    ).toBe(403);
    // node:http preserves the hostile Host header (fetch implementations may rewrite it).
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        s.url + "/mcp",
        { method: "POST", headers: { Host: "attacker.invalid", Authorization: `Bearer ${token}` } },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode!));
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
    expect((await s.send(token, "ping", {}, "/mcp?token=secret")).status).toBe(400);
    expect((await s.send(token, "ping", {}, "/mcp/social?scope=conversation")).status).toBe(400);
    expect(
      (await s.send(token, "ping", {}, "/mcp", { "MCP-Protocol-Version": "bad" })).status,
    ).toBe(400);
    expect((await s.send(token, "ping", { text: "x".repeat(1024 * 1024) })).status).toBe(413);
  });

  it("blocks session context and owner actions, restricts project identity and keeps stdio RPC alive", async () => {
    const s = await setup();
    const { token } = await s.grant({ conversation: ["read", "write"], social: ["read", "write"] });
    for (const name of [
      "conversation_ui_tools_open",
      "conversation_inbox_comment",
      "conversation_inbox_review",
      "conversation_inbox_prAction",
      "social_replies_send",
      "social_messages_send",
      "social_comments_send",
      "social_campaigns_schedule",
    ]) {
      const reply = (await s.send(token, "tools/call", { name, arguments: {} })).body;
      expect(reply.result?.isError ?? !!reply.error).toBe(true);
    }
    expect(
      (
        await s.send(token, "tools/call", {
          name: "conversation_sessions_list",
          arguments: { projectId: s.foreign.id },
        })
      ).body.result.isError,
    ).toBe(true);
    expect(
      (
        await s.send(token, "tools/call", {
          name: "conversation_sessions_read",
          arguments: { sessionId: "foreign" },
        })
      ).body.result.isError,
    ).toBe(true);
    expect(
      (await s.send(token, "tools/call", { name: "social_accounts_list", arguments: {} })).body
        .result.isError,
    ).toBeUndefined();
    // The exact existing session grant and stdio RPC path also work via HTTP.
    const created = await s.engine.command({
      type: "create",
      workspaceMode: "current",
      commandId: "mcp-test",
      projectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const sessionToken = (await s.server.conversationAccess.issueSessionGrant(created.sessionId))
      .token;
    expect(
      (await s.send(sessionToken, "tools/list", {}, "/mcp/conversation")).body.result.tools.map(
        (tool: any) => tool.name,
      ),
    ).toEqual(conversationToolCatalog().map((tool) => tool.name));
    const direct = await s.rpc(
      "conversation.tools.call",
      { action: "tools.list", input: {} },
      sessionToken,
    );
    const http = await s.send(sessionToken, "tools/call", { name: "conversation_tools_list" });
    expect(JSON.parse(http.body.result.content[0].text)).toEqual(direct.body.result);
    expect((await s.send(sessionToken, "tools/list", {}, "/mcp/social")).status).toBe(401);
    const logToken = (await s.server.runtimeLogAccess.issueSessionGrant(created.sessionId)).token;
    const logDirect = await s.rpc(
      "runtimeLogs.tools.call",
      { action: "sources", input: {} },
      logToken,
    );
    const logHttp = await s.send(logToken, "tools/call", { name: "runtime_logs_sources" });
    expect(JSON.parse(logHttp.body.result.content[0].text)).toEqual(logDirect.body.result);
    const socialToken = (await s.server.social.issueSessionGrant(created.sessionId)).token;
    const socialDirect = await s.rpc(
      "social.tools.call",
      { action: "accounts.list", input: {} },
      socialToken,
    );
    const socialHttp = await s.send(socialToken, "tools/call", { name: "social_accounts_list" });
    expect(JSON.parse(socialHttp.body.result.content[0].text)).toEqual(socialDirect.body.result);
  });

  it("bounds request rate and handles notifications without executing tools", async () => {
    const s = await setup();
    const { token } = await s.grant({ "runtime-logs": ["read"] });
    const notification = await fetch(s.url + "/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(notification.status).toBe(202);
    for (let i = 0; i < 239; i++) expect((await s.send(token, "ping")).status).toBe(200);
    expect((await s.send(token, "ping")).status).toBe(429);
  });

  it("limits requests per credential and does not count rejected probes", async () => {
    const s = await setup();
    const { token } = await s.grant({ "runtime-logs": ["read"] });
    const other = await s.grant({ "runtime-logs": ["read"] });
    for (let i = 0; i < 300; i++) {
      const probe = await fetch(s.url + "/mcp", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(probe.status).toBe(405);
    }
    for (let i = 0; i < 240; i++) expect((await s.send(token, "ping")).status).toBe(200);
    const limited = await s.send(token, "ping");
    expect(limited.status).toBe(429);
    expect((await s.send(other.token, "ping")).status).toBe(200);
  });

  it("preserves social account grants and rejects protected identity and owner sends", async () => {
    const s = await setup();
    const owner = { kind: "owner" as const, actorId: "test-owner", provider: "owner" };
    const account = (await s.server.social.call(owner, "accounts.create", {
      name: "Private",
      platform: "x",
      accountType: "member",
      projectIds: [s.foreign.id],
    })) as { id: string };
    const { token } = await s.grant({ social: ["read", "write"], conversation: ["read", "write"] });
    const call = async (name: string, args: object) =>
      (await s.send(token, "tools/call", { name, arguments: args })).body.result;
    expect(JSON.parse((await call("social_accounts_list", {})).content[0].text)).toEqual([]);
    expect((await call("social_capabilities_get", { accountId: account.id })).isError).toBe(true);
    expect((await call("social_accounts_list", { actorId: "owner" })).isError).toBe(true);
    const send = await call("social_replies_send", { id: "already-approved-draft" });
    expect(send.isError).toBe(true);
    expect(send.content[0].text).toMatch(/Owner approval/);
    const ui = await call("conversation_ui_tools_open", { tab: "logs", placement: "right" });
    expect(ui.isError).toBe(true);
    expect(ui.content[0].text).toMatch(/session/);
    expect(JSON.stringify(ui)).not.toContain(token);
    // A token cannot grow its own scope through the original host RPC.
    expect((await s.rpc("mcp.tokens.revoke", { id: "any" }, token)).status).toBe(401);
  });

  it("uses the existing project note service for external writes and reads", async () => {
    const s = await setup();
    const { token } = await s.grant({ conversation: ["read", "write"] });
    const created = await s.send(token, "tools/call", {
      name: "conversation_notes_create",
      arguments: { id: "external-note", title: "HTTP", body: "Project-scoped note" },
    });
    expect(created.body.result.isError, JSON.stringify(created.body)).toBeUndefined();
    const read = await s.send(token, "tools/call", {
      name: "conversation_notes_read",
      arguments: { id: "external-note" },
    });
    expect(JSON.parse(read.body.result.content[0].text).body).toBe("Project-scoped note");
    const foreign = await s.grant({ conversation: ["read"] }, s.foreign.id);
    const denied = await s.send(foreign.token, "tools/call", {
      name: "conversation_notes_read",
      arguments: { id: "external-note" },
    });
    expect(denied.body.result.isError).toBe(true);
  });

  it("rechecks revocation after a yielding body read and bounds chunked uploads", async () => {
    const s = await setup();
    const grant = await s.grant({ "runtime-logs": ["read"] });
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        s.url + "/mcp",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${grant.token}`,
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode!));
        },
      );
      req.on("error", reject);
      req.flushHeaders();
      req.write('{"jsonrpc":"2.0",');
      setTimeout(async () => {
        await s.tokens.revoke(grant.id);
        req.end('"id":1,"method":"tools/list"}');
      }, 30);
    });
    expect(status).toBe(401);
    const next = await s.grant({ "runtime-logs": ["read"] });
    const oversized = await new Promise<number>((resolve, reject) => {
      const req = request(
        s.url + "/mcp",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${next.token}`,
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode!));
        },
      );
      req.on("error", reject);
      req.write("x".repeat(1024 * 1024));
      req.end("x");
    });
    expect(oversized).toBe(413);
  });
});
