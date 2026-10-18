import { describe, expect, it } from "vitest";
import { conversationToolsSpawnArgs, conversationToolsAcpServers } from "./conversationToolsBridge";
import { runtimeLogsSpawnArgs, runtimeLogsAcpServers } from "./runtimeLogsBridge";
import { socialSpawnArgs, socialAcpServers } from "./socialBridge";
import { mcpMetadata } from "./mcpTransport";

describe("verified provider HTTP MCP configuration", () => {
  const groups = [
    [
      "conversation",
      "BYCODA_CONVERSATION_TOKEN",
      conversationToolsSpawnArgs,
      conversationToolsAcpServers,
    ],
    ["runtime-logs", "BYCODA_RUNTIME_LOGS_TOKEN", runtimeLogsSpawnArgs, runtimeLogsAcpServers],
    ["social", "BYCODA_SOCIAL_TOKEN", socialSpawnArgs, socialAcpServers],
  ] as const;

  it("merges all three Claude HTTP servers with env references and preserves custom tools", () => {
    let args = [
      "--print",
      "--mcp-config",
      JSON.stringify({ mcpServers: { custom: { command: "custom" } } }),
    ];
    for (const [scope, env, configure] of groups) {
      const bridge = {
        command: "node",
        args: ["host.mjs"],
        mcpUrl: `http://127.0.0.1:1234/mcp/${scope}`,
      };
      args = configure("claude", args, bridge);
      const server = JSON.parse(args[2]).mcpServers[`bycoda-${scope}`];
      expect(server).toEqual({
        type: "http",
        url: bridge.mcpUrl,
        headers: { Authorization: `Bearer \${${env}}` },
      });
    }
    expect(args.filter((arg) => arg === "--mcp-config")).toHaveLength(1);
    expect(Object.keys(JSON.parse(args[2]).mcpServers)).toHaveLength(4);
  });

  it("uses Codex bearer_token_env_var for all groups and keeps ACP on the proxy", () => {
    let args = ["app-server"];
    for (const [scope, env, configure, acp] of groups) {
      const bridge = {
        command: "node",
        args: ["host.mjs"],
        mcpUrl: `http://127.0.0.1:1234/mcp/${scope}`,
      };
      args = configure("codex", args, bridge);
      expect(args).toContain(`mcp_servers.bycoda-${scope}.bearer_token_env_var="${env}"`);
      expect(args).toContain(`mcp_servers.bycoda-${scope}.url="${bridge.mcpUrl}"`);
      expect(acp(bridge)[0]).toMatchObject({
        command: "node",
        args: ["host.mjs", `${scope}-mcp`],
        env: [],
      });
      for (const input of [["login"], ["--strict-mcp-config"], ["--max-turns", "1"]])
        expect(configure("codex", input, bridge)).toEqual(input);
      expect(configure("gemini", ["--print"], bridge)).toEqual(["--print"]);
    }
    expect(args.join(" ")).not.toContain(".command=");
    expect(args.at(-1)).toBe("app-server");
  });

  it("accepts only credential-free local metadata and falls back for older hosts", () => {
    const base = { command: "node", args: ["host.mjs"] };
    for (const mcpUrl of [
      "https://other/mcp/social",
      "http://secret@127.0.0.1/mcp/social",
      "http://127.0.0.1/mcp/social?token=secret",
    ])
      expect(mcpMetadata({ ...base, mcpUrl, token: "secret" } as typeof base)).toEqual(base);
    expect(socialSpawnArgs("codex", ["app-server"], base).join(" ")).toContain(".command=");
  });

  it("keeps every stdio bridge when Codex already has config flags, regardless of insertion order", () => {
    const base = ["-c", 'model="configured"', "app-server"];
    for (const ordered of [groups, [...groups].reverse()]) {
      let args = [...base];
      for (const [, , configure] of ordered)
        args = configure("codex", args, { command: "node", args: ["host.mjs"] });
      for (const [scope] of groups)
        expect(args.join(" ")).toContain(`mcp_servers.bycoda-${scope}.command=`);
      expect(args.slice(-base.length)).toEqual(base);
    }
  });
});
