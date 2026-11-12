import { afterEach, describe, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("./child", () => ({ invokeProviderCommand: invoke }));
afterEach(() => vi.useRealTimers());
import {
  conversationToolsAcpServers,
  conversationToolsBridge,
  conversationToolsCliHint,
  conversationToolsSpawnArgs,
} from "./conversationToolsBridge";
import { socialSpawnArgs } from "./socialBridge";

const bridge = {
  command: "C:\\Program Files\\nodejs\\node.exe",
  args: ["G:\\bycoda Host\\host.mjs"],
};
describe("Provider conversation tool bridge", () => {
  it("merges conversation tool MCP with existing Claude social and custom tools", () => {
    const args = socialSpawnArgs("claude", ["--print", "--output-format", "stream-json"], bridge);
    const launch = conversationToolsSpawnArgs("claude", args, bridge);
    expect(launch.filter((arg) => arg === "--mcp-config")).toHaveLength(1);
    const config = JSON.parse(launch[launch.indexOf("--mcp-config") + 1]);
    expect(Object.keys(config.mcpServers)).toEqual(["bycoda-social", "bycoda-conversation"]);
    expect(config.mcpServers["bycoda-conversation"].args).toEqual([
      ...bridge.args,
      "conversation-mcp",
    ]);
    expect(JSON.stringify(config)).not.toContain("TOKEN");
    const custom = [
      "--print",
      "--mcp-config",
      JSON.stringify({ mcpServers: { custom: { command: "custom" } } }),
    ];
    const merged = conversationToolsSpawnArgs("claude", custom, bridge);
    expect(JSON.parse(merged[2]).mcpServers.custom).toEqual({ command: "custom" });
    expect(custom).toHaveLength(3);
  });

  it("adds Codex environment forwarding after social configuration and keeps helper/auth launches intact", () => {
    const args = conversationToolsSpawnArgs(
      "codex",
      socialSpawnArgs("codex", ["app-server"], bridge),
      bridge,
    );
    expect(args.join(" ")).toContain("mcp_servers.bycoda-conversation.env_vars=");
    expect(args.join(" ")).toContain("BYCODA_APP_ENDPOINT");
    expect(args.join(" ")).toContain("BYCODA_APP_TOKEN");
    expect(args.join(" ")).toContain("mcp_servers.bycoda-social.command=");
    expect(args.at(-1)).toBe("app-server");
    for (const [provider, input] of [
      ["claude", ["auth", "login"]],
      ["claude", ["--strict-mcp-config"]],
      ["claude", ["--max-turns", "1"]],
      ["codex", ["login"]],
      ["codex", ["help", "app-server"]],
    ] as const)
      expect(conversationToolsSpawnArgs(provider, [...input], bridge)).toEqual(input);
    expect(conversationToolsSpawnArgs("codex", ["app-server"], null)).toEqual(["app-server"]);
  });

  it("uses ACP metadata and shell-safe CLI fallback without credentials", () => {
    expect(conversationToolsAcpServers(bridge)).toEqual([
      {
        name: "bycoda-conversation",
        command: bridge.command,
        args: [...bridge.args, "conversation-mcp"],
        env: [],
      },
    ]);
    const hint = conversationToolsCliHint(bridge);
    expect(hint).toContain("MCP bycoda-conversation, CLI group conversation");
    expect(hint).toContain('skills.read name "bycoda"');
    expect(hint).toContain("markdownReference");
    expect(hint).not.toContain("TOKEN");
    expect(conversationToolsCliHint(null)).toBe("");
  });

  it("normalizes child suffixes, caches only executable metadata and retries offline hosts after a short pause", async () => {
    vi.useFakeTimers();
    invoke.mockRejectedValueOnce(new Error("Offline"));
    expect(await conversationToolsBridge("logs-offline")).toBeNull();
    const offlineCalls = invoke.mock.calls.length;
    expect(await conversationToolsBridge("logs-offline#2")).toBeNull();
    expect(invoke.mock.calls).toHaveLength(offlineCalls);
    vi.advanceTimersByTime(30_001);
    invoke.mockResolvedValueOnce({ ...bridge, token: "never-in-renderer" });
    expect(await conversationToolsBridge("logs-offline#2")).toEqual(bridge);
    expect(invoke).toHaveBeenLastCalledWith("harness_conversation_tools_bridge", {
      sessionId: "logs-offline",
    });
    const calls = invoke.mock.calls.length;
    expect(await conversationToolsBridge("logs-offline#3")).toEqual(bridge);
    expect(invoke.mock.calls).toHaveLength(calls);
    invoke.mockResolvedValueOnce({ command: "node", args: [17] });
    expect(await conversationToolsBridge("logs-malformed")).toBeNull();
  });

  it("keeps a valid MCP hub declaration on the bridge and drops a malformed one", async () => {
    const externalMcp = {
      servers: [
        {
          name: "arc",
          url: "http://127.0.0.1:4555/mcp/ext/arc",
          kind: "stdio",
          mode: "shared",
          sources: ["user"],
        },
      ],
      disable: { claude: [], codex: ["arc"] },
    };
    invoke.mockResolvedValueOnce({ ...bridge, externalMcp, token: "never" });
    const found = await conversationToolsBridge("hub-valid");
    // Parsing fills `codexName` from `name` when the host does not send one.
    expect(found).toEqual({
      ...bridge,
      externalMcp: {
        ...externalMcp,
        disable: { ...externalMcp.disable, opencode: [] },
        servers: externalMcp.servers.map((server) => ({ ...server, codexName: server.name })),
      },
    });
    invoke.mockResolvedValueOnce({ ...bridge, externalMcp: { servers: "nope", disable: {} } });
    expect(await conversationToolsBridge("hub-malformed")).toEqual(bridge);
  });

  it("moves hub servers onto the broker origin from mcpUrl and keeps passthrough URLs", async () => {
    const hub = {
      name: "arc",
      url: "http://127.0.0.1:4555/mcp/ext/arc",
      kind: "stdio",
      mode: "shared",
      sources: ["user"],
    };
    const passthrough = {
      name: "uiarc",
      url: "https://uiarc.dev/api/mcp",
      kind: "http",
      mode: "shared",
      sources: ["user"],
      passthrough: { url: "https://uiarc.dev/api/mcp" },
    };
    const externalMcp = { servers: [hub, passthrough], disable: { claude: [], codex: [] } };
    invoke.mockResolvedValueOnce({
      ...bridge,
      mcpUrl: "http://127.0.0.1:5511/mcp/conversation",
      externalMcp,
    });
    const found = await conversationToolsBridge("hub-broker-origin");
    expect(found?.externalMcp?.servers.map((server) => server.url)).toEqual([
      "http://127.0.0.1:5511/mcp/ext/arc",
      "https://uiarc.dev/api/mcp",
    ]);
    // Without a broker url the published relay url is the only one the launch can use.
    invoke.mockResolvedValueOnce({ ...bridge, externalMcp });
    const unbrokered = await conversationToolsBridge("hub-no-broker");
    expect(unbrokered?.externalMcp?.servers[0].url).toBe("http://127.0.0.1:4555/mcp/ext/arc");
  });

  it("sets a 300 s per-server deadline for bycoda-conversation on Claude and Codex only", () => {
    // Claude per-server `timeout` (ms) overrides MCP_TOOL_TIMEOUT; Codex `tool_timeout_sec` (s).
    const claudeStdio = conversationToolsSpawnArgs(
      "claude",
      ["--print", "--output-format", "stream-json"],
      bridge,
    );
    const stdioConfig = JSON.parse(claudeStdio[claudeStdio.indexOf("--mcp-config") + 1]);
    expect(stdioConfig.mcpServers["bycoda-conversation"].timeout).toBe(300_000);
    const http = { ...bridge, mcpUrl: "http://127.0.0.1:5175/mcp/conversation" };
    const claudeHttp = conversationToolsSpawnArgs("claude", ["--print"], http);
    const httpConfig = JSON.parse(claudeHttp[claudeHttp.indexOf("--mcp-config") + 1]);
    expect(httpConfig.mcpServers["bycoda-conversation"]).toMatchObject({
      type: "http",
      timeout: 300_000,
    });
    const codexStdio = conversationToolsSpawnArgs("codex", ["app-server"], bridge);
    expect(codexStdio).toContain("mcp_servers.bycoda-conversation.tool_timeout_sec=300");
    const codexHttp = conversationToolsSpawnArgs("codex", ["app-server"], http);
    expect(codexHttp).toEqual(
      expect.arrayContaining(["-c", "mcp_servers.bycoda-conversation.tool_timeout_sec=300"]),
    );
    expect(codexHttp.indexOf("mcp_servers.bycoda-conversation.tool_timeout_sec=300")).toBeLessThan(
      codexHttp.indexOf("app-server"),
    );
    // ACP mcpServers entries have no deadline field, so ACP providers get none from bycoda.
    expect(conversationToolsAcpServers(bridge)[0]).not.toHaveProperty("timeout");
    // Non-app-server Codex launches never receive the bycoda MCP server at all.
    expect(conversationToolsSpawnArgs("codex", ["exec"], bridge)).toEqual(["exec"]);
  });

  it("applies hub wiring only when externalMcp is present and never to isolated helper spawns", () => {
    const externalMcp = {
      servers: [
        {
          name: "arc",
          url: "http://127.0.0.1:4555/mcp/ext/arc",
          kind: "stdio" as const,
          mode: "shared" as const,
          sources: ["user"],
        },
      ],
      disable: { claude: [], codex: ["rea"] },
    };
    const withHub = { ...bridge, externalMcp };
    const interactive = ["--print", "--setting-sources=user,project,local", "--settings", "{}"];
    const launch = conversationToolsSpawnArgs("claude", [...interactive], withHub);
    expect(launch).toContain("--strict-mcp-config");
    expect(launch).toContain("--setting-sources=user,project,local");
    const config = JSON.parse(launch[launch.indexOf("--mcp-config") + 1]);
    expect(Object.keys(config.mcpServers)).toEqual(["bycoda-conversation", "arc"]);
    expect(config.mcpServers.arc.url).toBe("http://127.0.0.1:4555/mcp/ext/arc");
    const codex = conversationToolsSpawnArgs("codex", ["app-server"], withHub);
    expect(codex).not.toContain("mcp_servers.rea={enabled=false}");
    expect(codex.at(-1)).toBe("app-server");
    const isolated = [
      "--print",
      "--no-session-persistence",
      "--strict-mcp-config",
      "--mcp-config",
      JSON.stringify({ mcpServers: {} }),
    ];
    expect(conversationToolsSpawnArgs("claude", [...isolated], withHub)).toEqual(isolated);
    expect(conversationToolsSpawnArgs("claude", [...interactive], { ...bridge })).toEqual([
      ...interactive,
      "--mcp-config",
      JSON.stringify({
        mcpServers: {
          "bycoda-conversation": {
            command: bridge.command,
            args: [...bridge.args, "conversation-mcp"],
            timeout: 300_000,
          },
        },
      }),
    ]);
  });

  it("picks up the MCP hub on a later launch when the first answer was published before the hub", async () => {
    vi.useFakeTimers();
    const mcpUrl = "http://127.0.0.1:4555/mcp/conversation";
    const externalMcp = {
      servers: [
        {
          name: "arc",
          url: "http://127.0.0.1:4555/mcp/ext/arc",
          kind: "stdio",
          mode: "shared",
          sources: ["user"],
        },
      ],
      disable: { claude: [], codex: [] },
    };
    invoke.mockResolvedValueOnce({ ...bridge, mcpUrl });
    const early = await conversationToolsBridge("hub-late");
    expect(early?.externalMcp).toBeUndefined();
    const calls = invoke.mock.calls.length;
    await conversationToolsBridge("hub-late");
    expect(invoke.mock.calls).toHaveLength(calls);
    vi.advanceTimersByTime(10_001);
    invoke.mockResolvedValueOnce({ ...bridge, mcpUrl, externalMcp });
    const late = await conversationToolsBridge("hub-late");
    expect(late?.externalMcp?.servers).toHaveLength(1);
    await conversationToolsBridge("hub-late");
    expect(invoke.mock.calls).toHaveLength(calls + 1);
    // The resumed Claude launch from the installed-build report gains the hub wiring.
    const resume = [
      "--output-format",
      "stream-json",
      "--permission-prompt-tool",
      "stdio",
      "--setting-sources=user,project,local",
      "--settings",
      "{}",
      "--resume",
      "session-1",
    ];
    const launch = conversationToolsSpawnArgs("claude", resume, late);
    expect(launch.slice(0, resume.length)).toEqual(resume);
    expect(launch).toContain("--strict-mcp-config");
    const config = JSON.parse(launch[launch.lastIndexOf("--mcp-config") + 1]);
    expect(config.mcpServers.arc.url).toBe("http://127.0.0.1:4555/mcp/ext/arc");
    expect(config.mcpServers["bycoda-conversation"].url).toBe(mcpUrl);
  });
});
