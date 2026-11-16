import { useState } from "react";
import { t } from "../../../shared/i18n";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { InlineError } from "../../../shared/ui/InlineError";
import { MiddleTruncate } from "../../../shared/ui/MiddleTruncate";
import { Sheet } from "../../../shared/ui/Sheet";
import { Group, Row, Toggle } from "../../../shared/ui/settings";
import { Copy, FolderOpen } from "../../../shared/ui/icons";
import { copyText } from "../../../platform/tauri/clipboard";
import { revealPath } from "../../../platform/tauri/fs";
import { canSignInMcp, MCP_PROVIDER_LABELS } from "../model/mcp";
import type { McpCatalogEntry, McpEntryStatus } from "../model/mcpCatalog";
import type { McpServerRow } from "../model/mcpSettingsCache";
import type { McpHub } from "../hooks/useMcpHub";
import { ProviderIcon, scopeLabel } from "./McpAddServer";
import { McpServerConfigEditor } from "./McpServerConfigEditor";

export const STATUS_TONE: Record<McpEntryStatus, BadgeTone> = {
  ready: "success",
  "sign-in": "warning",
  expired: "warning",
  configured: "neutral",
  off: "neutral",
};

export function statusLabel(status: McpEntryStatus): string {
  return status === "ready"
    ? t("Ready")
    : status === "sign-in"
      ? t("Needs sign-in")
      : status === "expired"
        ? t("Sign-in expired")
        : status === "off"
          ? t("Off")
          : t("Configured");
}

/** Where the Host found a server, in the owner's words. */
export function sourceLabel(source: string): string {
  if (source === "claude-plugin") return t("Claude plugin");
  if (source === "claude-account") return t("Claude account");
  if (source === "codex-account") return t("Codex account");
  if (source === "claude-project") return t("Claude Code project");
  if (source === "codex-project") return t("Codex project");
  if (source === "claude") return MCP_PROVIDER_LABELS.claude;
  if (source === "codex") return MCP_PROVIDER_LABELS.codex;
  if (source === "opencode") return MCP_PROVIDER_LABELS.opencode;
  return source;
}

export type McpRowActions = {
  /** An operation is running; every other change waits. */
  locked: boolean;
  busyKey: string;
  canToggle: (server: McpServerRow) => boolean;
  toggleBlockedReason: (server: McpServerRow) => string | undefined;
  setEnabled: (server: McpServerRow) => Promise<void>;
  providerSignIn: (server: McpServerRow) => Promise<void>;
  remove: (server: McpServerRow) => Promise<void>;
  refresh: () => Promise<void>;
};

