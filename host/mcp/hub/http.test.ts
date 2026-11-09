import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ExternalMcpRoute, EXT_ROUTE_PREFIX } from "./http";
import { McpHub } from "./hub";

const SESSION = "a".repeat(43);
const EXTERNAL = "b".repeat(43);
const FIXTURE = fileURLToPath(new URL("./fixtures/fake-mcp-server.mjs", import.meta.url));
const dirs: string[] = [];
let server: Server | undefined;
let hub: McpHub | undefined;

afterEach(async () => {
  hub?.shutdown();
  hub = undefined;
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    server.closeAllConnections();
  });
  server = undefined;
  // Child processes may still hold their cwd for a moment after shutdown.
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

async function start() {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-mcp-ext-"));
  dirs.push(dir);
  hub = new McpHub({
    dataDir: dir,
    inventory: async () => [
      {
        name: "fake-a",
        source: "claude",
        sources: ["claude"],
        aliases: [{ provider: "claude", name: "fake-a" }],
        kind: "stdio",
        command: process.execPath,
        args: [FIXTURE],
        env: {},
      },
    ],
  });
  const route = new ExternalMcpRoute(hub, {
    principalForToken: async (token) =>
      token === SESSION ? { kind: "session", sessionId: "session-1", projectId: "p" } : undefined,
    // Children must not keep the temp directory locked; homedir is the default cwd.
    projectCwd: async () => undefined,
  });
  server = createServer((request, response) => {
    const name = request.url!.slice(EXT_ROUTE_PREFIX.length);
    void route.handle(request, response, name);
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return `http://127.0.0.1:${port}${EXT_ROUTE_PREFIX}`;
}

const headers = (token?: string) => ({
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});
const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });

describe("hubbed MCP route", () => {
  it("accepts the session token and answers from the hub", async () => {
    const base = await start();
    const response = await fetch(`${base}fake-a`, {
      method: "POST",
      headers: headers(SESSION),
      body,
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { result: { tools: { name: string }[] } };
    expect(payload.result.tools[0].name).toBe("echo");
  });

  it("rejects external project tokens and missing credentials before dispatch", async () => {
    const base = await start();
    for (const token of [EXTERNAL, undefined]) {
      const response = await fetch(`${base}fake-a`, {
        method: "POST",
        headers: headers(token),
        body,
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("x-bycoda-auth-stage")).toBe("before-dispatch");
    }
  });

  it("answers unknown names with 404 only after authorization", async () => {
    const base = await start();
    const unknown = await fetch(`${base}missing`, {
      method: "POST",
      headers: headers(SESSION),
      body,
    });
    expect(unknown.status).toBe(404);
    const anonymous = await fetch(`${base}missing`, { method: "POST", headers: headers(), body });
    expect(anonymous.status).toBe(401);
  });

  it("keeps the group transport rules: POST only, JSON, and both accept types", async () => {
    const base = await start();
    expect((await fetch(`${base}fake-a`, { headers: headers(SESSION) })).status).toBe(405);
    expect(
      (
        await fetch(`${base}fake-a`, {
          method: "POST",
          headers: { ...headers(SESSION), "Content-Type": "text/plain" },
          body,
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await fetch(`${base}fake-a`, {
          method: "POST",
          headers: { ...headers(SESSION), Accept: "application/json" },
          body,
        })
      ).status,
    ).toBe(406);
  });

  it("returns 202 for notifications and never runs a child for them", async () => {
    const base = await start();
    const response = await fetch(`${base}fake-a`, {
      method: "POST",
      headers: headers(SESSION),
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(response.status).toBe(202);
    expect((await hub!.status()).running).toBe(0);
  });
});
