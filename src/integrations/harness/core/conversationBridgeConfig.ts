/** Strip app-owned MCP launch entries after a failed spawn grant; preserve other servers. */
export function withoutConversationBridge(args: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === "-c" && value?.startsWith("mcp_servers.bycoda-conversation.")) {
      index++;
      continue;
    }
    if (arg === "--mcp-config" && value) {
      try {
        const config = JSON.parse(value);
        if (config?.mcpServers && typeof config.mcpServers === "object") {
          delete config.mcpServers["bycoda-conversation"];
          result.push(arg, JSON.stringify(config));
          index++;
          continue;
        }
      } catch {
        /* Preserve user-owned file arguments. */
      }
    }
    result.push(arg);
  }
  return result;
}
