import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { withCrewTools } from "../../crews/crew-identity";
import { HubExternalMcpTools, type ExternalMcpContext } from "./external-tools";
import { McpHub } from "./hub";
import type { InventoryDefinition } from "./inventory";
import type { McpLoadingPolicy } from "./load-policy";

const FIXTURE = fileURLToPath(new URL("./fixtures/annotated-mcp-server.mjs", import.meta.url));
const dirs: string[] = [];
const hubs: McpHub[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-mcp-ext-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const hub of hubs.splice(0)) hub.shutdown();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const stdio = (
  name: string,
  dir: string,
  source: "claude" | "claude-project" = "claude",
): InventoryDefinition => ({
  name,
  source,
  sources: [source],
  aliases: [{ provider: "claude", name }],
  kind: "stdio",
  command: process.execPath,
  args: [FIXTURE],
  env: { FAKE_MCP_START_LOG: join(dir, `${name}.starts`) },
});

const startCount = (dir: string, name: string) => {
  const file = join(dir, `${name}.starts`);
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").length : 0;
};

const onDemand: McpLoadingPolicy = { version: 1, mode: "onDemand", direct: [] };

const setup = (
  defs: (dir: string) => InventoryDefinition[],
  policy: () => Promise<McpLoadingPolicy> = async () => onDemand,
  extra: Partial<ConstructorParameters<typeof HubExternalMcpTools>[0]> = {},
) => {
  const dir = tempDir();
  const all = defs(dir);
  const hub = new McpHub({
    dataDir: dir,
    inventory: async () => all,
    files: {
      claudeConfig: join(dir, "no.json"),
      pluginsDir: join(dir, "no"),
      codexConfig: join(dir, "c.toml"),
    },
    accountDirs: async () => ({ claude: [], codex: [] }),
    policy,
  });
  hubs.push(hub);
  return { dir, hub, tools: new HubExternalMcpTools({ hub, ...extra }) };
};
const ctx = (extra: Partial<ExternalMcpContext> = {}): ExternalMcpContext => ({
  sessionId: "s1#2",
  projectId: "p1",
  ...extra,
});
const callInput = (tool: string, requestId = "r1", extra = {}) => ({
  server: "ann",
  tool,
  arguments: {},
  requestId,
  ...extra,
});

describe("McpHub on-demand publication and peek", () => {
  it("omits on-demand servers from servers but keeps native copies disabled", async () => {
    const { hub } = setup(
      (dir) => [stdio("ann", dir), stdio("kept", dir)],
      async () => ({ version: 1, mode: "onDemand", direct: ["kept"] }),
    );
    const published = await hub.publication("http://127.0.0.1:1");
    expect(published.servers.map((server) => server.name)).toEqual(["kept"]);
    expect(published.disable.claude.sort()).toEqual(["ann", "kept"]);
  });

  it("always publishes every server", async () => {
    const { hub } = setup(
      (dir) => [stdio("ann", dir)],
      async () => ({ version: 1, mode: "always", direct: [] }),
    );
    expect((await hub.publication("http://127.0.0.1:1")).servers).toHaveLength(1);
  });

  it("resetPublications makes the next launch see a changed policy", async () => {
    let policy: McpLoadingPolicy = onDemand;
    const { hub } = setup(
      (dir) => [stdio("ann", dir)],
      async () => policy,
    );
    const url = "http://127.0.0.1:1/mcp/conversation";
    const first = (await hub.externalMcp(url)) as { externalMcp: { servers: unknown[] } };
    expect(first.externalMcp.servers).toHaveLength(0);
    policy = { version: 1, mode: "always", direct: [] };
    hub.resetPublications();
    const second = (await hub.externalMcp(url)) as { externalMcp: { servers: unknown[] } };
    expect(second.externalMcp.servers).toHaveLength(1);
  });

  it("peek never spawns and reads the cache after one real start", async () => {
    const { dir, hub, tools } = setup((d) => [stdio("ann", d)]);
    expect(await hub.peek("ann")).toBeUndefined();
    expect(await hub.peek("missing")).toBeUndefined();
    expect(startCount(dir, "ann")).toBe(0);
    expect((await tools.list(ctx(), {})).servers[0]).toMatchObject({
      state: "unknown",
      toolCount: null,
    });
    expect(startCount(dir, "ann")).toBe(0);
    await tools.describe(ctx(), { server: "ann" });
    expect(startCount(dir, "ann")).toBe(1);
    const peek = await hub.peek("ann");
    expect(peek?.serverInfo?.name).toBe("annotated");
    expect(peek?.tools).toHaveLength(5);
    expect(startCount(dir, "ann")).toBe(1);
  });

  it("request returns a timeout error at its deadline", async () => {
    const { hub } = setup((dir) => [stdio("ann", dir)]);
    const reply = await hub.request(
      "ann",
      "s1",
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "hang", arguments: {} } },
      undefined,
      150,
    );
    expect(reply?.error?.message).toMatch(/timed out/);
  });
});

