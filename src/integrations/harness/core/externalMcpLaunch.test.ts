import { describe, expect, it } from "vitest";
import {
  codexExternalMcpArgs,
  codexExternalMcpConfig,
  narrowExternalMcp,
  narrowPublishedMcp,
  opencodeConfigContent,
  parseExternalMcp,
  rebaseExternalMcp,
  withExternalMcpArgs,
  opencodeLaunchEnv,
  type ExternalMcp,
} from "./externalMcpLaunch";

const hub = {
  name: "arc",
  // The user's codex config already defines a stdio `arc`, so Codex gets a distinct key.
  codexName: "arc-hub",
  url: "http://127.0.0.1:4555/mcp/ext/arc",
  kind: "stdio",
  mode: "shared",
  sources: ["user"],
} as const;
const passthrough = {
  name: "uiarc",
  url: "https://uiarc.dev/api/mcp",
  kind: "http",
  mode: "shared",
  sources: ["user"],
  passthrough: { url: "https://uiarc.dev/api/mcp", headers: { "X-Team": "bycoda" } },
} as const;
const external = parseExternalMcp({
  servers: [hub, passthrough],
  disable: { claude: ["rea"], codex: ["rea", "a.b"] },
}) as ExternalMcp;

it("builds OpenCode hub overrides with remote entries winning overlaps", () => {
  const config = opencodeConfigContent({
    ...external,
    disable: { ...external.disable, opencode: ["arc", "old"] },
  });
  expect(JSON.parse(config!)).toEqual({
    mcp: {
      arc: {
        type: "remote",
        url: hub.url,
        headers: { Authorization: "Bearer {env:BYCODA_CONVERSATION_TOKEN}" },
        enabled: true,
      },
      old: { type: "local", command: ["bycoda-hub-hosted"], enabled: false },
      uiarc: {
        type: "remote",
        url: passthrough.url,
        headers: passthrough.passthrough.headers,
        enabled: true,
      },
    },
  });
  expect(
    opencodeConfigContent({ servers: [], disable: { claude: [], codex: [] } }),
  ).toBeUndefined();
});

const social = [
  "--mcp-config",
  JSON.stringify({ mcpServers: { "bycoda-social": { command: "s" } } }),
];
const claudeArgs = [
  "--print",
  "--setting-sources=user,project,local",
  "--settings",
  "{}",
  ...social,
];

describe("rebaseExternalMcp", () => {
  it("re-points hub servers at the broker origin and keeps published or passthrough urls otherwise", () => {
    const parsed = parseExternalMcp({
      servers: [hub, passthrough],
      disable: { claude: [], codex: [], opencode: [] },
    });
    expect(
      parseExternalMcp({ servers: [], disable: { claude: [], codex: [], opencode: ["rea"] } })
        ?.disable.opencode,
    ).toEqual(["rea"]);
    expect(
      parseExternalMcp({ servers: [], disable: { claude: [], codex: [], opencode: "rea" } }),
    ).toBeUndefined();
    if (!parsed) throw new Error("fixture must parse");
    const broker = rebaseExternalMcp(parsed, "http://127.0.0.1:5511/mcp/conversation");
    expect(broker.servers.map((server) => server.url)).toEqual([
      "http://127.0.0.1:5511/mcp/ext/arc",
      "https://uiarc.dev/api/mcp",
    ]);
    expect(rebaseExternalMcp(parsed, undefined)).toBe(parsed);
    expect(rebaseExternalMcp(parsed, "not a url")).toBe(parsed);
  });
});

