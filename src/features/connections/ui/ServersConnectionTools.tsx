import { SshRunbooks } from "./SshRunbooks";
import { SshGroupSettings } from "./SshGroupSettings";
import { useId, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Alert } from "../../../shared/ui/Alert";
import { Terminal, Lock } from "../../../shared/ui/icons";
import { t } from "../../../shared/i18n";
import {
  saveSshConnection,
  setServerSshIdentity,
  type ServerRecord,
  type SshEndpoint,
} from "../model/serverInventory";
import { SshAgentForwarding } from "./SshAgentForwarding";
import {
  useOpenAgentServerTerminal,
  useOpenServerTerminal,
  useGenerateSshKey,
} from "./ServersTerminalWorkspace";
import { ServerFiles } from "./ServerFiles";
import { ServerSnippets } from "./ServerSnippets";
import { sameSshEndpoint, sshJumpChain, sshEndpointPreview } from "../model/sshEndpointReview";
import { ServerForwards } from "./ServerForwards";
import { ServerActivity } from "./ServerActivity";
import { ServerOrganization } from "./ServerOrganization";

type PublicKey = {
  hostPatterns?: string;
  identityFile?: string;
  fingerprint: string;
  keyType: string;
  marker?: string;
};
type Preview = {
  hosts: { alias: string; endpoint: SshEndpoint; duplicate: boolean }[];
  warnings: string[];
};
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
  const generateKey = useGenerateSshKey();
  const [agent, setAgent] = useState<{
    status: string;
    identities: { bits: number; fingerprint: string; keyType: string }[];
  }>();
  const [security, setSecurity] = useState(false);
  const [identityUpdate, setIdentityUpdate] = useState<{
    base: ServerRecord;
    saved: ServerRecord;
  }>();
  const currentServer = identityUpdate?.base === server ? identityUpdate.saved : server;
  const selectedIdentity =
    currentServer.effectiveSshEndpoint?.identityFile ??
    currentServer.sshEndpoint?.identityFile ??
    currentServer.machine?.ssh?.identityFile;
  const inheritedIdentity = Boolean(
    currentServer.metadata.sshInheritance?.fields.includes("identityFile"),
  );
  const canAssignKey = server.kind === "ssh" || Boolean(server.machine?.ssh);
  const pending = useRef(false);
  const [files, setFiles] = useState(false);
  const [snippets, setSnippets] = useState(false);
  const [keys, setKeys] = useState<PublicKey[]>([]);
  const [hosts, setHosts] = useState<PublicKey[]>([]);
  const [config, setConfig] = useState("");
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState("connection");
  const panelId = useId();
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
    <div className="mbs-4 flex min-w-0 flex-col gap-4">
      {server.sshEndpoint?.httpProxy ? (
        <p className="w-full break-all text-xs text-(--ui-text-muted)">
          {server.sshEndpoint.httpProxy.scheme === "https" ? "HTTPS CONNECT" : "HTTP CONNECT"}:{" "}
          {sshEndpointPreview(server.sshEndpoint.httpProxy)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {(server.kind === "ssh" || server.machine?.ssh) && openTerminal ? (
          <Button
            variant="primary"
            tooltip={t("Open SSH terminal")}
            onClick={() => openTerminal(currentServer)}
            disabled={busy}
          >
            <Terminal aria-hidden className="size-3.5" />
            {t("Connect via SSH")}
          </Button>
        ) : null}
        {server.kind === "ssh" || server.machine?.ssh ? (
          <Button variant="secondary" onClick={() => setFiles(true)}>
            {t("Files")}
          </Button>
        ) : null}
      </div>
      {canAssignKey && selectedIdentity ? (
        <p className="break-all text-xs text-(--ui-text-muted)">
          {t("SSH key")}: {selectedIdentity}
        </p>
      ) : null}
      <nav
        aria-label={t("Server tools")}
        className="flex flex-wrap gap-1 border-b border-stroke pbe-2"
      >
        {[
          ["connection", "Connection"],
          ["automation", "Automation"],
          ["settings", "Settings"],
          ["activity", "Activity"],
        ].map(([id, label]) => (
          <Button
            key={id}
            variant="tab"
            aria-pressed={panel === id}
            aria-controls={`${panelId}-${id}`}
            onClick={() => setPanel(id)}
          >
            {t(label)}
          </Button>
        ))}
      </nav>
      <div id={`${panelId}-connection`} hidden={panel !== "connection"}>
        {server.kind === "ssh" || server.machine?.ssh ? (
          <ServerForwards key={server.id} server={server} expanded />
        ) : (
          <p className="text-xs text-(--ui-text-muted)">
            {t("This machine uses bycoda Host. Use Reconnect to restore its connection.")}
          </p>
        )}
      </div>
      <div id={`${panelId}-automation`} hidden={panel !== "automation"}>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setSnippets(true)}>{t("Saved commands")}</Button>
          {server.kind === "ssh" ? (
            <Button onClick={() => setRunbooks(true)}>{t("SSH runbooks")}</Button>
          ) : null}
        </div>
      </div>
      <div id={`${panelId}-settings`} hidden={panel !== "settings"} className="min-w-0">
        <div className="flex flex-wrap gap-2">
          {(server.kind === "ssh" || server.machine?.ssh) && openAgentTerminal ? (
            <Button onClick={() => setAgentReview(true)}>{t("Forward SSH agent")}</Button>
          ) : null}
          {server.kind === "ssh" ? (
            <Button onClick={() => setGroupSettings(true)}>{t("SSH group settings")}</Button>
          ) : null}
          <Button
            loading={busy}
            onClick={() => {
              setSecurity(true);
              void act(async () => {
                const result = await Promise.all([
                  invoke<PublicKey[]>("ssh_public_keys_list"),
                  invoke<PublicKey[]>("ssh_known_hosts_list"),
                  invoke<{
                    status: string;
                    identities: { bits: number; fingerprint: string; keyType: string }[];
                  }>("ssh_agent_identities"),
                ]);
                setKeys(result[0]);
                setHosts(result[1]);
                setAgent(result[2]);
              });
            }}
          >
            <Lock aria-hidden className="size-3.5" />
            {t("SSH settings")}
          </Button>
        </div>
        <ServerOrganization key={server.id} server={server} />
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
          endpoint={server.effectiveSshEndpoint ?? server.sshEndpoint}
          onClose={() => setFiles(false)}
        />
      ) : null}
      {snippets ? (
        <Modal title={t("Saved commands")} onClose={() => setSnippets(false)}>
          <ServerSnippets key={server.id} serverId={server.id} serverName={server.name} />
        </Modal>
      ) : null}
      {security ? (
        <Modal title={t("SSH settings")} onClose={() => setSecurity(false)} size="lg">
          <div className="flex flex-col gap-4 p-4">
            <p className="text-xs text-(--ui-text-muted)">{t("Local SSH keys and known hosts.")}</p>
            {error ? (
              <Alert tone="danger" role="alert">
                {error}
              </Alert>
            ) : null}
            <section>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">{t("Keys")}</h3>
                {generateKey ? (
                  <Button
                    onClick={() =>
                      void act(async () => {
                        const path = await save({
                          title: t("Generate SSH key"),
                          defaultPath: "id_ed25519_bycoda",
                        });
                        if (path) {
                          setSecurity(false);
                          generateKey(path);
                        }
                      })
                    }
                  >
                    {t("Generate SSH key")}
                  </Button>
                ) : null}
              </div>
              {agent ? (
                <div className="mbs-2 text-xs">
                  <span>
                    {t("SSH agent")}:{" "}
                    {t(
                      agent.status === "available"
                        ? "Available"
                        : agent.status === "empty"
                          ? "No identities"
                          : "Unavailable",
                    )}
                  </span>
                  {agent.identities.map((identity, index) => (
                    <p className="mbs-1 break-all" key={index}>
                      {identity.keyType} · {identity.fingerprint}
                    </p>
                  ))}
                </div>
              ) : null}
              <p className="mbs-1 text-xs text-(--ui-text-muted)">
                {t("Private keys stay in OpenSSH or your OS agent.")}
              </p>
              <JumpAuthenticationHelp />
              {canAssignKey ? (
                <p className="mbs-2 break-all text-xs">
                  {t("Select a key for")}: {server.name}
                </p>
              ) : null}
              {canAssignKey && selectedIdentity ? (
                <div className="mbs-2 flex min-w-0 flex-wrap items-center gap-2">
                  <p role="status" className="min-w-0 flex-1 break-all text-xs">
                    {inheritedIdentity ? t("SSH key") : t("Assigned")}: {selectedIdentity}
                  </p>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const saved = await setServerSshIdentity(server.id);
                        setIdentityUpdate({ base: server, saved });
                      })
                    }
                  >
                    {t("Use SSH defaults")}
                  </Button>
                </div>
              ) : null}
              {keys.map((key, index) => (
                <div className="mbs-2 flex min-w-0 flex-wrap items-center gap-2" key={index}>
                  <p className="min-w-0 flex-1 break-all text-xs">
                    {key.identityFile} · {key.keyType} · {key.fingerprint}
                  </p>
                  {canAssignKey && key.identityFile ? (
                    <Button
                      variant="secondary"
                      aria-label={`${t("Assign key")}: ${key.identityFile} (${server.name})`}
                      tooltip={`${t("Select a key for")}: ${server.name}`}
                      aria-pressed={!inheritedIdentity && selectedIdentity === key.identityFile}
                      disabled={
                        busy || (!inheritedIdentity && selectedIdentity === key.identityFile)
                      }
                      onClick={() => {
                        void act(async () => {
                          const saved = await setServerSshIdentity(server.id, key.identityFile);
                          setIdentityUpdate({ base: server, saved });
                        });
                      }}
                    >
                      {!inheritedIdentity && selectedIdentity === key.identityFile
                        ? t("Assigned")
                        : t("Assign key")}
                    </Button>
                  ) : null}
                </div>
              ))}
            </section>
            <details>
              <summary className="cursor-pointer text-sm">
                {t("Known hosts")} ({hosts.length})
              </summary>
              {hosts.map((host, index) => (
                <p key={index} className="mbs-2 break-all text-xs">
                  {host.hostPatterns} · {host.keyType} · {host.fingerprint}
                </p>
              ))}
            </details>
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{t("Import SSH config")}</h3>
              <TextareaField
                label={t("SSH config")}
                value={config}
                onChange={(event) => {
                  setConfig(event.target.value);
                  setPreview(undefined);
                }}
                rows={6}
              />
              <Button
                loading={busy}
                onClick={() =>
                  void act(async () =>
                    setPreview(await invoke<Preview>("ssh_config_preview", { content: config })),
                  )
                }
              >
                {t("Preview")}
              </Button>
              {preview?.warnings.map((warning, index) => (
                <p key={index} className="text-xs text-(--ui-text-muted)">
                  {warning}
                </p>
              ))}
              {preview?.hosts.map((host, index) => {
                const existing = servers.filter(
                  (candidate) =>
                    candidate.kind === "ssh" &&
                    (candidate.effectiveSshEndpoint ?? candidate.sshEndpoint) &&
                    sameSshEndpoint(
                      (candidate.effectiveSshEndpoint ?? candidate.sshEndpoint)!,
                      host.endpoint,
                    ),
                );
                const skip = () =>
                  setPreview(
                    (previous) =>
                      previous && {
                        ...previous,
                        hosts: previous.hosts.filter((_, i) => i !== index),
                      },
                  );
                return (
                  <ConfigImportChoices
                    key={`${host.alias}:${index}`}
                    host={host}
                    existing={existing}
                    busy={busy}
                    onSkip={skip}
                    onUse={
                      onUseServer
                        ? (candidate) => {
                            setSecurity(false);
                            onUseServer(candidate.id);
                          }
                        : undefined
                    }
                    onEdit={
                      onEditServer
                        ? (candidate) => {
                            setSecurity(false);
                            onEditServer(candidate);
                          }
                        : undefined
                    }
                    onImport={() =>
                      void act(async () => {
                        await saveSshConnection({
                          name: host.alias,
                          endpoint: host.endpoint,
                          importOnly: true,
                        });
                        skip();
                      })
                    }
                  />
                );
              })}
            </section>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

