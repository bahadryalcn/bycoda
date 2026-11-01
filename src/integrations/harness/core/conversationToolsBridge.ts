import { httpMcpArgs, mcpMetadata, type McpBridge } from "./mcpTransport";
import { invokeProviderCommand } from "./child";
import { createBridgeLookup } from "./bridgeLookup";
import type { ConfigurableBinaryProvider } from "../../../features/providers/model/providerBinaryPaths";

export type ConversationToolsBridge = McpBridge;

/** Renderer metadata has no token. Native/headless spawn supplies the grant. A slow,
 * offline or older Host is answered `null` after a short cap, reused briefly. */
const lookup = createBridgeLookup<ConversationToolsBridge>(async (sessionId) => {
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
  )
    // Copy only executable metadata; never forward an accidental host credential.
    return mcpMetadata(bridge);
  return null;
});
export function conversationToolsBridge(
  sessionId: string,
): Promise<ConversationToolsBridge | null> {
  return lookup(sessionId.replace(/#\d+$/, ""));
}

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
  const http = httpMcpArgs(
    provider,
    args,
    bridge,
    "bycoda-conversation",
    "BYCODA_CONVERSATION_TOKEN",
  );
  if (http) return http;
  const server = {
    command: bridge.command,
    args: [...bridge.args, "conversation-mcp"],
  };
  if (provider === "claude" && args[0]?.startsWith("-")) {
    // Merge the app's existing Social Media MCP config, preserving other servers.
    const index = args.lastIndexOf("--mcp-config");
    if (index >= 0 && args[index + 1]) {
      try {
        const config = JSON.parse(args[index + 1]);
        if (config && typeof config === "object" && !Array.isArray(config)) {
          const next = [...args];
          next[index + 1] = JSON.stringify({
            ...config,
            mcpServers: { ...config.mcpServers, "bycoda-conversation": server },
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
      JSON.stringify({ mcpServers: { "bycoda-conversation": server } }),
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
      'mcp_servers.bycoda-conversation.env_vars=["BYCODA_CONVERSATION_TOKEN","BYCODA_CONVERSATION_ENDPOINT","BYCODA_CONVERSATION_ENVIRONMENT","BYCODA_APP_ENDPOINT","BYCODA_APP_TOKEN"]',
      ...args,
    ];
  }
  return args;
}

/** Short capability line; each tool carries its own detailed rules. */
export function conversationToolsCliHint(bridge: ConversationToolsBridge | null): string {
  if (!bridge) return "";
  return 'Conversation Tools (MCP bycoda-conversation, CLI group conversation): session-scoped app APIs for work, workspace, browser/devices, providers and UI. Prefer them when they fit the task; their presence does not prove target readiness. Before using bycoda features or answering how-to questions about the app, read the bycoda skill (skills.read name "bycoda"). For feature work, search for its project feature card and read it if present; fix every affected surface including the Host operation. Scale checks, opened screenshots, cards and reporting to the T0/T1/T2 rules in AGENTS.md. Check build status/source identity before treating a screenshot as a new defect. Discover narrowly with conversation_tools_search/describe/status (CLI tools.search/describe/status); conversation_tools_list remains the legacy inventory, not a full catalog to dump into context. At the first mention of another session use its exact tool-returned markdownReference or link; never invent targets. Read before describing its work; found/read is not a coordination request or acknowledgment. Reads do not authorize sends, merges or publishing; Inbox and PR writes need native owner approval.';
}
