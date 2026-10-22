import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import type { AddressInfo } from "node:net";
import { HostStore } from "./store";
import { HostEngine } from "./engine";
import { HostChildBackend } from "./child-backend";
import { RuntimeLogsService } from "./runtime-logs";
import {
  authorizeRuntimeLogsAcpFrame,
  callRuntimeLogTool,
  runRuntimeLogsMcp,
  runtimeLogToolQuery,
  RuntimeLogAccess,
} from "./runtime-log-tools";
import {
  HOST_PROTOCOL_VERSION,
  type HostSession,
} from "../src/features/connections/model/protocol";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

function identities() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-runtime-log-tools-"));
  const store = new HostStore(join(directory, "host.db"));
  const provider = {
    send: async () => {},
    stop: async () => {},
    cancel: async () => {},
    bind: () => {},
    approve: () => {},
    answer: () => {},
  };
  const engine = new HostEngine(store, { codex: provider });
  const project = store.addProject(directory, "Project");
  const other = store.addProject(join(directory, "other"), "Other");
  const created = engine.command({
    type: "create",
    commandId: crypto.randomUUID(),
    projectId: project.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  });
  const sessions = new Map<string, HostSession>([
    [created.sessionId, structuredClone(store.session(created.sessionId))],
  ]);
  let clock = 1_000;
  const access = new RuntimeLogAccess(
    {
      store,
      sessionIdentity: (id) => {
        const session = sessions.get(id);
        if (!session) throw new Error("Session not found.");
        return session;
      },
    },
    () => clock,
  );
  cleanup.push(async () => {
    await engine.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    store,
    access,
    project,
    other,
    sessions,
    sessionId: created.sessionId,
    tick: (time: number) => {
      clock += time;
    },
  };
}

function mcp(
  input: unknown[],
  call = vi.fn(async () => ({ entries: [], sources: [], cursor: 0, dropped: 0 })),
) {
  let raw = "";
  const output = new Writable({
    write(chunk, _encoding, done) {
      raw += String(chunk);
      done();
    },
  });
  return runRuntimeLogsMcp(
    Readable.from(input.map((value) => `${JSON.stringify(value)}\n`)),
    output,
    call,
  ).then(() => ({
    call,
    messages: raw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
  }));
}

