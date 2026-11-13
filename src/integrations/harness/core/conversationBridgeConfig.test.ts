import { expect, it } from "vitest";
import { withoutConversationBridge } from "./conversationBridgeConfig";
it("removes conversation config only, preserving custom servers and file arguments", () => {
  const config = {
    mcpServers: { "bycoda-conversation": { command: "node" }, custom: { command: "keep" } },
  };
  expect(
    withoutConversationBridge([
      "-c",
      'mcp_servers.bycoda-conversation.url="loopback"',
      "-c",
      'mcp_servers.custom.url="keep"',
      "app-server",
    ]),
  ).toEqual(["-c", 'mcp_servers.custom.url="keep"', "app-server"]);
  expect(
    withoutConversationBridge([
      "--print",
      "--mcp-config",
      JSON.stringify(config),
      "--mcp-config",
      "user.json",
    ]),
  ).toEqual([
    "--print",
    "--mcp-config",
    JSON.stringify({ mcpServers: { custom: { command: "keep" } } }),
    "--mcp-config",
    "user.json",
  ]);
});