/** Each choice names its exact saved record. Import never overwrites a duplicate. */
export function ConfigImportChoices({
  host,
  existing,
  busy,
  onSkip,
  onImport,
  onUse,
  onEdit,
}: {
  host: Preview["hosts"][number];
  existing: ServerRecord[];
  busy: boolean;
  onSkip: () => void;
  onImport: () => void;
  onUse?: (server: ServerRecord) => void;
  onEdit?: (server: ServerRecord) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 border-t border-stroke py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 break-words text-xs">
          {host.alias} · {host.endpoint.user ? `${host.endpoint.user}@` : ""}
          {host.endpoint.host}:{host.endpoint.port}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={busy} onClick={onSkip}>
            {t("Skip")}
          </Button>
          {!existing.length && !host.duplicate ? (
            <Button loading={busy} onClick={onImport}>
              {t("Import")}
            </Button>
          ) : null}
        </div>
      </div>
      {host.endpoint.identityFile ? (
        <p className="break-all text-xs text-(--ui-text-muted)">
          {t("Identity file")}: {host.endpoint.identityFile}
        </p>
      ) : null}
      {host.endpoint.certificateFile ? (
        <p className="break-all text-xs text-(--ui-text-muted)">
          {t("Public SSH certificate file")}: {host.endpoint.certificateFile}
        </p>
      ) : null}
      {sshJumpChain(host.endpoint).length ? (
        <>
          <p className="break-all text-xs text-(--ui-text-muted)">
            {t("Jump chain")}: {sshJumpChain(host.endpoint).join(" → ")}
          </p>
          <JumpAuthenticationHelp />
        </>
      ) : null}
      {existing.length ? (
        <p className="text-xs text-(--ui-text-muted)">
          {t("This endpoint is already saved. Choose an existing connection.")}
        </p>
      ) : host.duplicate ? (
        <p className="text-xs text-(--ui-text-muted)">{t("Duplicate entry in this import.")}</p>
      ) : null}
      {existing.map((candidate) => (
        <div key={candidate.id} className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 break-words text-xs">{candidate.name}</span>
          <div className="flex gap-2">
            {onUse ? (
              <Button disabled={busy} onClick={() => onUse(candidate)}>
                {t("Use existing")}
              </Button>
            ) : null}
            {onEdit ? (
              <Button variant="ghost" disabled={busy} onClick={() => onEdit(candidate)}>
                {t("Edit existing")}
              </Button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function JumpAuthenticationHelp() {
  return (
    <details className="text-xs text-(--ui-text-muted)">
      <summary className="cursor-pointer">{t("Jump host authentication")}</summary>
      <p className="mbs-2 break-words">
        {t(
          "The selected identity and certificate apply only to the final target. Jump hosts use your local SSH agent or default identities and verify their own host keys.",
        )}
      </p>
    </details>
  );
}