describe("parseExternalMcp", () => {
  it("accepts the host contract and rejects anything malformed as a whole", () => {
    expect(external.servers.map((server) => server.name)).toEqual(["arc", "uiarc"]);
    // codexName defaults to name; a dotted or duplicate codexName rejects the whole payload.
    expect(external.servers.map((server) => server.codexName)).toEqual(["arc-hub", "uiarc"]);
    expect(
      parseExternalMcp({
        servers: [{ ...hub, codexName: "a.b" }],
        disable: { claude: [], codex: [] },
      }),
    ).toBeUndefined();
    expect(
      parseExternalMcp({
        servers: [hub, { ...passthrough, codexName: "arc-hub" }],
        disable: { claude: [], codex: [] },
      }),
    ).toBeUndefined();
    // An unconfigured user connector (empty url) is skipped on its own; a malformed hub
    // entry still rejects everything, because hub wiring changes the launch.
    expect(
      parseExternalMcp({
        servers: [hub, { ...passthrough, name: "blank", passthrough: { url: "" } }],
        disable: { claude: [], codex: [] },
      })?.servers.map((server) => server.name),
    ).toEqual(["arc"]);
    expect(
      parseExternalMcp({
        servers: [{ ...hub, url: "" }, passthrough],
        disable: { claude: [], codex: [] },
      }),
    ).toBeUndefined();
    expect(parseExternalMcp(undefined)).toBeUndefined();
    expect(parseExternalMcp({ servers: [], disable: { claude: [], codex: [] } })).toEqual({
      servers: [],
      disable: { claude: [], codex: [], opencode: [] },
    });
    const bad = [
      { ...hub, url: "https://evil.example/mcp" },
      { ...hub, url: "http://user:pw@127.0.0.1:4555/mcp" },
      { ...hub, name: "bycoda-conversation" },
      { ...hub, name: "has space" },
      { ...hub, kind: "websocket" },
      { ...hub, sources: [1] },
    ];
    for (const server of bad)
      expect(
        parseExternalMcp({ servers: [server], disable: { claude: [], codex: [] } }),
      ).toBeUndefined();
    // Malformed passthrough entries drop only themselves.
    for (const server of [
      { ...passthrough, passthrough: { url: "ftp://x", headers: {} } },
      { ...passthrough, passthrough: { url: "https://x", headers: { A: 1 } } },
    ])
      expect(
        parseExternalMcp({ servers: [server], disable: { claude: [], codex: [] } })?.servers,
      ).toEqual([]);
    expect(
      parseExternalMcp({ servers: [hub, hub], disable: { claude: [], codex: [] } }),
    ).toBeUndefined();
    expect(
      parseExternalMcp({ servers: [], disable: { claude: "rea", codex: [] } }),
    ).toBeUndefined();
  });
});

describe("Claude external MCP launch", () => {
  it("switches to strict MCP with hub HTTP entries, forwards passthrough and keeps other settings", () => {
    const args = withExternalMcpArgs("claude", claudeArgs, external);
    expect(args.filter((arg) => arg === "--strict-mcp-config")).toHaveLength(1);
    expect(args[args.indexOf("--strict-mcp-config") + 1]).toBe("--mcp-config");
    expect(args).toContain("--setting-sources=user,project,local");
    const config = JSON.parse(args[args.indexOf("--mcp-config") + 1]);
    expect(Object.keys(config.mcpServers)).toEqual(["bycoda-social", "arc", "uiarc"]);
    expect(config.mcpServers.arc).toEqual({
      type: "http",
      url: hub.url,
      headers: { Authorization: "Bearer ${BYCODA_CONVERSATION_TOKEN}" },
    });
    expect(config.mcpServers.uiarc).toEqual({
      type: "http",
      url: "https://uiarc.dev/api/mcp",
      headers: { "X-Team": "bycoda" },
    });
    expect(JSON.stringify(args)).not.toMatch(/sk-|secret|token-value/i);
  });

  it("omits headers for passthrough servers that declare none and adds a config when none exists", () => {
    const plain = parseExternalMcp({
      servers: [{ ...passthrough, passthrough: { url: "https://a.example/mcp" } }],
      disable: { claude: [], codex: [] },
    }) as ExternalMcp;
    expect(withExternalMcpArgs("claude", ["--print"], plain)).toEqual([
      "--print",
      "--strict-mcp-config",
      "--mcp-config",
      JSON.stringify({ mcpServers: { uiarc: { type: "http", url: "https://a.example/mcp" } } }),
    ]);
  });
});

describe("Codex external MCP launch", () => {
  it("defers disabling to the actual account and trusted project config", () => {
    const external: ExternalMcp = {
      servers: [],
      disable: { claude: [], codex: ["shadcn", "openaiDeveloperDocs", "missing", "a.b"] },
    };
    const project = {
      shadcn: { command: "npx", args: ["-y", "shadcn@latest", "mcp"] },
      openaiDeveloperDocs: { url: "https://developers.openai.com/mcp" },
    };
    expect(codexExternalMcpArgs(external)).toEqual([]);
    expect(codexExternalMcpConfig(external, {})).toEqual({});
    expect(codexExternalMcpConfig(external, { mcp_servers: project })).toEqual({
      "mcp_servers.shadcn.enabled": false,
      "mcp_servers.openaiDeveloperDocs.enabled": false,
    });
  });
  it("disables listed bare names, points hub servers at HTTP with the env-referenced token", () => {
    const args = codexExternalMcpArgs(external);
    expect(args).toEqual([
      "-c",
      `mcp_servers.arc-hub.url=${JSON.stringify(hub.url)}`,
      "-c",
      'mcp_servers.arc-hub.bearer_token_env_var="BYCODA_CONVERSATION_TOKEN"',
      "-c",
      'mcp_servers.uiarc.url="https://uiarc.dev/api/mcp"',
      "-c",
      'mcp_servers.uiarc.http_headers={"X-Team"="bycoda"}',
    ]);
    expect(args.join(" ")).not.toContain("Bearer");
  });

  it("prepends to app-server launches only and leaves other codex commands alone", () => {
    const launch = withExternalMcpArgs("codex", ["app-server"], external);
    expect(launch.at(-1)).toBe("app-server");
    expect(launch).not.toContain("mcp_servers.rea={enabled=false}");
    for (const input of [["login"], ["help", "app-server"]])
      expect(withExternalMcpArgs("codex", [...input], external)).toEqual(input);
  });
});

