import { httpMcpArgs, mcpMetadata, type McpBridge } from "./mcpTransport";
import { invokeProviderCommand } from "./child";
import type { ConfigurableBinaryProvider } from "../../../features/providers/model/providerBinaryPaths";

export type ConversationToolsBridge = McpBridge;
const cache = new Map<string, ConversationToolsBridge>();

/** Renderer metadata has no token. Native/headless spawn supplies the grant. */
export async function conversationToolsBridge(
  sessionId: string,
): Promise<ConversationToolsBridge | null> {
  const primary = sessionId.replace(/#\d+$/, "");
  if (cache.has(primary)) return cache.get(primary)!;
  try {
    const bridge = await invokeProviderCommand<ConversationToolsBridge | null>(
      "harness_conversation_tools_bridge",
      {
        sessionId: primary,
      },
    );
    if (
      bridge &&
      typeof bridge.command === "string" &&
      bridge.command.length > 0 &&
      Array.isArray(bridge.args) &&
      bridge.args.every((value) => typeof value === "string")
    ) {
      // Copy only executable metadata; never forward an accidental host credential.
      const metadata = mcpMetadata(bridge);
      cache.set(primary, metadata);
      return metadata;
    }
  } catch {
    /* An older or offline host must not prevent ordinary provider work. */
  }
  return null;
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
  const server = { command: bridge.command, args: [...bridge.args, "conversation-mcp"] };
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
  return 'Conversation Tools (MCP bycoda-conversation, CLI group conversation): other sessions in this project, tasks, notes, automations, Inbox/PR reviews, devices, machines, terminals, dev servers, logs, skills and app UI panels through direct app APIs; prefer them over Computer Use or /operator. Use them without being asked when they fit: e.g. other sessions -> sessions.read, start the app -> devServers.start, browser/server errors -> logs.read, separate work to run later or track on the board -> tasks.create (split the current request with your own subagents when you have them), schedules -> automations.create. Before using bycoda features or answering how-to questions about the app, read the bycoda skill (skills.read name "bycoda"). For feature work, search and read its project feature card, fix every affected surface including the Host operation, verify UI changes with opened screenshots, and check build status/source identity before treating a screenshot as a new defect. Discover actions with conversation_tools_list (CLI tools.list); each tool describes its own rules. Reads do not authorize sends, merges or publishing; Inbox and PR writes need native owner approval.';
}
