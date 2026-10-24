import { SshSettings } from "./SshSettings";
export { ConfigImportChoices } from "./SshConfigImportChoices";
import { SshRunbooks } from "./SshRunbooks";
import { SshGroupSettings } from "./SshGroupSettings";
import { useId, useRef, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { SshIdentityField } from "./SshIdentityField";
import { Alert } from "../../../shared/ui/Alert";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Select } from "../../../shared/ui/Select";
import { Terminal, Lock } from "../../../shared/ui/icons";
import { t } from "../../../shared/i18n";
import { setServerSshIdentity, type ServerRecord } from "../model/serverInventory";
import { SshAgentForwarding } from "./SshAgentForwarding";
import { useOpenAgentServerTerminal, useOpenServerTerminal } from "./ServersTerminalWorkspace";
import { ServerFiles } from "./ServerFiles";
import { ServerSnippets } from "./ServerSnippets";
import { sshEndpointPreview, sshJumpChain } from "../model/sshEndpointReview";
import { ServerForwards } from "./ServerForwards";
import { ServerActivity } from "./ServerActivity";
import { ServerOrganization } from "./ServerOrganization";

export function ServersConnectionTools({
  server,
  servers = [server],
  onUseServer,
  onEditServer,
}: {
  server: ServerRecord;
  servers?: ServerRecord[];
  onUseServer?: (id: string) => void;
  onEditServer?: (server: ServerRecord) => void;
}) {
  const openTerminal = useOpenServerTerminal();
  const openAgentTerminal = useOpenAgentServerTerminal();
  const [agentReview, setAgentReview] = useState(false);
  const [groupSettings, setGroupSettings] = useState(false);
  const [runbooks, setRunbooks] = useState(false);
  const [runbookRunId, setRunbookRunId] = useState<string>();
  const [security, setSecurity] = useState(false);
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [identityDraft, setIdentityDraft] = useState("");
  const [identityUpdate, setIdentityUpdate] = useState<{
    base: ServerRecord;
    saved: ServerRecord;
  }>();
  const currentServer = identityUpdate?.base === server ? identityUpdate.saved : server;
  const selectedIdentity =
    currentServer.effectiveSshEndpoint?.identityFile ??
    currentServer.sshEndpoint?.identityFile ??
    currentServer.machine?.ssh?.identityFile;
  const canAssignKey = server.kind === "ssh" || Boolean(server.machine?.ssh);
  const endpoint = currentServer.effectiveSshEndpoint ?? currentServer.sshEndpoint;
  const jumpChain = endpoint ? sshJumpChain(endpoint) : [];
  const sshUser =
    currentServer.effectiveSshEndpoint?.user ??
    currentServer.sshEndpoint?.user ??
    (currentServer.machine?.ssh?.target.includes("@")
      ? currentServer.machine.ssh.target.split("@")[0]
      : undefined);
  const pending = useRef(false);
  const [files, setFiles] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState("connection");
  const panelId = useId();
  const panels = [
    { value: "connection", label: t("Connection") },
    ...(canAssignKey ? [{ value: "forwards", label: t("Port forwarding") }] : []),
    { value: "automation", label: t("Automation") },
    { value: "settings", label: t("Organization") },
    { value: "activity", label: t("Activity") },
  ];
  const act = async (callback: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await callback();
    } catch (reason) {
      setError(String(reason));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="server-connection-tools mbs-4 flex min-w-0 flex-col gap-4">
      {endpoint?.httpProxy ? (
        <p className="w-full break-all text-xs text-(--ui-text-muted)">
          {endpoint.httpProxy.scheme === "https" ? "HTTPS CONNECT" : "HTTP CONNECT"}:{" "}
          {sshEndpointPreview(endpoint.httpProxy)}
        </p>
      ) : null}
      <div className="sticky inset-bs-0 z-10 flex flex-wrap gap-2 bg-(--ui-surface) pbe-2">
        {(server.kind === "ssh" || server.machine?.ssh) && openTerminal ? (
          <Button
            variant="primary"
            tooltip={t("Open SSH terminal")}
            onClick={() => openTerminal(currentServer)}
            disabled={busy}
          >
            <Terminal aria-hidden className="icon-sm" />
            {t("Connect via SSH")}
          </Button>
        ) : null}
        {server.kind === "ssh" || server.machine?.ssh ? (
          <Button variant="secondary" onClick={() => setFiles(true)}>
            {t("Files")}
          </Button>
        ) : null}
      </div>
      <div className="server-tools-selector">
        <Select label={t("Server tools")} value={panel} onValueChange={setPanel} options={panels} />
      </div>
      <div className="server-tools-segments">
        <SegmentedControl
          label={t("Server tools")}
          selectionRole="pressed"
          value={panel}
          onValueChange={setPanel}
          options={panels}
        />
      </div>
      <div id={`${panelId}-connection`} hidden={panel !== "connection"}>
        {canAssignKey ? (
          <section aria-label={t("Credentials")} className="flex min-w-0 flex-col gap-3">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1 text-xs">
                <h3 className="font-medium">{t("Credentials")}</h3>
                <p className="break-all text-(--ui-text-muted)">
                  {t("SSH user")}: {sshUser || t("Default")}
                </p>
                <p className="break-all text-(--ui-text-muted)">
                  {t("SSH key")}: {selectedIdentity || t("SSH agent and default keys")}
                </p>
              </div>
              <Button
                variant="secondary"
                aria-expanded={editingIdentity}
                disabled={busy}
                onClick={() => {
                  setIdentityDraft(selectedIdentity ?? "");
                  setEditingIdentity((value) => !value);
                }}
              >
                {t("Choose SSH key")}
              </Button>
            </div>
            {jumpChain.length ? (
              <p className="break-all text-xs text-(--ui-text-muted)">
                {t("Jump chain")}: {jumpChain.join(" → ")}
              </p>
            ) : null}
            {currentServer.metadata.sshInheritance ? (
              <Button variant="link" onClick={() => setGroupSettings(true)}>
                {t("SSH group settings")}
              </Button>
            ) : null}
            {editingIdentity ? (
              <div className="flex min-w-0 flex-col gap-3">
                <SshIdentityField
                  value={identityDraft}
                  onChange={setIdentityDraft}
                  disabled={busy}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" disabled={busy} onClick={() => setEditingIdentity(false)}>
                    {t("Cancel")}
                  </Button>
                  <Button
                    loading={busy}
                    onClick={() =>
                      void act(async () => {
                        const saved = await setServerSshIdentity(
                          server.id,
                          identityDraft.trim() || undefined,
                        );
                        setIdentityUpdate({ base: server, saved });
                        setEditingIdentity(false);
                      })
                    }
                  >
                    {t("Save")}
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
        {!canAssignKey ? (
          <p className="text-xs text-(--ui-text-muted)">
            {t("This machine uses bycoda Host. Use Reconnect to restore its connection.")}
          </p>
        ) : null}
      </div>
      <div id={`${panelId}-forwards`} hidden={panel !== "forwards"}>
        {canAssignKey ? (
          <ServerForwards key={server.id} server={server} expanded active={panel === "forwards"} />
        ) : null}
      </div>
      <div id={`${panelId}-automation`} hidden={panel !== "automation"}>
        <div className="mbe-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{t("Automation")}</h3>
          {server.kind === "ssh" ? (
            <Button onClick={() => setRunbooks(true)}>{t("SSH runbooks")}</Button>
          ) : null}
        </div>
        <ServerSnippets key={server.id} serverId={server.id} serverName={server.name} embedded />
      </div>
      <div id={`${panelId}-settings`} hidden={panel !== "settings"} className="min-w-0">
        <h3 className="mbe-3 text-ui-body font-medium">{t("Organization")}</h3>
        <div className="flex flex-wrap gap-2">
          {(server.kind === "ssh" || server.machine?.ssh) && openAgentTerminal ? (
            <Button onClick={() => setAgentReview(true)}>{t("Forward SSH agent")}</Button>
          ) : null}
          {server.kind === "ssh" ? (
            <Button onClick={() => setGroupSettings(true)}>{t("SSH group settings")}</Button>
          ) : null}
          <Button loading={busy} onClick={() => setSecurity(true)}>
            <Lock aria-hidden className="icon-sm" />
            {t("SSH settings")}
          </Button>
        </div>
        <ServerOrganization key={server.id} server={server} expanded />
      </div>
      <div id={`${panelId}-activity`} hidden={panel !== "activity"}>
        <ServerActivity key={server.id} server={server} expanded />
      </div>
      {agentReview && openAgentTerminal ? (
        <SshAgentForwarding
          server={server}
          onApprove={openAgentTerminal}
          onClose={() => setAgentReview(false)}
        />
      ) : null}
      {runbooks && server.kind === "ssh" ? (
        <SshRunbooks
          key={server.id}
          server={server}
          servers={servers}
          runId={runbookRunId}
          onRun={setRunbookRunId}
          onAbandon={() => setRunbookRunId(undefined)}
          onClose={() => setRunbooks(false)}
        />
      ) : null}
      {groupSettings && server.kind === "ssh" ? (
        <SshGroupSettings key={server.id} server={server} onClose={() => setGroupSettings(false)} />
      ) : null}
      {error && !security ? <Alert tone="danger">{error}</Alert> : null}
      {files ? (
        <ServerFiles
          key={server.id}
          connectionId={server.id}
          serverName={server.name}
          endpoint={server.effectiveSshEndpoint ?? server.sshEndpoint}
          onClose={() => setFiles(false)}
        />
      ) : null}
      {security ? (
        <SshSettings
          server={currentServer}
          servers={servers}
          onClose={() => setSecurity(false)}
          onAssigned={(saved) => setIdentityUpdate({ base: server, saved })}
          onUseServer={onUseServer}
          onEditServer={onEditServer}
        />
      ) : null}
    </div>
  );
}
