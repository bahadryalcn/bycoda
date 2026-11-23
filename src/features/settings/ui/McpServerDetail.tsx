import { useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { InlineError } from "../../../shared/ui/InlineError";
import { MiddleTruncate } from "../../../shared/ui/MiddleTruncate";
import { Sheet } from "../../../shared/ui/Sheet";
import { Group, Row, Toggle, useLeaveGuard } from "../../../shared/ui/settings";
import { FolderOpen } from "../../../shared/ui/icons";
import { CopyButton } from "../../../shared/ui/CopyButton";
import { revealPath } from "../../../platform/tauri/fs";
import {
  canSignInMcp,
  MCP_PROVIDER_LABELS,
  scopeLabel,
  type ManagedMcpIdentity,
  type ManagedMcpConfig,
} from "../model/mcp";
import { confirmInApp } from "../../../shared/model/appConfirm";
import { mcpEntryLabel, type McpCatalogEntry, type McpEntryStatus } from "../model/mcpCatalog";
import type { McpServerRow } from "../model/mcpSettingsCache";
import type { McpHub } from "../hooks/useMcpHub";
import type { RemoteMcpConfigTarget } from "../model/mcpConfigTarget";
import { projectName } from "../../../shared/lib/paths";
import { errorText } from "../../../shared/lib/errors";
import { AddServerModal, ProviderIcon } from "./McpAddServer";
import { McpServerConfigEditor } from "./McpServerConfigEditor";
import { McpProjectCredentials } from "./McpProjectCredentials";

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
  if (source === "bycoda" || source === "bycoda-project")
    return `bycoda Hub · ${scopeLabel(source === "bycoda" ? "user" : "project")}`;
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
  remote,
  machineName,
  hub,
  actions,
  stale = false,
  onClose,
}: {
  entry: McpCatalogEntry;
  status: McpEntryStatus;
  cwd: string;
  globalOnly: boolean;
  remote?: RemoteMcpConfigTarget;
  machineName?: string;
  hub: McpHub;
  actions: McpRowActions;
  stale?: boolean;
  onClose: () => void;
}) {
  const hubEntry = entry.hub;
  const managed = hubEntry?.managed;
  const hostHttp = !!managed && hubEntry?.kind === "http";
  const policy = hub.loading?.policy;
  const transport = hubEntry?.kind ?? entry.configs[0]?.transport ?? "";
  const hubLocked =
    stale ||
    hub.saving ||
    !!hub.busy ||
    !!hub.signingIn ||
    !!hub.loading?.corrupt ||
    managed?.enabled === false;
  const configLocked = stale || actions.locked;
  const staleReason = stale ? t("This server is no longer listed.") : undefined;
  const hubLockedReason =
    staleReason ??
    (hub.loading?.corrupt
      ? t("Hub settings could not be read.")
      : managed?.enabled === false
        ? t("Enable this server first.")
        : undefined);
  const [fileError, setFileError] = useState("");
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [managedEditor, setManagedEditor] = useState<
    ManagedMcpIdentity & { config: ManagedMcpConfig }
  >();
  const [managedBusy, setManagedBusy] = useState<"edit" | "remove" | "toggle" | "">("");
  const changingManaged = useRef(false);
  const manageServer = hub.manageServer;
  const credentialRequest = hub.projectCredentials;
  const credentialConfigured = hubEntry?.projectCredentialsConfigured === true;
  // Close button, Escape and backdrop all reach `onClose`; Remove can end the entry the draft belongs to.
  const leave = useLeaveGuard();

  async function changeManaged(action: "edit" | "remove" | "toggle") {
    if (!managed || !manageServer || changingManaged.current) return;
    changingManaged.current = true;
    setManagedBusy(action);
    setFileError("");
    try {
      if (action === "toggle") {
        await manageServer(managed.scope, {
          action: "setEnabled",
          name: managed.name,
          revision: managed.revision,
          enabled: !managed.enabled,
        });
      } else if (action === "edit") {
        const result = await manageServer(managed.scope, { action: "get", name: managed.name });
        if ("config" in result) setManagedEditor({ ...managed, ...result });
      } else if (
        await confirmInApp({
          title: t("Remove MCP server?"),
          message: t(
            "“{p0}” is removed from the {p1} scope. Conversations that use it lose its tools; you can add it again later.",
            { p0: managed.name, p1: scopeLabel(managed.scope) },
          ),
          confirmLabel: t("Remove server"),
          tone: "danger",
        })
      ) {
        await manageServer(managed.scope, {
          action: "remove",
          name: managed.name,
          revision: managed.revision,
        });
        onClose();
      }
    } catch (cause) {
      setFileError(errorText(cause));
    } finally {
      changingManaged.current = false;
      setManagedBusy("");
    }
  }
  return (
    <>
      <Sheet
        side="end"
        size="md"
        title={mcpEntryLabel(entry)}
        description={[
          machineName,
          globalOnly ? t("Global") : projectName(cwd),
          transport.toUpperCase(),
          stale ? t("Unavailable") : statusLabel(status),
        ]
          .filter(Boolean)
          .join(" · ")}
        onClose={() => {
          if (!changingManaged.current) leave.guard(onClose);
        }}
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
            <Group title={t("Use in bycoda")}>
              {credentialRequest && (!globalOnly || managed?.scope === "user") ? (
                <Row
                  label={globalOnly ? t("Credentials") : t("Project credentials")}
                  description={
                    globalOnly
                      ? undefined
                      : credentialConfigured
                        ? t("Saved on this project’s Host.")
                        : t("Use a token or environment variables for this project.")
                  }
                >
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={configLocked || managed?.enabled === false}
                    disabledReason={
                      staleReason ??
                      (managed?.enabled === false ? t("Enable this server first.") : undefined)
                    }
                    onClick={() => setCredentialsOpen(true)}
                  >
                    {credentialConfigured ? t("Manage credentials") : t("Set credentials")}
                  </Button>
                </Row>
              ) : null}
              {hubEntry.kind === "http" &&
              !credentialConfigured &&
              !hubEntry.credentialsConfigured ? (
                <Row
                  label={t("bycoda sign-in")}
                  info={t("bycoda keeps this login so every session can use the server.")}
                >
                  <div className="flex flex-wrap items-center justify-end gap-2">
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
                        ? hubEntry.oauthInherited
                          ? t("Uses global sign-in")
                          : t("Signed in")
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
                        disabledReason={hubLockedReason}
                        onClick={() => void hub.signOut(hubEntry.name)}
                      >
                        {hubEntry.oauthInherited ? t("Disconnect for this project") : t("Sign out")}
                      </Button>
                    ) : null}
                    {hubEntry.oauth !== "signed-in" || hubEntry.oauthInherited ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={hub.busy === hubEntry.name || hub.waiting === hubEntry.name}
                        disabled={hubLocked || hub.waiting === hubEntry.name}
                        onClick={() => void hub.signIn(hubEntry.name)}
                      >
                        {hubEntry.oauthInherited ? t("Use a different account") : t("Sign in")}
                      </Button>
                    ) : null}
                    {hub.signingIn === hubEntry.name && hub.cancelSignIn ? (
                      <Button size="sm" variant="ghost" onClick={hub.cancelSignIn}>
                        {t("Cancel")}
                      </Button>
                    ) : null}
                  </div>
                </Row>
              ) : null}
              {hostHttp ? (
                <Row label={t("Start MCP servers")}>{t("When needed")}</Row>
              ) : policy ? (
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
              {!managed ? (
                <Row label={t("Found in")}>
                  <span className="flex flex-wrap justify-end gap-1">
                    {hubEntry.sources.map((source) => (
                      <Badge key={source} size="sm" tone="neutral">
                        {sourceLabel(source)}
                      </Badge>
                    ))}
                  </span>
                </Row>
              ) : null}
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
                    disabled={configLocked || !actions.canToggle(server)}
                    onChange={() => void actions.setEnabled(server)}
                  />
                </Row>
                {server.configPath ? (
                  <Row label={t("File")}>
                    <span className="flex min-w-0 items-center gap-1">
                      <MiddleTruncate size="caption" tone="secondary">
                        {server.configPath}
                      </MiddleTruncate>
                      {!remote ? (
                        <Button
                          variant="ghost"
                          iconOnly
                          size="sm"
                          label={t("Show in folder")}
                          onClick={() =>
                            void revealPath(server.configPath).catch((cause) =>
                              setFileError(errorText(cause)),
                            )
                          }
                        >
                          <FolderOpen className="icon-sm" />
                        </Button>
                      ) : null}
                      <CopyButton
                        iconOnly
                        size="sm"
                        label={t("Copy config path")}
                        text={server.configPath}
                        resetKeys={[server.configPath]}
                        onCopyError={(cause) => setFileError(errorText(cause))}
                      />
                    </span>
                  </Row>
                ) : null}
                {server.configPath ? (
                  <Row label={t("Configuration")} stacked>
                    <McpServerConfigEditor
                      server={server}
                      cwd={cwd}
                      globalOnly={globalOnly}
                      remote={remote}
                      disabled={configLocked}
                      onSaved={actions.refresh}
                    />
                  </Row>
                ) : null}
                {!remote && canSignInMcp(server) ? (
                  <Row
                    label={t("{p0} sign-in", { p0: MCP_PROVIDER_LABELS[server.provider] })}
                    info={t("Signs in through the provider's own CLI, for use outside bycoda.")}
                  >
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={actions.busyKey === `${key}:login`}
                      disabled={configLocked}
                      onClick={() => void actions.providerSignIn(server)}
                    >
                      {t("Sign in")}
                    </Button>
                  </Row>
                ) : null}
                {server.provider === "claude" && (!remote || !!server.configPath) ? (
                  <Row label={t("Remove from {p0}", { p0: scopeLabel(server.scope) })}>
                    <Button
                      size="sm"
                      tone="danger"
                      loading={actions.busyKey === `${key}:remove`}
                      disabled={configLocked}
                      onClick={() => leave.guard(() => void actions.remove(server))}
                    >
                      {t("Remove")}
                    </Button>
                  </Row>
                ) : null}
              </Group>
            );
          })}
          {managed && manageServer ? (
            <Group title={sourceLabel(managed.scope === "project" ? "bycoda-project" : "bycoda")}>
              <Row label={t("Enabled")}>
                <Toggle
                  label={t("Enable {p0} in {p1}", {
                    p0: managed.name,
                    p1: scopeLabel(managed.scope),
                  })}
                  on={managed.enabled}
                  disabled={configLocked || !!managedBusy}
                  onChange={() => void changeManaged("toggle")}
                />
              </Row>
              <Row label={t("Configuration")}>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={managedBusy === "edit"}
                    disabled={configLocked || !!managedBusy}
                    onClick={() => void changeManaged("edit")}
                  >
                    {t("Edit")}
                  </Button>
                  <Button
                    size="sm"
                    tone="danger"
                    loading={managedBusy === "remove"}
                    disabled={configLocked || !!managedBusy}
                    onClick={() => void changeManaged("remove")}
                  >
                    {t("Remove")}
                  </Button>
                </div>
              </Row>
            </Group>
          ) : entry.configs.length === 0 && hubEntry ? (
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
      {managedEditor && manageServer ? (
        <AddServerModal
          cwd={cwd}
          globalOnly={globalOnly}
          machineName={machineName}
          initialProvider="claude"
          manageServer={manageServer}
          editing={managedEditor}
          onClose={() => setManagedEditor(undefined)}
          onAdded={async () => {}}
        />
      ) : null}
      {credentialsOpen && hubEntry && credentialRequest ? (
        <McpProjectCredentials
          name={hubEntry.name}
          displayName={mcpEntryLabel(entry)}
          machineName={machineName ?? t("This computer")}
          projectName={globalOnly ? undefined : projectName(cwd)}
          kind={hubEntry.kind}
          configured={credentialConfigured}
          request={credentialRequest}
          onClose={() => setCredentialsOpen(false)}
        />
      ) : null}
      {leave.dialog}
    </>
  );
}