describe("unchanged launches", () => {
  it("leaves providers without a Claude or Codex app-server launch untouched", () => {
    expect(withExternalMcpArgs("gemini", ["--acp"], external)).toEqual(["--acp"]);
    expect(withExternalMcpArgs(undefined, ["--acp"], external)).toEqual(["--acp"]);
  });
});

describe("opencodeLaunchEnv", () => {
  it("rejects an oversized override instead of letting Native silently discard it", () => {
    const oversized = {
      ...external,
      servers: external.servers.map((server) => ({
        ...server,
        url: `http://127.0.0.1/${"x".repeat(65536)}`,
      })),
    };
    expect(() => opencodeLaunchEnv(oversized, "off")).toThrow("too large to apply");
  });
  it("adds compaction without replacing the MCP configuration and omits Default overrides", () => {
    const base = JSON.parse(opencodeLaunchEnv(external)!.OPENCODE_CONFIG_CONTENT);
    expect(JSON.parse(opencodeLaunchEnv(external, "off")!.OPENCODE_CONFIG_CONTENT)).toEqual({
      ...base,
      compaction: { auto: false },
    });
    expect(JSON.parse(opencodeLaunchEnv(undefined, "on")!.OPENCODE_CONFIG_CONTENT)).toEqual({
      compaction: { auto: true },
    });
  });
  it("wraps the inline config in the env OpenCode reads and stays absent without hub data", () => {
    const env = opencodeLaunchEnv(external);
    expect(Object.keys(env ?? {})).toEqual(["OPENCODE_CONFIG_CONTENT"]);
    expect(JSON.parse(env!.OPENCODE_CONFIG_CONTENT).mcp.arc.type).toBe("remote");
    expect(opencodeLaunchEnv(undefined)).toBeUndefined();
    expect(opencodeLaunchEnv({ servers: [], disable: { claude: [], codex: [] } })).toBeUndefined();
  });
});

describe("narrowing to a member's MCP allowlist", () => {
  it("drops unlisted hub servers and disables them in each provider", () => {
    const narrowed = narrowExternalMcp(external, ["uiarc"]);
    expect(narrowed.servers.map((server) => server.name)).toEqual(["uiarc"]);
    expect(narrowed.disable.claude).toEqual(["rea", "arc"]);
    expect(narrowed.disable.codex).toEqual(["rea", "a.b", "arc-hub"]);
    expect(narrowed.disable.opencode).toEqual(["arc"]);
    expect(codexExternalMcpArgs(narrowed)).not.toContain("mcp_servers.arc-hub={enabled=false}");
    expect(
      codexExternalMcpConfig(narrowed, { mcp_servers: { "arc-hub": { url: hub.url } } }),
    ).toEqual({ "mcp_servers.arc-hub.enabled": false });
  });

  it("an empty allowlist removes every hub server and Claude then loads only the hub config", () => {
    const narrowed = narrowExternalMcp(external, []);
    expect(narrowed.servers).toEqual([]);
    const args = withExternalMcpArgs("claude", ["--model", "x"], narrowed);
    expect(args).toContain("--strict-mcp-config");
    expect(JSON.parse(args[args.indexOf("--mcp-config") + 1]!).mcpServers).toEqual({});
  });

  it("refuses to launch without readable hub metadata", () => {
    expect(() => narrowPublishedMcp(undefined, ["arc"])).toThrow(/cannot be restricted/);
    expect(() => narrowPublishedMcp({ externalMcp: { nope: 1 } }, ["arc"])).toThrow(
      /cannot be restricted/,
    );
    const published = narrowPublishedMcp({ externalMcp: external }, ["arc"]);
    expect(parseExternalMcp(published.externalMcp)?.servers.map((s) => s.name)).toEqual(["arc"]);
  });
});