describe("HubExternalMcpTools", () => {
  it("lists, describes and truncates", async () => {
    const { tools } = setup((dir) => [stdio("ann", dir), stdio("other", dir, "claude-project")]);
    const listed = await tools.list(ctx(), {});
    expect(listed.servers.map((s) => [s.name, s.scope, s.direct, s.auth])).toEqual([
      ["ann", "user", false, "none"],
      ["other", "project", false, "none"],
    ]);
    expect((await tools.list(ctx(), { query: "oth" })).servers).toHaveLength(1);
    const server = await tools.describe(ctx(), { server: "ann" });
    expect(server).toMatchObject({ summary: "Annotated test server.", toolCount: 5 });
    const big = await tools.describe(ctx(), { server: "ann", tool: "big" });
    expect(big).toMatchObject({ schemaTruncated: true });
    expect((big as { schemaText: string }).schemaText.length).toBeLessThanOrEqual(16 * 1024);
    await expect(tools.describe(ctx(), { server: "ann", tool: "nope" })).rejects.toThrow();
  });

  it("classifies by annotations, treating unknown and destructive as write", async () => {
    const { tools } = setup((dir) => [stdio("ann", dir)]);
    expect(await tools.classify(ctx(), "ann", "look")).toBe("read");
    expect(await tools.classify(ctx(), "ann", "mutate")).toBe("write");
    expect(await tools.classify(ctx(), "ann", "risky")).toBe("write");
    expect(await tools.classify(ctx(), "ann", "unknown")).toBe("write");
  });

  it("intersects with the crew allowlist", async () => {
    const { dir, tools } = setup((d) => [stdio("ann", d), stdio("other", d)]);
    const allowed = ctx({
      modelSettings: withCrewTools({}, { tools: { preset: "custom", mcpServers: ["other"] } }),
    });
    expect((await tools.list(allowed, {})).servers.map((s) => s.name)).toEqual(["other"]);
    await expect(tools.call(allowed, callInput("look"))).rejects.toThrow(/Unknown MCP server/);
    await expect(tools.describe(allowed, { server: "ann" })).rejects.toThrow();
    expect(startCount(dir, "ann")).toBe(0);
    expect((await tools.list(ctx(), {})).servers).toHaveLength(2);
  });

  it("calls, truncates long text and reports omitted parts", async () => {
    const { tools } = setup((dir) => [stdio("ann", dir)]);
    const ok = await tools.call(ctx(), callInput("look"));
    expect(ok).toMatchObject({ isError: false, truncated: false });
    const big = await tools.call(ctx(), callInput("big", "r2"));
    expect(big.truncated).toBe(true);
    expect([...big.text].length).toBeLessThanOrEqual(32_000);
    expect(big.omittedParts).toBe(1);
  });

  it("is idempotent per requestId and rejects a changed input", async () => {
    const { dir, tools } = setup((d) => [stdio("ann", d)]);
    const a = await tools.call(ctx(), callInput("look", "same"));
    const b = await tools.call(ctx({ sessionId: "s1#9" }), callInput("look", "same"));
    expect(b).toEqual(a);
    await expect(tools.call(ctx(), callInput("mutate", "same"))).rejects.toThrow(/requestId/);
    expect(startCount(dir, "ann")).toBe(1);
  });

  it("times out a hanging call at the requested deadline", async () => {
    const { tools } = setup((dir) => [stdio("ann", dir)]);
    const result = await tools.call(ctx(), callInput("hang", "h", { timeoutSeconds: 1 }));
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/timed out/);
  });

  it("scopes perSession servers by session id with the #n suffix stripped", async () => {
    const { hub, tools } = setup((dir) => [stdio("ann", dir)]);
    await tools.call(ctx({ sessionId: "s1#1" }), callInput("look", "a"));
    await tools.call(ctx({ sessionId: "s1#2" }), callInput("look", "b"));
    await tools.call(ctx({ sessionId: "s2" }), callInput("look", "c"));
    expect((await hub.status()).running).toBe(2);
  });

  it("lists http servers with auth state and uses the httpAuth hook", async () => {
    const http: InventoryDefinition = {
      name: "web",
      source: "claude",
      sources: ["claude"],
      aliases: [],
      kind: "http",
      url: "https://mcp.example.test/mcp",
    };
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      if (!new Headers(init.headers).has("Authorization")) return new Response("", { status: 401 });
      const body = JSON.parse(init.body as string);
      if (body.id === undefined) return new Response("", { status: 202 });
      const result =
        body.method === "tools/list"
          ? { tools: [{ name: "t", annotations: { readOnlyHint: true } }] }
          : { protocolVersion: "2025-06-18", serverInfo: { name: "web" } };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    let token: string | undefined;
    const { tools } = setup(() => [http], undefined, {
      fetch: fakeFetch,
      httpAuth: async () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    });
    expect((await tools.list(ctx(), {})).servers[0].auth).toBe("none");
    await expect(tools.describe(ctx(), { server: "web" })).rejects.toThrow(/sign-in/);
    expect((await tools.list(ctx(), {})).servers[0].auth).toBe("oauth-required");
    token = "tok";
    expect((await tools.list(ctx(), {})).servers[0].auth).toBe("oauth-signed-in");
    expect(await tools.classify(ctx(), "web", "t")).toBe("read");
    expect((await tools.list(ctx(), {})).servers[0]).toMatchObject({
      state: "cached",
      toolCount: 1,
    });
  });

  it("keeps project HTTP headers private, case-insensitive, and isolated by project", async () => {
    const http: InventoryDefinition = {
      name: "cloudflare",
      source: "claude",
      sources: ["claude"],
      aliases: [
        { provider: "claude", name: "cloudflare" },
        { provider: "codex", name: "cloudflare" },
      ],
      kind: "http",
      url: "https://example.test/mcp",
      headers: { Authorization: "Bearer provider-config" },
    };
    const calls: (string | null)[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      expect(init.redirect).toBe("error");
      calls.push(new Headers(init.headers).get("authorization"));
      const body = JSON.parse(init.body as string);
      if (body.id === undefined) return new Response("", { status: 202 });
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: body.method === "tools/list" ? { tools: [{ name: "list" }] } : {},
      });
    }) as typeof fetch;
    const first = tempDir();
    const second = tempDir();
    const values = new Map<string, string>();
    const hub = new McpHub({
      dataDir: first,
      inventory: async () => [
        http,
        { ...http, name: "cloudflare-project", url: "https://second.example.test/mcp" },
      ],
      files: {
        claudeConfig: join(first, "none.json"),
        pluginsDir: join(first, "none"),
        codexConfig: join(first, "none.toml"),
      },
      accountDirs: async () => ({ claude: [], codex: [] }),
      policy: async () => ({ version: 1, mode: "always", direct: [] }),
      projectCredentialValues: {
        get: async (ref) => values.get(ref),
        set: async (ref, value) => {
          values.set(ref, value);
        },
        delete: async (ref) => {
          values.delete(ref);
        },
      },
    });
    hubs.push(hub);
    const tools = new HubExternalMcpTools({ hub, fetch: fakeFetch });
    expect(
      await hub.setProjectCredentials(first, http.name, { authorization: "Bearer first" }),
    ).toEqual({ kind: "http", configured: true });
    expect(
      await hub.setProjectCredentials(second, http.name, { Authorization: "Bearer second" }),
    ).toEqual({ kind: "http", configured: true });
    expect(await hub.publication("http://127.0.0.1:4000", first)).toEqual({
      servers: [],
      disable: { claude: ["cloudflare"], codex: ["cloudflare"], opencode: [] },
    });
    for (const [cwd, token] of [
      [first, "first"],
      [second, "second"],
    ]) {
      calls.length = 0;
      await tools.describe(ctx({ cwd }), { server: http.name });
      expect(calls).toHaveLength(3);
      expect(calls).toEqual(Array(3).fill(`Bearer ${token}`));
    }
    expect(await hub.clearProjectCredentials(first, http.name)).toEqual({
      kind: "http",
      configured: false,
    });
    expect(await hub.projectCredentialStatus(second, http.name)).toEqual({
      kind: "http",
      configured: true,
    });
    expect((await hub.publication("http://127.0.0.1:4000", first)).servers).toHaveLength(2);
  });
});
