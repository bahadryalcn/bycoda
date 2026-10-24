import { describe, expect, it } from "vitest";
import { Readable, Writable } from "node:stream";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HostStore } from "./store";
import { HostEngine } from "./engine";
import { createHostServer } from "./server";
import { McpTokens } from "./mcp-tokens";
import { runMcpProxy } from "./mcp-proxy";

describe("stdio HTTP MCP proxy", () => {
  it("forwards all groups with external and session tokens through both packaged entry points", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bycoda-mcp-proxy-"));
    const store = new HostStore(join(dir, "host.db"));
    const project = store.addProject(dir, "Proxy proof");
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
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const endpoint = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
    const tokens = new McpTokens(store);
    const grant = tokens.create({
      name: "Proxy test",
      projectId: project.id,
      scopes: { conversation: ["read"], "runtime-logs": ["read"], social: ["read"] },
      expiresAt: Date.now() + 60_000,
    });
    const session = engine.command({
      type: "create",
      commandId: "proxy-proof",
      projectId: project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const sessionTokens = {
      conversation: server.conversationAccess.issueSessionGrant(session.sessionId).token,
      "runtime-logs": server.runtimeLogAccess.issueSessionGrant(session.sessionId).token,
      social: server.social.issueSessionGrant(session.sessionId).token,
    };
    try {
      for (const entry of ["host.mjs", "bycoda-host.mjs"]) {
        for (const [scope, tool] of [
          ["conversation", "conversation_tools_list"],
          ["runtime-logs", "runtime_logs_sources"],
          ["social", "social_accounts_list"],
        ] as const) {
          for (const external of [true, false]) {
            const token = external ? grant.token : sessionTokens[scope];
            const prefix = external
              ? "BYCODA_MCP"
              : `BYCODA_${scope.replaceAll("-", "_").toUpperCase()}`;
            const env = Object.fromEntries(
              Object.entries(process.env).filter(([key]) => !key.startsWith("BYCODA_")),
            );
            const result = await new Promise<{
              code: number | null;
              stdout: string;
              stderr: string;
            }>((done, reject) => {
              const child = spawn(
                process.execPath,
                [resolve("build/host", entry), `${scope}-mcp`],
                {
                  env: { ...env, [`${prefix}_TOKEN`]: token, [`${prefix}_ENDPOINT`]: endpoint },
                  windowsHide: true,
                  stdio: ["pipe", "pipe", "pipe"],
                },
              );
              let stdout = "",
                stderr = "";
              const timer = setTimeout(() => {
                child.kill();
                reject(new Error("Proxy timeout"));
              }, 10000);
              child.stdout.on("data", (c) => {
                stdout += c;
              });
              child.stderr.on("data", (c) => {
                stderr += c;
              });
              child.on("error", reject);
              child.on("close", (code) => {
                clearTimeout(timer);
                done({ code, stdout, stderr });
              });
              child.stdin.end(
                [
                  {
                    jsonrpc: "2.0",
                    id: 1,
                    method: "initialize",
                    params: { protocolVersion: "2025-06-18" },
                  },
                  { jsonrpc: "2.0", method: "notifications/initialized" },
                  { jsonrpc: "2.0", id: 2, method: "tools/list" },
                  {
                    jsonrpc: "2.0",
                    id: "call",
                    method: "tools/call",
                    params: { name: tool, arguments: {} },
                  },
                ]
                  .map((m) => JSON.stringify(m))
                  .join("\n") + "\n",
              );
            });
            expect(result.code, result.stderr).toBe(0);
            expect(result.stdout + result.stderr).not.toContain(token);
            const messages = result.stdout
              .trim()
              .split("\n")
              .map((m) => JSON.parse(m));
            expect(messages).toHaveLength(3);
            const byId = new Map(messages.map((message) => [message.id, message]));
            expect([...byId.keys()]).toEqual(expect.arrayContaining([1, 2, "call"]));
            expect(byId.get(1).result.serverInfo.name).toBe(`bycoda-${scope}`);
            expect(byId.get(2).result.tools.some((t: { name: string }) => t.name === tool)).toBe(
              true,
            );
            expect(byId.get("call").result.isError).toBeUndefined();
          }
        }
      }
    } finally {
      tokens.revoke(grant.id);
      await new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      });
      await engine.close();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe endpoints, bounds input and hides transport diagnostics", async () => {
    const output = () => {
      let text = "";
      return {
        stream: new Writable({
          write(c, _e, done) {
            text += c;
            done();
          },
        }),
        read: () => text,
      };
    };
    const env = { BYCODA_MCP_TOKEN: "secret", BYCODA_MCP_ENDPOINT: "http://127.0.0.1:1234" };
    for (const endpoint of [
      "http://remote.test",
      "http://secret@127.0.0.1",
      "http://127.0.0.1?token=secret",
    ])
      await expect(
        runMcpProxy("social", Readable.from([]), output().stream, {
          ...env,
          BYCODA_MCP_ENDPOINT: endpoint,
        }),
      ).rejects.toThrow("loopback");
    await expect(
      runMcpProxy("social", Readable.from(["x".repeat(1024 * 1024 + 1)]), output().stream, env),
    ).rejects.toThrow("too large");
    const result = output();
    await runMcpProxy(
      "social",
      Readable.from(['bad\n{"jsonrpc":"2.0","id":7,"method":"ping"}\n']),
      result.stream,
      env,
      async () => {
        throw new Error("secret transport diagnostic");
      },
    );
    expect(result.read()).not.toContain("secret");
    expect(result.read()).toContain('"id":7');
    expect(result.read()).toContain('"code":-32700');
  });
});
