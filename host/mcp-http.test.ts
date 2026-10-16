import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { request } from "node:http";
import { HostStore } from "./store";
import { HostEngine } from "./engine";
import { createHostServer } from "./server";
import { McpTokens, MCP_GROUPS } from "./mcp-tokens";
import { mcpCatalog } from "./mcp-http";
import { conversationToolCatalog } from "./conversation-tools";
import { HOST_PROTOCOL_VERSION } from "../src/features/connections/model/protocol";
import { SOCIAL_TOOLS, socialToolName } from "../src/features/social/model/social";
import { SOCIAL_TOOL_SCHEMAS } from "./social-tools";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
  vi.unstubAllEnvs();
});

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-mcp-http-"));
  const desktopPath = join(dir, "desktop.db");
  vi.stubEnv("BYCODA_DESKTOP_DB", desktopPath);
  const desktop = new DatabaseSync(desktopPath);
  desktop.exec(
    "CREATE TABLE notes(id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',tags_json TEXT NOT NULL DEFAULT '[]',source_session_id TEXT,source_cwd TEXT,slug_pending INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)",
  );
  desktop.close();
  const store = new HostStore(join(dir, "host.db"));
  const project = store.addProject(dir, "MCP test");
  const foreign = store.addProject(join(dir, "foreign"), "Other");
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
  const server = createHostServer(engine, []);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const device = store.issueDevice("Owner");
  cleanup.push(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const tokens = new McpTokens(store);
  const grant = (scopes: object, projectId = project.id) =>
    tokens.create({
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
    return { status: res.status, body: (await res.json()) as any };
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
    return { status: res.status, body: (await res.json()) as any };
  };
  return { store, engine, project, foreign, server, tokens, grant, rpc, send, url };
}

describe("Streamable HTTP MCP", () => {
  it("negotiates stateless HTTP and serves the existing catalogs and schemas", async () => {
    const s = await setup();
    const { token } = s.grant({
      conversation: ["read", "write"],
      social: ["read", "write"],
      "runtime-logs": ["read"],
    });
    expect(
      (await s.send(token, "initialize", { protocolVersion: "2025-06-18" })).body.result
        .protocolVersion,
    ).toBe("2025-06-18");
    expect((await s.send(token)).body.result.tools).toHaveLength(
      MCP_GROUPS.flatMap(mcpCatalog).length,
    );
    expect(mcpCatalog("conversation")).toEqual(conversationToolCatalog());
    for (const tool of SOCIAL_TOOLS) {
      expect(
        mcpCatalog("social").find((entry) => entry.name === socialToolName(tool))?.inputSchema,
      ).toEqual(SOCIAL_TOOL_SCHEMAS[tool]);
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
      const { token } = s.grant({ [group]: [mode] });
      const listed = (await s.send(token)).body.result.tools;
      expect(listed.map((tool: any) => tool.name)).toEqual(
        mcpCatalog(group)
          .filter((tool) => tool.annotations.readOnlyHint === (mode === "read"))
          .map((tool) => tool.name),
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
    const rows = JSON.stringify(s.store.db.prepare("SELECT * FROM mcp_tokens").all());
    expect(rows).not.toContain(token);
    expect((await s.rpc("mcp.tokens.list")).body.result.tokens[0]).not.toHaveProperty("token");
    expect((await s.rpc("mcp.tokens.create", {}, token)).status).toBe(401);
    expect((await s.send(token)).status).toBe(200);
    expect((await s.rpc("mcp.tokens.revoke", { id })).body.result.revoked).toBe(true);
    expect((await s.send(token)).status).toBe(401);
    const live = s.grant({ "runtime-logs": ["read"] });
    const future = new McpTokens(s.store, () => live.expiresAt);
    expect(future.get(live.token)).toBeUndefined();
    expect(new McpTokens(s.store).get(live.token)?.id).toBe(live.id);
  });

  it("rejects rebinding, unsafe origins, URL credentials, bad protocol and oversized requests", async () => {
    const s = await setup();
    const { token } = s.grant({ "runtime-logs": ["read"] });
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
    const { token } = s.grant({ conversation: ["read", "write"], social: ["read", "write"] });
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
    const created = s.engine.command({
      type: "create",
      commandId: "mcp-test",
      projectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const sessionToken = s.server.conversationAccess.issueSessionGrant(created.sessionId).token;
    const direct = await s.rpc(
      "conversation.tools.call",
      { action: "tools.list", input: {} },
      sessionToken,
    );
    const http = await s.send(sessionToken, "tools/call", { name: "conversation_tools_list" });
    expect(JSON.parse(http.body.result.content[0].text)).toEqual(direct.body.result);
    expect((await s.send(sessionToken, "tools/list", {}, "/mcp/social")).status).toBe(401);
    const logToken = s.server.runtimeLogAccess.issueSessionGrant(created.sessionId).token;
    const logDirect = await s.rpc(
      "runtimeLogs.tools.call",
      { action: "sources", input: {} },
      logToken,
    );
    const logHttp = await s.send(logToken, "tools/call", { name: "runtime_logs_sources" });
    expect(JSON.parse(logHttp.body.result.content[0].text)).toEqual(logDirect.body.result);
    const socialToken = s.server.social.issueSessionGrant(created.sessionId).token;
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
    const { token } = s.grant({ "runtime-logs": ["read"] });
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

  it("preserves social account grants and rejects protected identity and owner sends", async () => {
    const s = await setup();
    const owner = { kind: "owner" as const, actorId: "test-owner", provider: "owner" };
    const account = (await s.server.social.call(owner, "accounts.create", {
      name: "Private",
      platform: "x",
      accountType: "member",
      projectIds: [s.foreign.id],
    })) as { id: string };
    const { token } = s.grant({ social: ["read", "write"], conversation: ["read", "write"] });
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
    const { token } = s.grant({ conversation: ["read", "write"] });
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
    const foreign = s.grant({ conversation: ["read"] }, s.foreign.id);
    const denied = await s.send(foreign.token, "tools/call", {
      name: "conversation_notes_read",
      arguments: { id: "external-note" },
    });
    expect(denied.body.result.isError).toBe(true);
  });

  it("rechecks revocation after a yielding body read and bounds chunked uploads", async () => {
    const s = await setup();
    const grant = s.grant({ "runtime-logs": ["read"] });
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
      setTimeout(() => {
        s.tokens.revoke(grant.id);
        req.end('"id":1,"method":"tools/list"}');
      }, 30);
    });
    expect(status).toBe(401);
    const next = s.grant({ "runtime-logs": ["read"] });
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