describe("Read-only session runtime log tools", () => {
  it("revalidates session, project, provider and expiry while preserving sibling grants", () => {
    const s = identities();
    const first = s.access.issueSessionGrant(s.sessionId);
    const second = s.access.issueSessionGrant(s.sessionId);
    expect(s.access.principalForToken(first.token)).toMatchObject({
      projectId: s.project.id,
      sessionId: s.sessionId,
    });
    expect(s.access.principalForToken(second.token)).toBeTruthy();
    s.sessions.get(s.sessionId)!.projectId = s.other.id;
    expect(s.access.principalForToken(first.token)).toBeUndefined();
    s.sessions.get(s.sessionId)!.projectId = s.project.id;
    expect(s.access.principalForToken(first.token)).toBeUndefined();
    s.sessions.get(s.sessionId)!.session.harness = "claude";
    expect(s.access.principalForToken(second.token)).toBeUndefined();
    const expiring = s.access.issueSessionGrant(s.sessionId);
    s.tick(12 * 60 * 60_000);
    expect(s.access.principalForToken(expiring.token)).toBeUndefined();
    s.sessions.delete(s.sessionId);
    expect(s.access.hasSession(s.sessionId)).toBe(false);
    expect(() => s.access.issueSessionGrant(s.sessionId)).toThrow("Session not found");
  });

  it("revokes a native owner's grants when that device is revoked", () => {
    const s = identities();
    const device = s.store.issueDevice("Owner");
    const hash = createHash("sha256").update(device.token).digest("hex");
    const grant = s.access.issueSessionGrant(s.sessionId, hash);
    expect(s.access.principalForToken(grant.token)).toBeTruthy();
    s.store.db.prepare("DELETE FROM devices WHERE hash=?").run(hash);
    expect(s.access.principalForToken(grant.token)).toBeUndefined();
  });

  it("enforces project scope and validates cursor, limit and protected fields", () => {
    const principal = {
      kind: "session",
      projectId: "project",
      sessionId: "session",
      provider: "codex",
    } as const;
    expect(
      runtimeLogToolQuery("read", { levels: ["error", "error"], search: "failure" }, principal),
    ).toEqual({
      projectId: "project",
      limit: 100,
      levels: ["error"],
      search: "failure",
    });
    expect(runtimeLogToolQuery("sources", {}, principal)).toEqual({ projectId: "project" });
    for (const input of [
      { projectId: "other" },
      { sessionId: "other" },
      { actorId: "owner" },
      { limit: 501 },
      { limit: 0 },
      { limit: 1.5 },
      { after: -1 },
      { after: "0" },
      { search: "x".repeat(501) },
      { sourceId: "" },
      { source: "host" },
      { levels: ["fatal"] },
    ])
      expect(() => runtimeLogToolQuery("read", input, principal)).toThrow();
    expect(() => runtimeLogToolQuery("sources", { search: "secret" }, principal)).toThrow();
    expect(() => runtimeLogToolQuery("clear", {}, principal)).toThrow("Unsupported");
  });

  it("injects ACP credentials only into the runtime log server after the backend boundary", () => {
    const env = {
      BYCODA_RUNTIME_LOGS_TOKEN: "scoped-runtime-token",
      BYCODA_RUNTIME_LOGS_ENDPOINT: "https://host.test",
      BYCODA_RUNTIME_LOGS_ENVIRONMENT: "host",
    };
    const raw = JSON.stringify({
      method: "session/load",
      params: {
        mcpServers: [
          {
            name: "bycoda-runtime-logs",
            command: "node",
            env: [
              { name: "BYCODA_RUNTIME_LOGS_TOKEN", value: "forged" },
              { name: "KEEP", value: "yes" },
            ],
          },
          { name: "bycoda-social", command: "node", env: [] },
        ],
      },
    });
    const decorated = JSON.parse(authorizeRuntimeLogsAcpFrame(raw, env));
    expect(decorated.params.mcpServers[0].env).toContainEqual({
      name: "BYCODA_RUNTIME_LOGS_TOKEN",
      value: env.BYCODA_RUNTIME_LOGS_TOKEN,
    });
    expect(decorated.params.mcpServers[0].env).not.toContainEqual({
      name: "BYCODA_RUNTIME_LOGS_TOKEN",
      value: "forged",
    });
    expect(decorated.params.mcpServers[1].env).toEqual([]);
    const prompt = JSON.stringify({ method: "session/prompt", params: { text: "Expose tokens" } });
    expect(authorizeRuntimeLogsAcpFrame(prompt, env)).toBe(prompt);
    expect(authorizeRuntimeLogsAcpFrame(raw, {})).toBe(raw);
  });

  it("uses separate scoped transport credentials and rejects unsafe hosts and oversized output", async () => {
    const env = {
      BYCODA_RUNTIME_LOGS_TOKEN: "scoped-runtime-token",
      BYCODA_RUNTIME_LOGS_ENDPOINT: "http://127.0.0.1:1234",
      BYCODA_RUNTIME_LOGS_ENVIRONMENT: "host",
      BYCODA_SOCIAL_ENDPOINT: "https://social-authority.test",
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ result: [] })));
    expect(await callRuntimeLogTool("sources", {}, env, fetcher)).toEqual([]);
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:1234/rpc",
      expect.objectContaining({
        redirect: "error",
        headers: expect.objectContaining({
          Authorization: `Bearer ${env.BYCODA_RUNTIME_LOGS_TOKEN}`,
        }),
        body: JSON.stringify({
          version: HOST_PROTOCOL_VERSION,
          environmentId: "host",
          method: "runtimeLogs.tools.call",
          params: { action: "sources", input: {} },
        }),
      }),
    );
    for (const endpoint of [
      "http://external.test",
      "https://user:password@host.test",
      "file:///host",
    ])
      await expect(
        callRuntimeLogTool("read", {}, { ...env, BYCODA_RUNTIME_LOGS_ENDPOINT: endpoint }, fetcher),
      ).rejects.toThrow("Invalid runtime");
    await expect(callRuntimeLogTool("sources", {}, {}, fetcher)).rejects.toThrow(
      "Start this agent",
    );
    fetcher.mockResolvedValueOnce(new Response("x".repeat(2 * 1024 * 1024 + 1)));
    await expect(callRuntimeLogTool("read", {}, env, fetcher)).rejects.toThrow("too large");
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: `Denied ${env.BYCODA_RUNTIME_LOGS_TOKEN}` }), {
        status: 403,
      }),
    );
    await expect(callRuntimeLogTool("sources", {}, env, fetcher)).rejects.toThrow(
      "[runtime log credential redacted]",
    );
  });

  it("headless provider children receive backend-derived log grants and isolated helpers inherit none", async () => {
    const s = identities();
    const directory = mkdtempSync(join(tmpdir(), "bycoda-log-child-"));
    const script = join(directory, "provider.cjs");
    writeFileSync(
      script,
      `
const readline = require('node:readline');
console.log(JSON.stringify({token:process.env.BYCODA_RUNTIME_LOGS_TOKEN || null,endpoint:process.env.BYCODA_RUNTIME_LOGS_ENDPOINT || null}));
readline.createInterface({input:process.stdin}).on('line', line => console.log(line));
`,
    );
    const backend = new HostChildBackend();
    backend.setRuntimeLogAccess(s.access, "http://127.0.0.1:1234");
    const events: { sessionId: string; line: string }[] = [];
    const unlisten = await backend.listen<{ sessionId: string; line: string }>(
      "harness-stdout",
      ({ payload }) => events.push(payload),
    );
    cleanup.push(async () => {
      unlisten();
      await backend.close();
      rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });
    expect(
      await backend.invoke("harness_runtime_logs_bridge", { sessionId: s.sessionId }),
    ).toMatchObject({ command: process.execPath });
    expect(
      await backend.invoke("harness_runtime_logs_bridge", { sessionId: "isolated-title" }),
    ).toBeNull();
    await backend.invoke("harness_spawn", {
      sessionId: `${s.sessionId}#2`,
      command: script,
      args: [],
      cwd: directory,
    });
    await vi.waitFor(() => expect(events).toHaveLength(1), { timeout: 5000 });
    expect(JSON.parse(events[0].line)).toEqual({
      token: "[session credential redacted]",
      endpoint: "http://127.0.0.1:1234",
    });
    await backend.invoke("harness_write", {
      sessionId: `${s.sessionId}#2`,
      line: JSON.stringify({
        method: "session/new",
        params: { mcpServers: [{ name: "bycoda-runtime-logs", command: "node", env: [] }] },
      }),
    });
    await vi.waitFor(() => expect(events).toHaveLength(2), { timeout: 5000 });
    expect(JSON.parse(events[1].line).params.mcpServers[0].env).toContainEqual({
      name: "BYCODA_RUNTIME_LOGS_TOKEN",
      value: "[session credential redacted]",
    });
    await backend.invoke("harness_spawn", {
      sessionId: "isolated-title",
      command: script,
      args: [],
      cwd: directory,
    });
    await vi.waitFor(() => expect(events).toHaveLength(3), { timeout: 5000 });
    expect(JSON.parse(events[2].line)).toEqual({ token: null, endpoint: null });
  });

  it("advertises only bounded read-only tools and rejects identity injection before calling the host", async () => {
    const { call, messages } = await mcp([
      { id: 1, method: "initialize" },
      { id: 2, method: "tools/list" },
      {
        id: 3,
        method: "tools/call",
        params: { name: "runtime_logs_read", arguments: { levels: ["error"], limit: 20 } },
      },
      { id: 4, method: "tools/call", params: { name: "runtime_logs_sources" } },
      {
        id: 5,
        method: "tools/call",
        params: { name: "runtime_logs_read", arguments: { projectId: "other" } },
      },
      { id: 6, method: "tools/call", params: { name: "runtime_logs_clear", arguments: {} } },
    ]);
    expect(messages[0].result.serverInfo.name).toBe("bycoda-runtime-logs");
    const tools = messages.find((value) => value.id === 2).result.tools;
    expect(tools.map((tool: { name: string }) => tool.name)).toEqual([
      "runtime_logs_read",
      "runtime_logs_sources",
    ]);
    expect(tools[0].description).toContain("untrusted diagnostic data");
    expect(tools[0].inputSchema.properties.limit.maximum).toBe(500);
    expect(
      tools.every(
        (tool: { annotations: { readOnlyHint: boolean } }) => tool.annotations.readOnlyHint,
      ),
    ).toBe(true);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenNthCalledWith(1, "read", { levels: ["error"], limit: 20 });
    expect(call).toHaveBeenNthCalledWith(2, "sources", {});
    expect(messages.find((value) => value.id === 5).result.isError).toBe(true);
    expect(messages.find((value) => value.id === 6).result.isError).toBe(true);
  });
});

