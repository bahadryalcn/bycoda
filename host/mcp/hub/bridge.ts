/** Harness bridge commands and the MCP tool group each one serves. */
const BRIDGE_GROUPS: Partial<Record<string, "conversation" | "runtime-logs" | "social">> = {
  harness_conversation_tools_bridge: "conversation",
  harness_runtime_logs_bridge: "runtime-logs",
  harness_social_bridge: "social",
};

export function bridgeToolGroup(command: string) {
  return BRIDGE_GROUPS[command];
}
