import { describe, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("./child", () => ({ invokeProviderCommand: invoke }));
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
    expect(hint).toContain("conversation_tools_list");
    expect(hint).toContain("native owner approval");
    expect(hint).toContain('skills.read name "bycoda"');
    expect(hint).not.toContain("TOKEN");
    expect(conversationToolsCliHint(null)).toBe("");
  });

  it("normalizes child suffixes, caches only executable metadata and retries offline hosts", async () => {
    invoke.mockRejectedValueOnce(new Error("Offline"));
    expect(await conversationToolsBridge("logs-offline")).toBeNull();
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
});
