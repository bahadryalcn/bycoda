import { describe, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("./child", () => ({ invokeProviderCommand: invoke }));
import {
  runtimeLogsAcpServers,
  runtimeLogsBridge,
  runtimeLogsCliHint,
  runtimeLogsSpawnArgs,
} from "./runtimeLogsBridge";
import { socialSpawnArgs } from "./socialBridge";

const bridge = {
  command: "C:\\Program Files\\nodejs\\node.exe",
  args: ["G:\\bycoda Host\\host.mjs"],
};
describe("Provider runtime log bridge", () => {
  it("merges runtime log MCP with existing Claude social and custom tools", () => {
    const args = socialSpawnArgs("claude", ["--print", "--output-format", "stream-json"], bridge);
    const launch = runtimeLogsSpawnArgs("claude", args, bridge);
    expect(launch.filter((arg) => arg === "--mcp-config")).toHaveLength(1);
    const config = JSON.parse(launch[launch.indexOf("--mcp-config") + 1]);
    expect(Object.keys(config.mcpServers)).toEqual(["bycoda-social", "bycoda-runtime-logs"]);
    expect(config.mcpServers["bycoda-runtime-logs"].args).toEqual([
      ...bridge.args,
      "runtime-logs-mcp",
    ]);
    expect(JSON.stringify(config)).not.toContain("TOKEN");
    const custom = [
      "--print",
      "--mcp-config",
      JSON.stringify({ mcpServers: { custom: { command: "custom" } } }),
    ];
    const merged = runtimeLogsSpawnArgs("claude", custom, bridge);
    expect(JSON.parse(merged[2]).mcpServers.custom).toEqual({ command: "custom" });
    expect(custom).toHaveLength(3);
  });

  it("adds Codex environment forwarding after social configuration and keeps helper/auth launches intact", () => {
    const args = runtimeLogsSpawnArgs(
      "codex",
      socialSpawnArgs("codex", ["app-server"], bridge),
      bridge,
    );
    expect(args.join(" ")).toContain("mcp_servers.bycoda-runtime-logs.env_vars=");
    expect(args.join(" ")).toContain("mcp_servers.bycoda-social.command=");
    expect(args.at(-1)).toBe("app-server");
    for (const [provider, input] of [
      ["claude", ["auth", "login"]],
      ["claude", ["--strict-mcp-config"]],
      ["claude", ["--max-turns", "1"]],
      ["codex", ["login"]],
      ["codex", ["help", "app-server"]],
    ] as const)
      expect(runtimeLogsSpawnArgs(provider, [...input], bridge)).toEqual(input);
    expect(runtimeLogsSpawnArgs("codex", ["app-server"], null)).toEqual(["app-server"]);
  });

  it("uses ACP metadata and shell-safe CLI fallback without credentials", () => {
    expect(runtimeLogsAcpServers(bridge)).toEqual([
      {
        name: "bycoda-runtime-logs",
        command: bridge.command,
        args: [...bridge.args, "runtime-logs-mcp"],
        env: [],
      },
    ]);
    const hint = runtimeLogsCliHint(bridge);
    expect(hint).toContain("runtime_logs_read");
    expect(hint).toContain("read-only");
    expect(hint).not.toContain("TOKEN");
    expect(runtimeLogsCliHint(null)).toBe("");
  });

  it("normalizes child suffixes, caches only executable metadata and retries offline hosts", async () => {
    invoke.mockRejectedValueOnce(new Error("Offline"));
    expect(await runtimeLogsBridge("logs-offline")).toBeNull();
    invoke.mockResolvedValueOnce({ ...bridge, token: "never-in-renderer" });
    expect(await runtimeLogsBridge("logs-offline#2")).toEqual(bridge);
    expect(invoke).toHaveBeenLastCalledWith("harness_runtime_logs_bridge", {
      sessionId: "logs-offline",
    });
    const calls = invoke.mock.calls.length;
    expect(await runtimeLogsBridge("logs-offline#3")).toEqual(bridge);
    expect(invoke.mock.calls).toHaveLength(calls);
    invoke.mockResolvedValueOnce({ command: "node", args: [17] });
    expect(await runtimeLogsBridge("logs-malformed")).toBeNull();
  });
});
