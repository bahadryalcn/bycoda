import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpHub } from "./hub";
import type { InventoryDefinition } from "./inventory";

const FIXTURE = fileURLToPath(new URL("./fixtures/fake-mcp-server.mjs", import.meta.url));
const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-mcp-hub-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

it("manages Hub servers at machine and project scope without provider configuration", async () => {
  const machine = tempDir();
  const project = tempDir();
  const other = tempDir();
  const secrets = new Map<string, string>();
  const hub = new McpHub({
    dataDir: machine,
    inventory: async () => [],
    policy: async () => ({ version: 1, mode: "always", direct: [] }),
    projectCredentialValues: {
      get: async (key) => secrets.get(key),
      set: async (key, value) => {
        secrets.set(key, value);
      },
      delete: async (key) => {
        secrets.delete(key);
      },
    },
  });
  const authorize = vi.fn(async () => {});
  const name = "service";
  const config = { url: "https://one.example/mcp" };
  const added = await hub.manageServer({ action: "add", name, config }, undefined, authorize);
  if (!("revision" in added)) throw new Error("Expected a server.");
  const [machineEntry] = await hub.inventory();
  expect(machineEntry).toMatchObject({
    kind: "http",
    url: config.url,
    aliases: [],
    managed: { name, scope: "user" },
  });
  expect((await hub.inventory(other))[0]?.name).toBe(machineEntry.name);
  expect((await hub.publication("http://host", other)).servers).toEqual([]);
  await hub.setProjectCredentials(undefined, machineEntry.name, { Authorization: "machine" });
  await hub.setProjectCredentials(project, machineEntry.name, { Authorization: "project" });
  expect((await hub.projectCredentialsFor(project, machineEntry))?.values).toEqual({
    authorization: "project",
  });
  expect((await hub.projectCredentialsFor(other, machineEntry))?.values).toEqual({
    authorization: "machine",
  });
  await hub.manageServer(
    { action: "add", name, config: { command: "fixture", args: ["--stdio"] } },
    project,
    authorize,
  );
  expect(await hub.inventory(project)).toEqual([
    expect.objectContaining({
      kind: "stdio",
      command: "fixture",
      managed: expect.objectContaining({ scope: "project" }),
    }),
  ]);
  expect((await hub.publication("http://host", project)).servers).toEqual([
    expect.objectContaining({ kind: "stdio", mode: "perSession" }),
  ]);
  const disabled = await hub.manageServer(
    { action: "setEnabled", name, revision: added.revision, enabled: false },
    undefined,
    authorize,
  );
  if (!("revision" in disabled)) throw new Error("Expected a server.");
  expect(await hub.inventory(other)).toEqual([]);
  expect((await hub.inventory(other, true))[0]?.managed?.enabled).toBe(false);
  await expect(
    hub.manageServer({ action: "remove", name, revision: added.revision }, undefined, authorize),
  ).rejects.toThrow("changed");
  const updated = await hub.manageServer(
    {
      action: "update",
      name,
      revision: disabled.revision,
      config: { url: "https://two.example/mcp" },
    },
    undefined,
    authorize,
  );
  if (!("revision" in updated)) throw new Error("Expected a server.");
  expect((await hub.inventory(undefined, true))[0]).toMatchObject({
    name: machineEntry.name,
    url: "https://two.example/mcp",
  });
  await hub.manageServer(
    { action: "remove", name, revision: updated.revision },
    undefined,
    authorize,
  );
  expect(await hub.inventory(undefined, true)).toEqual([]);
  expect(await hub.inventory(project)).toHaveLength(1);
  expect(authorize).toHaveBeenCalledTimes(5);
});

const definition = (
  name: string,
  dir: string,
  env: Record<string, string> = {},
): InventoryDefinition => ({
  name,
  source: "claude",
  sources: ["claude"],
  aliases: [{ provider: "claude", name }],
  kind: "stdio",
  command: process.execPath,
  args: [FIXTURE],
  env: { FAKE_MCP_START_LOG: join(dir, `${name}.starts`), ...env },
});

