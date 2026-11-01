import { describe, expect, it } from "vitest";
import { canSignInMcp, isMcpConnected, parseClaudeMcpList, type McpConnection } from "./mcp";

it("offers OAuth only for enabled remote connections with a supported CLI", () => {
  const connection: McpConnection = { provider: "codex", name: "cloudflare", scope: "user", configPath: "/config.toml", transport: "http" };
  for (const provider of ["claude", "codex", "cursor", "opencode"] as const) {
    for (const transport of ["http", "sse", "streamable-http", "remote"]) {
      expect(canSignInMcp({ ...connection, provider, transport })).toBe(true);
    }
  }
  for (const provider of ["claude_desktop"] as const) {
    expect(canSignInMcp({ ...connection, provider })).toBe(false);
  }
  for (const transport of ["", "stdio", "local", "ws", "unknown"]) {
    expect(canSignInMcp({ ...connection, transport })).toBe(false);
  }
  expect(canSignInMcp({ ...connection, enabled: false })).toBe(false);
});

it("recognizes only confirmed connected health as a repeat sign-in", () => {
  for (const status of ["Connected", "✔ Connected", "✓ Connected"]) expect(isMcpConnected(status)).toBe(true);
  for (const status of ["Configured", "Disabled", "Disconnected", "Needs authentication", "Unknown", "Error"]) expect(isMcpConnected(status)).toBe(false);
});

describe("Claude MCP list", () => {
  it("keeps server names and health while omitting launch details", () => {
    expect(
      parseClaudeMcpList(
        "Checking MCP server health...\nnotion: https://example.com/mcp - ! Needs authentication\nlocal_tools: npx tools - --token secret - ✔ Connected\n",
      ),
    ).toEqual([
      { name: "notion", status: "! Needs authentication" },
      { name: "local_tools", status: "✔ Connected" },
    ]);
  });
});