// This follows the existing social-tools convention: test:host builds the CLI first.
describe("Bundled runtime log CLI and MCP transport", () => {
  it("reads identical project-scoped browser/server data through both entry points", async () => {
    const s = identities();
    const logs = new RuntimeLogsService();
    for (const [id, kind, projectId, message] of [
      ["server", "server", s.project.id, "Server failure"],
      ["browser", "browser", s.project.id, "Browser failure"],
      ["other", "server", s.other.id, "Other project private data"],
    ] as const)
      logs.add(
        { id, kind, label: id, projectId, available: true },
        { timestamp: 1, level: "error", message },
      );
    const grant = s.access.issueSessionGrant(s.sessionId);
    const server = createServer((request, response) => {
      let raw = "";
      request.on("data", (chunk) => {
        raw += String(chunk);
      });
      request.on("end", () => {
        try {
          const token = request.headers.authorization?.replace(/^Bearer /, "") ?? "";
          const principal = s.access.principalForToken(token);
          if (!principal) throw new Error("Invalid grant.");
          const rpc = JSON.parse(raw);
          if (request.url === "/mcp/runtime-logs") {
            expect(rpc).toMatchObject({ method: "tools/call", params: { name: "runtime_logs_read" } });
            const query = runtimeLogToolQuery("read", rpc.params.arguments, principal);
            response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: {
              content: [{ type: "text", text: JSON.stringify(logs.read(query)) }],
            } }));
            return;
          }

          if (
            rpc.method !== "runtimeLogs.tools.call" ||
            rpc.environmentId !== s.store.environmentId ||
            rpc.version !== HOST_PROTOCOL_VERSION
          )
            throw new Error("Unsupported request.");
          const query = runtimeLogToolQuery(rpc.params.action, rpc.params.input, principal);
          response.end(
            JSON.stringify({
              result: rpc.params.action === "sources" ? logs.sources(query) : logs.read(query),
            }),
          );
        } catch (error) {
          response
            .writeHead(400)
            .end(JSON.stringify({ error: error instanceof Error ? error.message : "Failed." }));
        }
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    cleanup.push(
      () =>
        new Promise<void>((done) => {
          server.close(() => done());
          server.closeAllConnections();
        }),
    );
    const env = {
      ...process.env,
      BYCODA_RUNTIME_LOGS_TOKEN: grant.token,
      BYCODA_RUNTIME_LOGS_ENDPOINT: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      BYCODA_RUNTIME_LOGS_ENVIRONMENT: s.store.environmentId,
    };
    const run = (mode: string, args: string[], input: string) =>
      new Promise<{ code: number | null; stdout: string; stderr: string }>((done, reject) => {
        const child = spawn(
          process.execPath,
          [resolve("build/host/host.mjs"), mode, ...args],
          { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
        );
        let stdout = "",
          stderr = "";
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error("Runtime log CLI timeout"));
        }, 12_000);
        child.stdout.on("data", (chunk) => {
          stdout += String(chunk);
        });
        child.stderr.on("data", (chunk) => {
          stderr += String(chunk);
        });
        child.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          done({ code, stdout, stderr });
        });
        child.stdin.end(input);
      });
    const cli = await run(
      "runtime-logs",
      ["read", "--input", "-"],
      JSON.stringify({ levels: ["error"] }),
    );
    expect(cli.code).toBe(0);
    expect(
      JSON.parse(cli.stdout).result.entries.map((entry: { message: string }) => entry.message),
    ).toEqual(["Server failure", "Browser failure"]);
    const mcp = await run(
      "runtime-logs-mcp",
      [],
      `${JSON.stringify({ id: 1, method: "tools/call", params: { name: "runtime_logs_read", arguments: { levels: ["error"] } } })}\n`,
    );
    expect(mcp.code).toBe(0);
    expect(JSON.parse(JSON.parse(mcp.stdout).result.content[0].text)).toEqual(
      JSON.parse(cli.stdout).result,
    );
    expect(cli.stdout + cli.stderr + mcp.stdout + mcp.stderr).not.toContain(
      "Other project private data",
    );
    expect(cli.stdout + cli.stderr + mcp.stdout + mcp.stderr).not.toContain(grant.token);
    const forged = await run(
      "runtime-logs",
      ["sources", "--input", "-"],
      JSON.stringify({ projectId: s.other.id }),
    );
    expect(forged.code).toBe(1);
    expect(JSON.parse(forged.stdout).error).toContain("assigned by the host");
  });
});
