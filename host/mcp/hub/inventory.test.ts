import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpInventory, mergeDefinitions } from "./inventory";
import { inventoryFiles, sameProjectPath } from "./inventory-sources";
import { parseTomlSubset } from "./toml";
import { McpHub } from "./hub";
import { hubMode } from "./policy";

const dirs: string[] = [];
const noAccounts = async () => ({ claude: [], codex: [] });
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

function fixtureHome() {
  const home = mkdtempSync(join(tmpdir(), "bycoda-mcp-inventory-"));
  dirs.push(home);
  const claudeDir = join(home, ".claude");
  const pluginRoot = join(claudeDir, "plugins", "cache", "design");
  const codexHome = join(home, ".codex");
  mkdirSync(pluginRoot, { recursive: true });
  mkdirSync(join(claudeDir, "plugins", "synced", "team"), { recursive: true });
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(
    join(home, ".claude.json"),
    JSON.stringify({
      mcpServers: {
        "desktop-commander": { command: "npx", args: ["-y", "dc"], env: { MODE: "x" } },
        "remote-http": {
          type: "http",
          url: "https://r.test/mcp",
          headers: { Authorization: "Bearer ${R_TOKEN}" },
        },
        "sse-one": { type: "sse", url: "https://s.test/sse" },
        collide: { command: "node", args: ["claude-collide.mjs"] },
        // Unconfigured connectors from synced plugin manifests and blank commands are not servers.
        "blank-url": { type: "http", url: "" },
        "blank-cmd": { command: "  ", args: [] },
      },
    }),
  );
  writeFileSync(
    join(claudeDir, "plugins", "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins: { "design@market": [{ installPath: pluginRoot }] } }),
  );
  writeFileSync(
    join(pluginRoot, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        figma: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/figma.mjs"] },
        "desktop-commander": { command: "npx", args: ["-y", "dc"] },
      },
    }),
  );
  writeFileSync(
    join(claudeDir, "plugins", "synced", "team", ".mcp.json"),
    JSON.stringify({ collide: { command: "node", args: ["plugin-collide.mjs"] } }),
  );
  writeFileSync(
    join(codexHome, "config.toml"),
    [
      "[mcp_servers.dokploy]",
      'command = "npx"',
      'args = ["-y", "dokploy-mcp"]',
      "[mcp_servers.dokploy.env]",
      'DOKPLOY_URL = "https://d.test"',
      "[mcp_servers.collide]",
      'command = "node"',
      'args = ["codex-collide.mjs"]',
      "[mcp_servers.disabled-one]",
      'command = "node"',
      "enabled = false",
      "[mcp_servers.remote-codex]",
      'url = "https://c.test/mcp"',
      'bearer_token_env_var = "CODEX_TOKEN"',
      '[mcp_servers."quoted.name"]',
      'command = "node"',
      'args = ["q.mjs"]',
      "",
    ].join("\n"),
  );
  return { home, claudeDir, codexHome, files: inventoryFiles({ CODEX_HOME: codexHome }, home) };
}