const starts = (dir: string, name: string) => {
  const file = join(dir, `${name}.starts`);
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").length : 0;
};

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {} },
};
const list = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };
const call = (text: string, name = "echo") => ({
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: { name, arguments: { text } },
});

const noAccounts = async () => ({ claude: [], codex: [] });
const noUserFiles = (dir: string) => ({
  claudeConfig: join(dir, "no.json"),
  pluginsDir: join(dir, "no-plugins"),
  codexConfig: join(dir, "config.toml"),
});

const hubWith = (
  dir: string,
  defs: InventoryDefinition[],
  extra: Partial<ConstructorParameters<typeof McpHub>[0]> = {},
) =>
  new McpHub({
    dataDir: dir,
    inventory: async () => defs,
    files: noUserFiles(dir),
    accountDirs: noAccounts,
    policy: async () => ({ version: 1, mode: "always", direct: [] }),
    ...extra,
  });

describe("MCP hub children", () => {
  it.skipIf(process.platform !== "win32")(
    "persists credentials in the Windows vault without touching provider config",
    async () => {
      const dir = tempDir();
      const config = join(dir, "config.toml");
      const original = '[mcp_servers.dokploy]\ncommand = "node"\n';
      writeFileSync(config, original);
      const defs = [definition("dokploy", dir)];
      const token = "private-fixture-value";
      const hub = hubWith(dir, defs);
      await hub.setProjectCredentials(dir, "dokploy", { DOKPLOY_API_KEY: token });
      hub.shutdown();
      expect(readFileSync(config, "utf8")).toBe(original);
      const encrypted = join(dir, "mcp-hub", "project-credentials", "vault", "tokens.enc");
      expect(readFileSync(encrypted).includes(Buffer.from(token))).toBe(false);
      const reopened = hubWith(dir, defs);
      await expect(reopened.projectCredentialStatus(dir, "dokploy")).resolves.toEqual({
        kind: "stdio",
        configured: true,
      });
      await reopened.clearProjectCredentials(dir, "dokploy");
      expect((await reopened.projectCredentialStatus(dir, "dokploy")).configured).toBe(false);
      reopened.shutdown();
    },
  );

  it("launches an inherited shared stdio server with the selected project's credentials", async () => {
    const dir = tempDir();
    const other = tempDir();
    const values = new Map<string, string>();
    const defs = [definition("dokploy", dir, { FAKE_MCP_PROJECT_TOKEN: "provider-value" })];
    const options = {
      projectCredentialValues: {
        get: async (ref: string) => values.get(ref),
        set: async (ref: string, value: string) => {
          values.set(ref, value);
        },
        delete: async (ref: string) => {
          values.delete(ref);
        },
      },
    };
    const writer = hubWith(dir, defs, options);
    await writer.setProjectCredentials(dir, "dokploy", { FAKE_MCP_PROJECT_TOKEN: "first-value" });
    await writer.setProjectCredentials(other, "dokploy", {
      FAKE_MCP_PROJECT_TOKEN: "second-value",
    });
    writer.shutdown();
    const hub = hubWith(dir, defs, options);
    const readToken = async (cwd?: string) =>
      (await hub.serve("dokploy", "same-session", call("", "project-env"), cwd))?.result.content[0]
        .text;
    try {
      expect(await readToken(dir)).toBe("first-value");
      expect(await readToken(other)).toBe("second-value");
      expect(await readToken()).toBe("provider-value");
      await hub.setProjectCredentials(dir, "dokploy", { FAKE_MCP_PROJECT_TOKEN: "updated-value" });
      expect(await readToken(dir)).toBe("updated-value");
      await hub.clearProjectCredentials(dir, "dokploy");
      expect(await readToken(dir)).toBe("provider-value");
      expect(await readToken(other)).toBe("second-value");
    } finally {
      hub.shutdown();
    }
  });

  it("fills the cache once, then serves initialize and tools/list without starting a child", async () => {
    const dir = tempDir();
    const defs = [definition("fake-a", dir)];
    const first = hubWith(dir, defs);
    const filled = await first.serve("fake-a", "session-1", initialize);
    expect(filled?.result).toMatchObject({ serverInfo: { name: "fake" } });
    expect(starts(dir, "fake-a")).toBe(1);
    first.shutdown();

    const second = hubWith(dir, defs);
    await second.serve("fake-a", "session-2", initialize);
    const tools = await second.serve("fake-a", "session-2", list);
    expect(tools?.result.tools[0].name).toBe("echo");
    expect(starts(dir, "fake-a")).toBe(1);
    expect((await second.status()).running).toBe(0);
    second.shutdown();
  });

  it("starts the child on tools/call and remaps each client id", async () => {
    const dir = tempDir();
    const hub = hubWith(dir, [definition("fake-a", dir)]);
    const reply = await hub.serve("fake-a", "session-1", { ...call("hi"), id: "client-9" });
    expect(reply?.id).toBe("client-9");
    expect(reply?.result.content[0].text).toMatch(/^hi:\d+$/);
    expect(starts(dir, "fake-a")).toBe(1);
    hub.shutdown();
  });

  it("returns undefined for notifications and does not start a child for them", async () => {
    const dir = tempDir();
    const hub = hubWith(dir, [definition("fake-a", dir)]);
    expect(
      await hub.serve("fake-a", "session-1", {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    ).toBeUndefined();
    expect(starts(dir, "fake-a")).toBe(0);
    hub.shutdown();
  });

  it("stops an idle child and restarts it on the next call", async () => {
    const dir = tempDir();
    const hub = hubWith(dir, [definition("fake-a", dir)], { idleMs: { perSession: 50 } });
    await hub.serve("fake-a", "session-1", call("one"));
    expect((await hub.status()).running).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await hub.status()).running).toBe(0);
    await hub.serve("fake-a", "session-1", call("two"));
    expect(starts(dir, "fake-a")).toBe(2);
    hub.shutdown();
  });

  it("shares one child for stateless shared servers and isolates perSession servers", async () => {
    const dir = tempDir();
    const shared = hubWith(dir, [definition("rea", dir)]);
    await shared.serve("rea", "session-1", call("a"));
    await shared.serve("rea", "session-2", call("b"));
    expect(starts(dir, "rea")).toBe(1);
    expect((await shared.status()).running).toBe(1);
    shared.shutdown();

    const isolated = hubWith(dir, [definition("fake-a", dir)]);
    await isolated.serve("fake-a", "session-1", call("a"));
    await isolated.serve("fake-a", "session-2", call("b"));
    expect(starts(dir, "fake-a")).toBe(2);
    expect((await isolated.status()).running).toBe(2);
    isolated.shutdown();
  });

  it("returns a JSON-RPC error when the child crashes, then restarts on the next call", async () => {
    const dir = tempDir();
    const hub = hubWith(dir, [definition("fake-a", dir)]);
    const crashed = await hub.serve("fake-a", "session-1", call("x", "crash"));
    expect(crashed?.error?.code).toBe(-32603);
    expect(crashed?.error?.message).toContain("exited");
    const recovered = await hub.serve("fake-a", "session-1", call("again"));
    expect(recovered?.result.content[0].text).toMatch(/^again:\d+$/);
    expect(starts(dir, "fake-a")).toBe(2);
    hub.shutdown();
  });

  it("evicts idle shared children before perSession ones at the cap", async () => {
    const dir = tempDir();
    const hub = hubWith(
      dir,
      [definition("fake-a", dir), definition("rea", dir), definition("fake-b", dir)],
      { maxChildren: 2 },
    );
    await hub.serve("fake-a", "session-1", call("a"));
    await hub.serve("rea", "shared", call("r"));
    await hub.serve("fake-b", "session-2", call("b"));
    const status = await hub.status();
    expect(status.running).toBe(2);
    expect(status.children.map((child) => child.name).sort()).toEqual(["fake-a", "fake-b"]);
    hub.shutdown();
  });

  it("never runs a child for an unknown or http-only name", async () => {
    const dir = tempDir();
    const hub = hubWith(dir, [
      {
        ...definition("remote", dir),
        kind: "http",
        url: "https://example.test/mcp",
        command: undefined,
        args: undefined,
        env: undefined,
      },
    ]);
    await expect(hub.serve("remote", "s", call("x"))).rejects.toThrow("Unknown MCP server.");
    await expect(hub.serve("missing", "s", call("x"))).rejects.toThrow("Unknown MCP server.");
    hub.shutdown();
  });

  it("reports a spawn failure without leaking launch secrets", async () => {
    const dir = tempDir();
    const secret = "s3cr3t-value-123";
    const broken: InventoryDefinition = {
      ...definition("fake-a", dir, { SECRET_TOKEN: secret }),
      command: join(dir, "no-such-binary-xyz"),
      args: ["--token", secret],
    };
    const hub = hubWith(dir, [broken]);
    const reply = await hub.serve("fake-a", "session-1", call("x"));
    expect(reply?.error?.message).toContain("failed to start");
    expect(JSON.stringify(reply)).not.toContain(secret);
    expect(JSON.stringify(await hub.status())).not.toContain(secret);
    hub.shutdown();
  });

  it("publishes stdio entries as hub URLs and http entries as passthrough", async () => {
    const dir = tempDir();
    const hub = hubWith(dir, [
      definition("fake-a", dir),
      {
        ...definition("remote", dir),
        kind: "http",
        url: "https://example.test/mcp",
        headers: { Authorization: "Bearer ${REMOTE_TOKEN}" },
        command: undefined,
        args: undefined,
        env: undefined,
      },
    ]);
    const published = await hub.publication("http://127.0.0.1:4555");
    expect(published.servers).toEqual([
      expect.objectContaining({
        name: "fake-a",
        kind: "stdio",
        mode: "perSession",
        url: "http://127.0.0.1:4555/mcp/ext/fake-a",
      }),
      expect.objectContaining({
        name: "remote",
        kind: "http",
        passthrough: {
          url: "https://example.test/mcp",
          headers: { Authorization: "Bearer ${REMOTE_TOKEN}" },
        },
      }),
    ]);
    expect(JSON.stringify(published)).not.toContain(FIXTURE);
    expect(published.disable).toEqual({ claude: ["fake-a"], codex: [], opencode: [] });
    hub.shutdown();
  });

  it("publishes codex-safe names and only disables codex servers that exist in config.toml", async () => {
    const dir = tempDir();
    const codexConfig = join(dir, "config.toml");
    writeFileSync(
      codexConfig,
      [
        "[mcp_servers.dokploy]",
        'command = "npx"',
        '[mcp_servers."quoted.name"]',
        'command = "node"',
        "[mcp_servers.off]",
        "enabled = false",
        "[[skills.config]]",
        'path = "/skills/example/SKILL.md"',
        "enabled = false",
        "",
      ].join("\n"),
    );
    const codex = (name: string): InventoryDefinition => ({
      ...definition(name, dir),
      source: "codex",
      sources: ["codex"],
      aliases: [{ provider: "codex", name }],
    });
    const hub = hubWith(
      dir,
      [
        codex("dokploy"),
        codex("quoted.name"),
        codex("ghost"),
        codex("my.server"),
        definition("fake-a", dir),
      ],
      {},
    );
    const published = await hub.publication("http://127.0.0.1:4555");
    const codexNames = Object.fromEntries(
      published.servers.map((server) => [server.name, server.codexName]),
    );
    expect(codexNames).toEqual({
      dokploy: "dokploy-hub",
      "quoted.name": "quoted-name-hub",
      ghost: "ghost",
      "my.server": "my-server",
      "fake-a": "fake-a",
    });
    // `ghost` is not in config.toml, so Codex must not be asked to disable it.
    expect(published.disable.codex).toEqual(["dokploy", "quoted.name"]);
    hub.shutdown();
  });

  it("publishes a session's project servers only when its project is known", async () => {
    const dir = tempDir();
    const global = definition("fake-a", dir);
    const projectServer: InventoryDefinition = {
      ...definition("proj-only", dir),
      source: "claude-project",
      sources: ["claude-project"],
    };
    const hub = new McpHub({
      policy: async () => ({ version: 1, mode: "always", direct: [] }),
      dataDir: dir,
      files: noUserFiles(dir),
      accountDirs: noAccounts,
      inventory: async (cwd) => (cwd ? [global, projectServer] : [global]),
      projectCwd: async (projectId) => (projectId === "p1" ? join(dir, "app") : undefined),
    });
    const url = "http://127.0.0.1:4555/mcp/conversation";
    const withProject = (await hub.externalMcp(url, "p1")) as {
      externalMcp: { servers: { name: string }[] };
    };
    expect(withProject.externalMcp.servers.map((server) => server.name)).toEqual([
      "fake-a",
      "proj-only",
    ]);
    const globalOnly = (await hub.externalMcp(url, undefined)) as {
      externalMcp: { servers: { name: string }[] };
    };
    expect(globalOnly.externalMcp.servers.map((server) => server.name)).toEqual(["fake-a"]);
    hub.shutdown();
  });
});

