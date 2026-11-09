import { httpMcpArgs, MCP_TOOL_TIMEOUT_SECONDS, mcpMetadata, type McpBridge } from "./mcpTransport";
import { invokeProviderCommand } from "./child";
import { createBridgeLookup } from "./bridgeLookup";
import type { ConfigurableBinaryProvider } from "../../../features/providers/model/providerBinaryPaths";
import {
  parseExternalMcp,
  rebaseExternalMcp,
  withExternalMcpArgs,
  type ExternalMcp,
} from "./externalMcpLaunch";

export type ConversationToolsBridge = McpBridge & { externalMcp?: ExternalMcp };

/** Renderer metadata has no token. Native/headless spawn supplies the grant. A slow,
 * offline or older Host is answered `null` after a short cap, reused briefly. */
const lookup = createBridgeLookup<ConversationToolsBridge>(
  async (sessionId) => {
    const bridge = await invokeProviderCommand<ConversationToolsBridge | null>(
      "harness_conversation_tools_bridge",
      { sessionId },
    );
    if (
      bridge &&
      typeof bridge.command === "string" &&
      bridge.command.length > 0 &&
      Array.isArray(bridge.args) &&
      bridge.args.every((value) => typeof value === "string")
    ) {
      // Copy only executable metadata; never forward an accidental host credential.
      const metadata: ConversationToolsBridge = mcpMetadata(bridge);
      const externalMcp = parseExternalMcp(bridge.externalMcp);
      return externalMcp
        ? { ...metadata, externalMcp: rebaseExternalMcp(externalMcp, metadata.mcpUrl) }
        : metadata;
    }
    return null;
  },
  undefined,
  undefined,
  (bridge) => Boolean(bridge.externalMcp),
);
export function conversationToolsBridge(
  sessionId: string,
): Promise<ConversationToolsBridge | null> {
  return lookup(sessionId.replace(/#\d+$/, ""));
}

/** ACP mcpServers entries carry no tool deadline, so bycoda cannot raise it for these providers;
 * logs.wait caps them at 50 s (runtime-log-wait.ts). */
export function conversationToolsAcpServers(bridge: ConversationToolsBridge | null) {
  return bridge
    ? [
        {
          name: "bycoda-conversation",
          command: bridge.command,
          args: [...bridge.args, "conversation-mcp"],
          env: [],
        },
      ]
    : [];
}

export function conversationToolsSpawnArgs(
  provider: ConfigurableBinaryProvider | undefined,
  args: string[],
  bridge: ConversationToolsBridge | null,
): string[] {
  if (!bridge || args.includes("--strict-mcp-config") || args.includes("--max-turns")) return args;
  const launch = conversationToolsBridgeArgs(provider, args, bridge);
  return bridge.externalMcp ? withExternalMcpArgs(provider, launch, bridge.externalMcp) : launch;
}

function conversationToolsBridgeArgs(
  provider: ConfigurableBinaryProvider | undefined,
  args: string[],
  bridge: ConversationToolsBridge,
): string[] {
  const http = httpMcpArgs(
    provider,
    args,
    bridge,
    "bycoda-conversation",
    "BYCODA_CONVERSATION_TOKEN",
    MCP_TOOL_TIMEOUT_SECONDS,
  );
  if (http) return http;
  const server = {
    command: bridge.command,
    args: [...bridge.args, "conversation-mcp"],
  };
  if (provider === "claude" && args[0]?.startsWith("-")) {
    // Per-server deadline: Claude uses this over MCP_TOOL_TIMEOUT, which would also
    // change the deadline of the user's own MCP servers.
    const claudeServer = { ...server, timeout: MCP_TOOL_TIMEOUT_SECONDS * 1000 };
    // Merge the app's existing Social Media MCP config, preserving other servers.
    const index = args.lastIndexOf("--mcp-config");
    if (index >= 0 && args[index + 1]) {
      try {
        const config = JSON.parse(args[index + 1]);
        if (config && typeof config === "object" && !Array.isArray(config)) {
          const next = [...args];
          next[index + 1] = JSON.stringify({
            ...config,
            mcpServers: { ...config.mcpServers, "bycoda-conversation": claudeServer },
          });
          return next;
        }
      } catch {
        /* A user-owned file/config argument remains intact. */
      }
    }
    return [
      ...args,
      "--mcp-config",
      JSON.stringify({ mcpServers: { "bycoda-conversation": claudeServer } }),
    ];
  }
  let commandIndex = 0;
  while (args[commandIndex] === "-c" && typeof args[commandIndex + 1] === "string")
    commandIndex += 2;
  if (provider === "codex" && args[commandIndex] === "app-server") {
    const quote = (value: string) => JSON.stringify(value);
    return [
      "-c",
      `mcp_servers.bycoda-conversation.command=${quote(server.command)}`,
      "-c",
      `mcp_servers.bycoda-conversation.args=[${server.args.map(quote).join(",")}]`,
      "-c",
      `mcp_servers.bycoda-conversation.tool_timeout_sec=${MCP_TOOL_TIMEOUT_SECONDS}`,
      "-c",
      'mcp_servers.bycoda-conversation.env_vars=["BYCODA_CONVERSATION_TOKEN","BYCODA_CONVERSATION_ENDPOINT","BYCODA_CONVERSATION_ENVIRONMENT","BYCODA_APP_ENDPOINT","BYCODA_APP_TOKEN"]',
      ...args,
    ];
  }
  return args;
}

/** Short capability line; each tool carries its own detailed rules. */
export function conversationToolsCliHint(bridge: ConversationToolsBridge | null): string {
  if (!bridge) return "";
  return 'Conversation Tools (MCP bycoda-conversation, CLI group conversation): session-scoped bycoda app APIs for sessions, tasks, goals, crews, automations, stewards, notes, inbox, files, git, browser, devices, dev servers, terminals, saved SSH servers, logs, skills, visuals, delegation and app UI. Use them when they fit the task; each tool description carries its own rules. For bycoda feature work or how-to questions about the app, read the bycoda skill (skills.read name "bycoda") and the project feature card when one exists. Refer to another session only by its tool-returned markdownReference; reading it is not coordination.';
}