describe("global MCP inventory", () => {
  it("discovers enabled OpenCode servers and publishes local aliases for disabling", async () => {
    const { files } = fixtureHome();
    mkdirSync(join(files.opencodeConfig!, ".."), { recursive: true });
    writeFileSync(
      files.opencodeConfig!,
      JSON.stringify({
        mcp: {
          blender: {
            type: "local",
            command: ["uvx", "blender-mcp"],
            environment: { MODE: "test" },
          },
          disabled: { type: "local", command: ["node", "off"], enabled: false },
          servers: { atlassian: { type: "remote", url: "https://example.test/mcp" } },
        },
      }),
    );
    const inventory = new McpInventory(files, Date.now, undefined, noAccounts);
    const defs = await inventory.definitions();
    expect(defs.find((d) => d.name === "blender")).toMatchObject({
      kind: "stdio",
      command: "uvx",
      args: ["blender-mcp"],
      env: { MODE: "test" },
    });
    expect(defs.find((d) => d.name === "atlassian")).toMatchObject({
      kind: "http",
      url: "https://example.test/mcp",
    });
    expect(defs.some((d) => d.name === "disabled")).toBe(false);
    const hub = new McpHub({ dataDir: files.pluginsDir, files, accountDirs: noAccounts });
    expect((await hub.publication("http://127.0.0.1:4555")).disable.opencode).toEqual(["blender"]);
  });
  it("parses Claude, plugin and Codex definitions and resolves names", async () => {
    const { files } = fixtureHome();
    const defs = await new McpInventory(files, Date.now, undefined, noAccounts).definitions();
    const byName = Object.fromEntries(defs.map((def) => [def.name, def]));

    expect(Object.keys(byName).sort()).toEqual(
      [
        "collide",
        "collide-claude-plugin",
        "collide-codex",
        "desktop-commander",
        "dokploy",
        "figma",
        "quoted.name",
        "remote-codex",
        "remote-http",
        "sse-one",
      ].sort(),
    );
    // Identical command+args from Claude and a plugin is one entry with both sources.
    expect(byName["desktop-commander"].sources).toEqual(["claude", "claude-plugin"]);
    expect(byName["desktop-commander"].aliases).toEqual([
      { provider: "claude", name: "desktop-commander" },
      { provider: "claude", name: "plugin:design:desktop-commander" },
    ]);
    expect(byName.figma.args?.[0]).toBe(`${join(files.pluginsDir, "cache", "design")}/figma.mjs`);
    expect(byName["collide-claude-plugin"].aliases).toEqual([
      { provider: "claude", name: "plugin:synced:collide" },
    ]);
    expect(byName.dokploy.env).toEqual({ DOKPLOY_URL: "https://d.test" });
    expect(byName["sse-one"].kind).toBe("http");
    expect(byName["remote-codex"].headers).toEqual({ Authorization: "Bearer ${CODEX_TOKEN}" });
    expect(byName["quoted.name"].command).toBe("node");
    expect(byName["disabled-one"]).toBeUndefined();
    expect(byName["blank-url"]).toBeUndefined();
    expect(byName["blank-cmd"]).toBeUndefined();
  });

  it("never writes the source files", async () => {
    const { files, home } = fixtureHome();
    const before = readFileSync(join(home, ".claude.json"), "utf8");
    await new McpInventory(files, Date.now, undefined, noAccounts).definitions();
    expect(readFileSync(join(home, ".claude.json"), "utf8")).toBe(before);
  });

  it("re-stats at most every 30 seconds and rebuilds when a source changes", async () => {
    const { files, home } = fixtureHome();
    let now = 0;
    const inventory = new McpInventory(files, () => now, 30_000, noAccounts);
    expect((await inventory.definitions()).some((def) => def.name === "later")).toBe(false);

    const claudeJson = join(home, ".claude.json");
    const config = JSON.parse(readFileSync(claudeJson, "utf8"));
    config.mcpServers.later = { command: "node", args: ["later.mjs"] };
    writeFileSync(claudeJson, JSON.stringify(config));
    utimesSync(claudeJson, new Date(5_000_000), new Date(5_000_000));

    now = 10_000;
    expect((await inventory.definitions()).some((def) => def.name === "later")).toBe(false);
    now = 31_000;
    expect((await inventory.definitions()).some((def) => def.name === "later")).toBe(true);
  });

  it("honours CLAUDE_CONFIG_DIR and CODEX_HOME and defaults to the home directory", () => {
    const home = "/home/tester";
    expect(inventoryFiles({}, home).claudeConfig).toBe(join(home, ".claude.json"));
    expect(inventoryFiles({}, home).codexConfig).toBe(join(home, ".codex", "config.toml"));
    const custom = inventoryFiles(
      { CLAUDE_CONFIG_DIR: "/opt/claude", CODEX_HOME: "/opt/codex" },
      home,
    );
    expect(custom.claudeConfig).toMatch(/opt[\\/]claude[\\/]\.claude\.json$/);
    expect(custom.codexConfig).toMatch(/opt[\\/]codex[\\/]config\.toml$/);
  });

  it("merges identical definitions and suffixes distinct same-name ones", () => {
    const merged = mergeDefinitions([
      {
        name: "srv",
        alias: "srv",
        provider: "claude",
        source: "claude",
        kind: "stdio",
        command: "a",
        args: [],
      },
      {
        name: "srv",
        alias: "srv",
        provider: "codex",
        source: "codex",
        kind: "stdio",
        command: "a",
        args: [],
        env: { SRV_URL: "http://codex", SHARED: "codex" },
      },
      {
        name: "srv",
        alias: "srv",
        provider: "claude",
        source: "claude-account",
        kind: "stdio",
        command: "a",
        args: [],
        env: { SHARED: "account" },
      },
      {
        name: "srv",
        alias: "srv",
        provider: "codex",
        source: "codex",
        kind: "stdio",
        command: "b",
        args: [],
      },
    ]);
    expect(merged.map((def) => def.name)).toEqual(["srv", "srv-codex"]);
    expect(merged[0].sources).toEqual(["claude", "codex", "claude-account"]);
    // Env from every identical launch is kept; the first claim wins a conflicting key.
    expect(merged[0].env).toEqual({ SRV_URL: "http://codex", SHARED: "codex" });
  });

  it("classifies only the known stateless servers as shared", () => {
    expect(hubMode("dokploy", { kind: "stdio", command: "npx" })).toBe("shared");
    expect(hubMode("anything", { kind: "stdio", command: "node", args: ["rea.mjs"] })).toBe(
      "shared",
    );
    expect(hubMode("mem0-cloud", { kind: "stdio", command: "npx" })).toBe("shared");
    expect(hubMode("desktop-commander", { kind: "stdio", command: "npx" })).toBe("perSession");
    expect(hubMode("computer-use", { kind: "stdio", command: "node" })).toBe("perSession");
  });
});