describe("MCP hub describe budget and warm-up", () => {
  const url = "http://127.0.0.1:4321/mcp/conversation";

  it("answers without externalMcp when discovery is slower than the wait", async () => {
    const dir = tempDir();
    const hub = new McpHub({
      policy: async () => ({ version: 1, mode: "always", direct: [] }),
      dataDir: dir,
      externalMcpWaitMs: 30,
      inventory: () => new Promise(() => undefined),
    });
    const started = Date.now();
    expect(await hub.externalMcp(url)).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("includes externalMcp when discovery finishes within the wait", async () => {
    const dir = tempDir();
    const hub = new McpHub({
      policy: async () => ({ version: 1, mode: "always", direct: [] }),
      dataDir: dir,
      externalMcpWaitMs: 1_000,
      inventory: async () => [definition("fake-a", dir)],
    });
    const result = (await hub.externalMcp(url)) as { externalMcp: { servers: { name: string }[] } };
    expect(result.externalMcp.servers.map((server) => server.name)).toEqual(["fake-a"]);
  });

  it("answers a known publication at once even when discovery has become slow", async () => {
    const dir = tempDir();
    let calls = 0;
    const hub = new McpHub({
      policy: async () => ({ version: 1, mode: "always", direct: [] }),
      dataDir: dir,
      externalMcpWaitMs: 30,
      inventory: () => {
        calls += 1;
        // First discovery is fast; every later one hangs (a busy Host).
        return calls === 1
          ? Promise.resolve([definition("fake-a", dir)])
          : new Promise(() => undefined);
      },
    });
    const first = (await hub.externalMcp(url)) as { externalMcp: { servers: { name: string }[] } };
    expect(first.externalMcp.servers.map((server) => server.name)).toEqual(["fake-a"]);
    const started = Date.now();
    const again = (await hub.externalMcp(url)) as { externalMcp: { servers: { name: string }[] } };
    expect(again.externalMcp.servers.map((server) => server.name)).toEqual(["fake-a"]);
    expect(Date.now() - started).toBeLessThan(25);
    expect(calls).toBe(1);
  });

  it("warm runs discovery once and swallows failures", async () => {
    const dir = tempDir();
    let calls = 0;
    const hub = new McpHub({
      policy: async () => ({ version: 1, mode: "always", direct: [] }),
      dataDir: dir,
      inventory: async () => {
        calls += 1;
        throw new Error("boom");
      },
    });
    expect(() => hub.warm(4321)).not.toThrow();
    await vi.waitFor(() => expect(calls).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBe(1);
  });
});
