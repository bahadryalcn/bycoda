import { httpMcpArgs, mcpMetadata, type McpBridge } from "./mcpTransport";
import { invokeProviderCommand } from "./child";
import { createBridgeLookup } from "./bridgeLookup";
import type { ConfigurableBinaryProvider } from "../../../features/providers/model/providerBinaryPaths";

export type SocialBridge = McpBridge;
/** Returns executable metadata only. Native/host spawn supplies the scoped tool
 * credential directly to the child environment, never to the renderer. A slow,
 * offline or social-less Host is answered `null` after a short cap, and that
 * answer is reused briefly. */
const lookup = createBridgeLookup<SocialBridge>(async (sessionId) => {
  const bridge = await invokeProviderCommand<SocialBridge | null>("harness_social_bridge", {
    sessionId,
  });
  if (
    bridge &&
    typeof bridge.command === "string" &&
    Array.isArray(bridge.args) &&
    bridge.args.every((value) => typeof value === "string")
  )
    return mcpMetadata(bridge);
  return null;
});
export function socialBridge(sessionId: string): Promise<SocialBridge | null> {
  return lookup(sessionId.replace(/#\d+$/, ""));
}
export function socialAcpServers(bridge: SocialBridge | null) {
  return bridge
    ? [
        {
          name: "bycoda-social",
          command: bridge.command,
          args: [...bridge.args, "social-mcp"],
          env: [],
        },
      ]
    : [];
}
export function socialSpawnArgs(
  provider: ConfigurableBinaryProvider | undefined,
  args: string[],
  bridge: SocialBridge | null,
): string[] {
  if (!bridge || args.includes("--strict-mcp-config") || args.includes("--max-turns")) return args;
  const http = httpMcpArgs(provider, args, bridge, "bycoda-social", "BYCODA_SOCIAL_TOKEN");
  if (http) return http;
  const server = {
    command: bridge.command,
    args: [...bridge.args, "social-mcp"],
  };
  // MCP flags belong to conversation launches, not auth/update subcommands.
  if (provider === "claude" && args[0]?.startsWith("-"))
    return [...args, "--mcp-config", JSON.stringify({ mcpServers: { "bycoda-social": server } })];
  let commandIndex = 0;
  while (args[commandIndex] === "-c" && typeof args[commandIndex + 1] === "string")
    commandIndex += 2;
  if (provider === "codex" && args[commandIndex] === "app-server") {
    // Codex app-server reads MCP configuration at process start for new and resumed threads.
    const quote = (value: string) => JSON.stringify(value);
    return [
      "-c",
      `mcp_servers.bycoda-social.command=${quote(server.command)}`,
      "-c",
      `mcp_servers.bycoda-social.args=[${server.args.map(quote).join(",")}]`,
      "-c",
      'mcp_servers.bycoda-social.env_vars=["BYCODA_SOCIAL_TOKEN","BYCODA_SOCIAL_ENDPOINT","BYCODA_SOCIAL_ENVIRONMENT"]',
      ...args,
    ];
  }
  return args;
}
/** Short capability line; the CLI prefix is stated once by harnessRuntimeHints. */
export function socialCliHint(bridge: SocialBridge | null): string {
  if (!bridge) return "";
  return "Social media (MCP bycoda-social, CLI group social): call social_policy_get (CLI policy.get) for the target accountId before writing any post, reply or message. Drafts never authorize sending; sends need owner approval or an explicitly active rule.";
}
