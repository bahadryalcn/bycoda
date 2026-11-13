import { t } from "../../../shared/i18n";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { isMcpConnected, MCP_PROVIDER_LABELS, needsMcpSignIn } from "../model/mcp";
import type { McpServerRow } from "../model/mcpSettingsCache";

type McpState = "off" | "checking" | "unknown" | "connected" | "sign-in" | "unavailable";

const TONE = {
  off: "secondary",
  checking: "neutral",
  unknown: "neutral",
  connected: "success",
  "sign-in": "warning",
  unavailable: "danger",
} as const;

/** Configuration and sign-in never prove a live connection; a failed or name-only read stays unknown. */
export function mcpState(
  server: McpServerRow,
  {
    checking,
    failed,
    ambiguous = false,
  }: { checking: boolean; failed: boolean; ambiguous?: boolean },
): McpState {
  if (server.enabled === false) return "off";
  if (checking) return "checking";
  if (failed || ambiguous) return "unknown";
  if (needsMcpSignIn(server)) return "sign-in";
  if (isMcpConnected(server.status)) return "connected";
  if (/failed|error|disconnected|needs authentication/i.test(server.status)) return "unavailable";
  return "unknown";
}

/** The provider's own status text; a failed or name-only read is not repeated as current. */
function stateLabel(state: McpState, server: McpServerRow, stale: boolean): string {
  if (state === "off") return t("Disabled");
  if (state === "checking") return t("Checking…");
  if (state === "unknown" && stale) return t("Unknown");
  return server.status || t("Configured");
}

/** One dot per row; provider, transport, path and provenance stay in its hint. */
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
  const state = mcpState(server, { checking, failed, ambiguous });
  const label = stateLabel(state, server, failed || ambiguous);
  return (
    <Tooltip
      label={label}
      details={[
        `${MCP_PROVIDER_LABELS[server.provider]} · ${server.transport || "MCP"}`,
        ...(server.configPath ? [server.configPath] : []),
        ...(server.provider === "claude"
          ? [
              t(
                "Claude CLI status is matched by server name; it is not verified separately for each scope.",
              ),
            ]
          : []),
      ]}
    >
      <StatusDot
        tone={TONE[state]}
        size="fixed"
        label={label}
        data-mcp-state={state}
        tabIndex={0}
      />
    </Tooltip>
  );
}
