import { Text } from "../../../shared/ui/Text";
import { SshSettings } from "./SshSettings";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
export { ConfigImportChoices } from "./SshConfigImportChoices";
import { SshRunbooks } from "./SshRunbooks";
import { SshGroupSettings } from "./SshGroupSettings";
import { useId, useRef, useState } from "react";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { Button } from "../../../shared/ui/Button";
import { SshIdentityField } from "./SshIdentityField";
import { Alert } from "../../../shared/ui/Alert";
import { Tab, TabList, TabPanel, Tabs } from "../../../shared/ui/Tabs";
import { FolderOpen, Terminal, Lock } from "../../../shared/ui/icons";
import { t } from "../../../shared/i18n";
import { setServerSshIdentity, type ServerRecord } from "../model/serverInventory";
import { SshAgentForwarding } from "./SshAgentForwarding";
import { useOpenAgentServerTerminal, useOpenServerTerminal } from "./ServersTerminalWorkspace";
import { ServerFiles } from "./ServerFiles";
import { ServerSnippets } from "./ServerSnippets";
import { sshJumpChain } from "../model/sshEndpointReview";
import { sshProxyEndpointText } from "./sshProxyEndpointText";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { ServerForwards } from "./ServerForwards";
import { ServerActivity } from "./ServerActivity";
import { ServerOrganization } from "./ServerOrganization";
import { errorText } from "../../../shared/lib/errors";
import { sanitizeConnectionError } from "../model/remoteConnection";

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
  const [runbookRunId, setRunbookRunId] = useRetainedState<string | undefined>(
    `ssh-runbook-run:${server.id}`,
    undefined,
  );
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
      setError(sanitizeConnectionError(errorText(reason)));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="server-connection-tools @container/connection-tools min-w-0">
      <Tabs id={panelId} value={panel} onValueChange={setPanel}>
        <div
          {...surfaceAttributes(
            { variant: "canvas", frame: "pane", edge: "bottom" },
            "sticky inset-bs-0 z-1 flex flex-col gap-2 px-4 py-2",
          )}
        >
          {canAssignKey ? (
            <div className="flex flex-wrap gap-2">
              {openTerminal ? (
                <Button
                  variant="primary"
                  onClick={() =>
                    void act(async () => {
                      await openTerminal(currentServer);
                    })
                  }
                  disabled={busy}
                >
                  <Terminal aria-hidden className="icon-sm" />
                  {t("Connect via SSH")}
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => setFiles(true)}>
                <FolderOpen aria-hidden className="icon-sm" />
                {t("Files")}
              </Button>
            </div>
          ) : null}
          <TabList label={t("Server tools")} scroll="wrap">
            {panels.map((item) => (
              <Tab key={item.value} value={item.value} className="shrink-0">
                {item.label}
              </Tab>
            ))}
          </TabList>
        </div>
        <div className="min-w-0 px-4 py-4">
          {error && !security ? (
            <Alert tone="danger" className="mbe-3">
              {error}
            </Alert>
          ) : null}
          <TabPanel value="connection" keepMounted>
            {canAssignKey ? (
              <section aria-label={t("Credentials")} className="flex min-w-0 flex-col gap-3">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    variant="secondary"
                    className="shrink-0"
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
                <DescriptionList>
                  <DescriptionItem term={t("SSH user")} monospace={!!sshUser}>
                    {sshUser || t("Default")}
                  </DescriptionItem>
                  <DescriptionItem term={t("SSH key")} monospace={!!selectedIdentity}>
                    {selectedIdentity || t("SSH agent and default keys")}
                  </DescriptionItem>
                  {jumpChain.length ? (
                    <DescriptionItem term={t("Jump chain")} monospace>
                      {jumpChain.join(" → ")}
                    </DescriptionItem>
                  ) : null}
                  {endpoint?.httpProxy ? (
                    <DescriptionItem term={t("Connection proxy")} monospace>
                      {sshProxyEndpointText(endpoint.httpProxy)}
                    </DescriptionItem>
                  ) : null}
                </DescriptionList>
                {currentServer.metadata.sshInheritance ? (
                  <Button
                    variant="link"
                    className="self-start"
                    onClick={() => setGroupSettings(true)}
                  >
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
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setEditingIdentity(false)}
                      >
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
              <Text as="p" tone="muted">
                {t("This machine uses bycoda Host. Use Reconnect to restore its connection.")}
              </Text>
            ) : null}
          </TabPanel>
          {canAssignKey ? (
            <TabPanel value="forwards" keepMounted>
              <ServerForwards
                key={server.id}
                server={server}
                expanded
                active={panel === "forwards"}
              />
            </TabPanel>
          ) : null}
          <TabPanel value="automation" keepMounted>
            {server.kind === "ssh" ? (
              <Button variant="secondary" className="mbe-4" onClick={() => setRunbooks(true)}>
                {t("SSH runbooks")}
              </Button>
            ) : null}
            <ServerSnippets
              key={server.id}
              serverId={server.id}
              serverName={server.name}
              embedded
            />
          </TabPanel>
          <TabPanel value="settings" keepMounted className="min-w-0">
            <div className="flex flex-wrap gap-2">
              {(server.kind === "ssh" || server.machine?.ssh) && openAgentTerminal ? (
                <Button variant="secondary" onClick={() => setAgentReview(true)}>
                  {t("Forward SSH agent")}
                </Button>
              ) : null}
              {server.kind === "ssh" && !currentServer.metadata.sshInheritance ? (
                <Button variant="secondary" onClick={() => setGroupSettings(true)}>
                  {t("SSH group settings")}
                </Button>
              ) : null}
              <Button variant="secondary" loading={busy} onClick={() => setSecurity(true)}>
                <Lock aria-hidden className="icon-sm" />
                {t("SSH settings")}
              </Button>
            </div>
            <ServerOrganization key={server.id} server={server} servers={servers} expanded />
          </TabPanel>
          <TabPanel value="activity" keepMounted>
            <ServerActivity key={server.id} server={server} expanded />
          </TabPanel>
        </div>
      </Tabs>
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
