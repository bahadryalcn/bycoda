import { t } from "../../../shared/i18n";
import { MCP_PROVIDER_LABELS } from "../model/mcp";
import type { McpServerRow, McpSettingsSnapshot } from "../model/mcpSettingsCache";
import { McpCapabilityStatus } from "./McpCapabilityStatus";
import styles from "./McpSettings.module.css";

/** Keep the observed state and its provider/scope provenance together. */
export function McpStatusDetails({
  server,
  checking,
  loading,
  snapshot,
}: {
  server: McpServerRow;
  checking: boolean;
  loading: boolean;
  snapshot: Pick<McpSettingsSnapshot, "servers" | "error" | "claudeError">;
}) {
  return (
    <>
      <div className={styles.status}>
        <McpCapabilityStatus
          server={server}
          checking={loading || checking}
          failed={!!snapshot.error || (server.provider === "claude" && !!snapshot.claudeError)}
          ambiguous={
            server.provider === "claude" &&
            snapshot.servers.filter(
              (entry) => entry.provider === "claude" && entry.name === server.name,
            ).length > 1
          }
        />
      </div>
      <div className={styles.details}>
        <p className={styles.metadata} title={server.configPath || undefined}>
          {MCP_PROVIDER_LABELS[server.provider]} &#183; {server.transport || "MCP"} &#183;{" "}
          {checking ? t("Checking…") : server.status}
        </p>
        {server.configPath ? (
          <details className={styles.disclosure}>
            <summary>{t("Connection details")}</summary>
            <div className={styles.detailContent}>
              <span className={styles.path}>{server.configPath}</span>
              {server.provider === "claude" ? (
                <p>
                  {t(
                    "Claude CLI status is matched by server name; it is not verified separately for each scope.",
                  )}
                </p>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
    </>
  );
}
