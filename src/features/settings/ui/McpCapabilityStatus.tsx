import { CapabilityStatus } from "../../../shared/ui/CapabilityStatus";
import { isMcpConnected } from "../model/mcp";
import type { McpServerRow } from "../model/mcpSettingsCache";

/** Configuration and sign-in do not establish a live MCP connection or tool activity. */
export function McpCapabilityStatus({
  server,
  checking,
  failed,
  ambiguous = false,
}: {
  server: McpServerRow;
  checking: boolean;
  failed: boolean;
  ambiguous?: boolean;
}) {
  return (
    <CapabilityStatus
      permission={server.enabled === false ? "disabled" : server.configPath ? "enabled" : "unknown"}
      readiness={
        failed || ambiguous
          ? "unknown"
          : checking
            ? "checking"
            : isMcpConnected(server.status)
              ? "ready"
              : /failed|error|disconnected|needs authentication/i.test(server.status)
                ? "unavailable"
                : "unknown"
      }
      activity="unknown"
    />
  );
}