describe("Codex TOML subset", () => {
  it("reads nested tables, quoted keys, arrays, inline tables and escapes", () => {
    const parsed = parseTomlSubset(
      [
        "# comment",
        "[mcp_servers.a]",
        'args = ["x", "y"]',
        'inline = { K = "v", N = 2 }',
        "flag = true",
        "[mcp_servers.a.env]",
        "TOKEN_NAME = 'literal \\n'",
        '[mcp_servers."b.c"]',
        'msg = "tab\\there \\u0041"',
        "",
      ].join("\n"),
    );
    expect(parsed.mcp_servers).toEqual({
      a: {
        args: ["x", "y"],
        inline: { K: "v", N: 2 },
        flag: true,
        env: { TOKEN_NAME: "literal \\n" },
      },
      "b.c": { msg: "tab\there A" },
    });
  });

  it("rejects syntax it does not understand instead of guessing", () => {
    expect(() => parseTomlSubset('[mcp_servers.a]\ncommand = """\nnode\n"""')).toThrow();
    expect(() => parseTomlSubset("[skills.config]\n[[skills.config]]")).toThrow();
    expect(() => parseTomlSubset("[[skills.config]\nname = 'x'")).toThrow();
  });

  it("reads repeated skill tables and their nested settings without losing MCP tables", () => {
    expect(
      parseTomlSubset(
        "[mcp_servers.clef]\ncommand = 'python'\n" +
          "[[skills.config]]\npath = '/first'\n[skills.config.settings]\nenabled = false\n" +
          "[[skills.config]]\npath = '/second'\n",
      ),
    ).toEqual({
      mcp_servers: { clef: { command: "python" } },
      skills: { config: [{ path: "/first", settings: { enabled: false } }, { path: "/second" }] },
    });
  });
});