/** Everything about one server in one place: session use, Host sign-in and every provider file that declares it. */
export function McpServerDetail({
  entry,
  status,
  cwd,
  globalOnly,
  hub,
  actions,
  onClose,
}: {
  entry: McpCatalogEntry;
  status: McpEntryStatus;
  cwd: string;
  globalOnly: boolean;
  hub: McpHub;
  actions: McpRowActions;
  onClose: () => void;
}) {
  const hubEntry = entry.hub;
  const policy = hub.loading?.policy;
  const transport = hubEntry?.kind ?? entry.configs[0]?.transport ?? "";
  const hubLocked = hub.saving || !!hub.busy || !!hub.loading?.corrupt;
  const [fileError, setFileError] = useState("");
  return (
    <Sheet
      side="end"
      size="40rem"
      title={entry.name}
      description={[transport.toUpperCase(), statusLabel(status)].filter(Boolean).join(" · ")}
      onClose={onClose}
    >
      <div className="grid gap-6">
        {hub.error ? (
          <InlineError
            details={hub.error}
            secondaryAction={{ label: t("Dismiss"), onClick: hub.dismissError }}
          />
        ) : null}
        {fileError ? (
          <InlineError
            details={fileError}
            secondaryAction={{ label: t("Dismiss"), onClick: () => setFileError("") }}
          />
        ) : null}
        {hubEntry ? (
          <Group title={t("Sessions")}>
            {hubEntry.kind === "http" ? (
              <Row
                label={t("bycoda sign-in")}
                info={t("bycoda keeps this login so every session can use the server.")}
              >
                <div className="flex items-center gap-2">
                  <Badge
                    size="sm"
                    tone={
                      hubEntry.oauth === "signed-in"
                        ? "success"
                        : hubEntry.oauth === "error"
                          ? "danger"
                          : hubEntry.oauth === "expired"
                            ? "warning"
                            : "neutral"
                    }
                  >
                    {hubEntry.oauth === "signed-in"
                      ? t("Signed in")
                      : hubEntry.oauth === "expired"
                        ? t("Expired")
                        : hubEntry.oauth === "error"
                          ? t("Sign-in failed")
                          : t("Not signed in")}
                  </Badge>
                  {hubEntry.oauth === "signed-in" || hubEntry.oauth === "expired" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={hubLocked}
                      onClick={() => void hub.signOut(hubEntry.name)}
                    >
                      {t("Sign out")}
                    </Button>
                  ) : null}
                  {hubEntry.oauth !== "signed-in" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={hub.busy === hubEntry.name || hub.waiting === hubEntry.name}
                      disabled={hubLocked || hub.waiting === hubEntry.name}
                      onClick={() => void hub.signIn(hubEntry.name)}
                    >
                      {t("Sign in")}
                    </Button>
                  ) : null}
                </div>
              </Row>
            ) : null}
            {policy ? (
              <Row
                label={t("Start with every session")}
                info={t("Off: the server starts the first time a session uses it.")}
                disabled={policy.mode === "always" || !hubEntry.directEligible || hubLocked}
                disabledReason={
                  policy.mode === "always"
                    ? t("Every server already starts with each session.")
                    : !hubEntry.directEligible
                      ? t("Sign in first.")
                      : undefined
                }
              >
                <Toggle
                  label={t("Start {p0} with every session", { p0: entry.name })}
                  on={policy.mode === "always" || hubEntry.direct}
                  disabled={policy.mode === "always" || !hubEntry.directEligible || hubLocked}
                  onChange={(on) => void hub.setDirect(hubEntry.name, on)}
                />
              </Row>
            ) : null}
            <Row label={t("Found in")}>
              <span className="flex flex-wrap justify-end gap-1">
                {hubEntry.sources.map((source) => (
                  <Badge key={source} size="sm" tone="neutral">
                    {sourceLabel(source)}
                  </Badge>
                ))}
              </span>
            </Row>
          </Group>
        ) : null}
        {entry.configs.map((server) => {
          const key = `${server.provider}:${server.scope}:${server.configPath}:${server.name}`;
          const blocked = actions.toggleBlockedReason(server);
          return (
            <Group
              key={key}
              title={
                <span className="inline-flex items-center gap-2">
                  <ProviderIcon provider={server.provider} />
                  {`${MCP_PROVIDER_LABELS[server.provider]} · ${scopeLabel(server.scope)}`}
                </span>
              }
            >
              <Row label={t("Enabled")} disabled={!!blocked} disabledReason={blocked}>
                <Toggle
                  label={t("Enable {p0} in {p1}", {
                    p0: server.name,
                    p1: `${MCP_PROVIDER_LABELS[server.provider]} · ${scopeLabel(server.scope)}`,
                  })}
                  on={server.enabled !== false}
                  disabled={actions.locked || !actions.canToggle(server)}
                  onChange={() => void actions.setEnabled(server)}
                />
              </Row>
              {server.configPath ? (
                <Row label={t("File")}>
                  <span className="flex min-w-0 items-center gap-1">
                    <MiddleTruncate size="caption" tone="secondary">
                      {server.configPath}
                    </MiddleTruncate>
                    <Button
                      variant="ghost"
                      iconOnly
                      size="sm"
                      label={t("Show in folder")}
                      onClick={() =>
                        void revealPath(server.configPath).catch((cause) =>
                          setFileError(String(cause)),
                        )
                      }
                    >
                      <FolderOpen className="icon-sm" />
                    </Button>
                    <Button
                      variant="ghost"
                      iconOnly
                      size="sm"
                      label={t("Copy config path")}
                      onClick={() =>
                        void copyText(server.configPath).catch((cause) =>
                          setFileError(String(cause)),
                        )
                      }
                    >
                      <Copy className="icon-sm" />
                    </Button>
                  </span>
                </Row>
              ) : null}
              {server.configPath ? (
                <Row label={t("Configuration")} stacked>
                  <McpServerConfigEditor
                    server={server}
                    cwd={cwd}
                    globalOnly={globalOnly}
                    disabled={actions.locked}
                    onSaved={actions.refresh}
                  />
                </Row>
              ) : null}
              {canSignInMcp(server) ? (
                <Row
                  label={t("{p0} sign-in", { p0: MCP_PROVIDER_LABELS[server.provider] })}
                  info={t("Signs in through the provider's own CLI, for use outside bycoda.")}
                >
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={actions.busyKey === `${key}:login`}
                    disabled={actions.locked}
                    onClick={() => void actions.providerSignIn(server)}
                  >
                    {t("Sign in")}
                  </Button>
                </Row>
              ) : null}
              {server.provider === "claude" ? (
                <Row label={t("Remove from {p0}", { p0: scopeLabel(server.scope) })}>
                  <Button
                    size="sm"
                    tone="danger"
                    loading={actions.busyKey === `${key}:remove`}
                    disabled={actions.locked}
                    onClick={() => void actions.remove(server)}
                  >
                    {t("Remove")}
                  </Button>
                </Row>
              ) : null}
            </Group>
          );
        })}
        {entry.configs.length === 0 && hubEntry ? (
          <DescriptionList size="sm">
            <DescriptionItem term={t("Configuration")}>
              {t("Managed by {p0}. Edit it there.", {
                p0: hubEntry.sources.map(sourceLabel).join(", "),
              })}
            </DescriptionItem>
          </DescriptionList>
        ) : null}
      </div>
    </Sheet>
  );
}