describe("project-scoped sources", () => {
  it("adds the session project's servers and keeps global-only results without a cwd", async () => {
    const { files, home } = fixtureHome();
    const project = join(home, "work", "app");
    mkdirSync(join(project, ".codex"), { recursive: true });
    writeFileSync(
      join(project, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          "proj-only": { command: "npx", args: ["-y", "p"] },
          "shared-name": { type: "http", url: "https://p.test/mcp" },
          dokploy: { command: "uvx", args: ["dokploy-other"] },
          "desktop-commander": { command: "npx", args: ["-y", "dc"] },
        },
      }),
    );
    writeFileSync(
      join(project, ".codex", "config.toml"),
      '[mcp_servers.codex-proj]\ncommand = "node"\nargs = ["cx.mjs"]\n',
    );
    // Windows matches project keys case-insensitively and with either slash style.
    const key =
      process.platform === "win32" ? project.split("\\").join("/").toUpperCase() : project;
    const claude = JSON.parse(readFileSync(files.claudeConfig, "utf8"));
    claude.projects = {
      [key]: { mcpServers: { "claude-proj": { command: "node", args: ["cp.mjs"] } } },
    };
    writeFileSync(files.claudeConfig, JSON.stringify(claude));

    const inventory = new McpInventory(files, Date.now, undefined, noAccounts);
    const withProject = Object.fromEntries(
      (await inventory.definitions(project)).map((def) => [def.name, def]),
    );
    expect(withProject["proj-only"].source).toBe("claude-project");
    expect(withProject["shared-name"]).toMatchObject({ kind: "http", source: "claude-project" });
    expect(withProject["claude-proj"].source).toBe("claude-project");
    expect(withProject["codex-proj"].source).toBe("codex-project");
    // Same name, different launch than the global codex `dokploy`: suffixed, not replaced.
    expect(withProject["dokploy-project"]).toMatchObject({
      source: "claude-project",
      command: "uvx",
    });
    expect(withProject["dokploy"].sources).toEqual(["codex"]);
    expect(withProject["desktop-commander"].sources).toEqual([
      "claude",
      "claude-plugin",
      "claude-project",
    ]);

    const globalOnly = Object.fromEntries(
      (await inventory.definitions()).map((def) => [def.name, def]),
    );
    expect(globalOnly["proj-only"]).toBeUndefined();
    expect(globalOnly["claude-proj"]).toBeUndefined();
    expect(globalOnly["codex-proj"]).toBeUndefined();
    expect(globalOnly["dokploy"].sources).toEqual(["codex"]);
  });

  it("matches project paths across slash style, and case only on Windows", () => {
    expect(sameProjectPath("C:\\Work\\App", "c:/work/app/", "win32")).toBe(true);
    expect(sameProjectPath("/a/B", "/a/b", "linux")).toBe(false);
    expect(sameProjectPath("/a/b", "/a/b/", "linux")).toBe(true);
  });
});

describe("provider-account sources", () => {
  it("unions the default and account configs, and disables only codex names every config has", async () => {
    const { files, home } = fixtureHome();
    const accountA = join(home, "accounts", "a");
    const accountB = join(home, "accounts", "b");
    mkdirSync(accountA, { recursive: true });
    mkdirSync(accountB, { recursive: true });
    writeFileSync(
      join(accountA, ".claude.json"),
      JSON.stringify({ mcpServers: { tradingview: { type: "http", url: "https://tv.test/mcp" } } }),
    );
    writeFileSync(
      join(accountB, ".claude.json"),
      JSON.stringify({ mcpServers: { blender: { command: "uvx", args: ["blender-mcp"] } } }),
    );
    writeFileSync(
      join(accountA, "config.toml"),
      '[mcp_servers.dokploy]\ncommand = "npx"\nargs = ["-y", "dokploy-mcp"]\n[mcp_servers.extra]\ncommand = "node"\nargs = ["extra.mjs"]\n',
    );
    writeFileSync(
      join(accountB, "config.toml"),
      '[mcp_servers.dokploy]\ncommand = "npx"\nargs = ["-y", "dokploy-mcp"]\n',
    );
    const accounts = async () => ({ claude: [accountA, accountB], codex: [accountA, accountB] });
    const inventory = new McpInventory(files, Date.now, undefined, accounts);
    const byName = Object.fromEntries(
      (await inventory.definitions()).map((def) => [def.name, def]),
    );
    expect(byName["desktop-commander"]).toBeDefined();
    expect(byName.tradingview.sources).toEqual(["claude-account"]);
    expect(byName.blender.sources).toEqual(["claude-account"]);
    expect(byName.dokploy.sources).toEqual(["codex", "codex-account"]);
    expect(byName.extra.sources).toEqual(["codex-account"]);

    const sets = await inventory.codexNameSets();
    expect(sets).toHaveLength(3);
    expect(sets.map((set) => set.has("dokploy"))).toEqual([true, true, true]);
    expect(sets[1].has("extra")).toBe(true);
    expect(sets[2].has("extra")).toBe(false);

    const hub = new McpHub({ dataDir: join(home, "hub"), files, accountDirs: accounts });
    const published = await hub.publication("http://127.0.0.1:4555");
    expect(published.servers.map((server) => server.name)).toEqual(
      expect.arrayContaining(["tradingview", "blender", "dokploy", "extra"]),
    );
    // `extra` exists only in account A, so disabling it could make Codex refuse to load.
    expect(published.disable.codex).toEqual(["dokploy"]);
    hub.shutdown();
  });
});
