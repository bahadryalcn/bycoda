import { useEffect, useId, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Alert } from "../../../shared/ui/Alert";
import {
  saveSshConnection,
  setServerSshIdentity,
  type ServerRecord,
  type SshEndpoint,
} from "../model/serverInventory";
import { sameSshEndpoint } from "../model/sshEndpointReview";
import { ConfigImportChoices, JumpAuthenticationHelp } from "./SshConfigImportChoices";
import { useGenerateSshKey } from "./ServersTerminalWorkspace";
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

/** Independent read-only inventories keep successful sections available on partial failure. */
function useSshInventory<T>(command: string) {
  const [value, setValue] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    void invoke<T>(command).then(
      (result) => {
        if (current) setValue(result);
      },
      (reason) => {
        if (current) setError(String(reason));
      },
    ).finally(() => {
      if (current) setLoading(false);
    });
    return () => {
      current = false;
    };
  }, [command, attempt]);
  return { value, error, loading, retry: () => setAttempt((previous) => previous + 1) };
}

export function SshSettings({
  server,
  servers,
  onClose,
  onAssigned,
  onUseServer,
  onEditServer,
}: {
  server?: ServerRecord;
  servers: ServerRecord[];
  onClose: () => void;
  onAssigned?: (server: ServerRecord) => void;
  onUseServer?: (id: string) => void;
  onEditServer?: (server: ServerRecord) => void;
}) {
  const panelId = useId();
  const generateKey = useGenerateSshKey();
  const [securityPanel, setSecurityPanel] = useState("keys");
  const [keySearch, setKeySearch] = useState("");
  const [hostSearch, setHostSearch] = useState("");
  const keyInventory = useSshInventory<PublicKey[]>("ssh_public_keys_list");
  const hostInventory = useSshInventory<PublicKey[]>("ssh_known_hosts_list");
  const agentInventory = useSshInventory<{
    status: string;
    identities: { bits: number; fingerprint: string; keyType: string }[];
  }>("ssh_agent_identities");
  const keys = keyInventory.value ?? [];
  const hosts = hostInventory.value ?? [];
  const agent = agentInventory.value;
  const [config, setConfig] = useState("");
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState("");
  const hostsError = hostInventory.error;
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const pending = useRef(false);
  const canAssignKey = Boolean(server && (server.kind === "ssh" || server.machine?.ssh));
  const selectedIdentity =
    server?.effectiveSshEndpoint?.identityFile ??
    server?.sshEndpoint?.identityFile ??
    server?.machine?.ssh?.identityFile;
  const inheritedIdentity = Boolean(
    server?.metadata.sshInheritance?.fields.includes("identityFile"),
  );
  const matchingKeys = keys.filter((key) =>
    `${key.identityFile ?? ""} ${key.keyType} ${key.fingerprint}`
      .toLocaleLowerCase()
      .includes(keySearch.trim().toLocaleLowerCase()),
  );
  const assignIdentity = async (path?: string) => {
    if (!server) return;
    const saved = await setServerSshIdentity(server.id, path);
    onAssigned?.(saved);
  };
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
    <Modal title={t("SSH settings")} onClose={() => onClose()} size="lg">
      <div className="flex flex-col gap-4 p-4">
        <p className="text-xs text-(--ui-text-muted)">{t("Local SSH keys and known hosts.")}</p>
        <SegmentedControl
          label={t("SSH settings sections")}
          selectionRole="pressed"
          value={securityPanel}
          onValueChange={setSecurityPanel}
          options={[
            { value: "keys", label: t("Keys") },
            { value: "hosts", label: t("Known hosts") },
            { value: "import", label: t("Import SSH config") },
          ]}
        />
        {error ? (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        ) : null}
        <section id={`${panelId}-security-keys`} hidden={securityPanel !== "keys"}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{t("Keys")}</h3>
            {generateKey ? (
              <Button
                disabled={busy}
                loading={generating}
                onClick={() =>
                  void act(async () => {
                    setGenerating(true);
                    try {
                      const path = await save({
                        title: t("Generate SSH key"),
                        defaultPath: "id_ed25519_bycoda",
                      });
                      if (path) {
                        onClose();
                        generateKey(path);
                      }
                    } finally {
                      setGenerating(false);
                    }
                  })
                }
              >
                {t("Generate SSH key")}
              </Button>
            ) : null}
          </div>
          {agentInventory.loading ? (
            <p role="status" className="mbs-2 text-ui-caption text-(--ui-text-muted)">
              {t("SSH agent")}: {t("Loading\u2026")}
            </p>
          ) : null}
          {agentInventory.error ? (
            <Alert tone="danger" role="alert">
              {t("SSH agent")}: {agentInventory.error}
              <Button loading={agentInventory.loading} onClick={agentInventory.retry}>{t("Retry")}</Button>
            </Alert>
          ) : null}
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
              {t("Select a key for")}: {server?.name}
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
                    await assignIdentity();
                  })
                }
              >
                {t("Use SSH defaults")}
              </Button>
            </div>
          ) : null}
          <SearchInput
            type="search"
            value={keySearch}
            onChange={(event) => setKeySearch(event.target.value)}
            appearance="field"
            placeholder={t("Search SSH keys…")}
            aria-label={t("Search SSH keys…")}
          />
          {keyInventory.error ? (
            <Alert tone="danger" role="alert">
              {t("Keys")}: {keyInventory.error}
              <Button loading={keyInventory.loading} onClick={keyInventory.retry}>{t("Retry")}</Button>
            </Alert>
          ) : null}
          {keyInventory.loading && keys.length === 0 ? (
            <p role="status" className="mbs-2 text-xs text-(--ui-text-muted)">
              {t("Loading…")}
            </p>
          ) : null}
          {!keyInventory.loading && !keyInventory.error && keys.length === 0 ? (
            <p className="mbs-2 text-xs text-(--ui-text-muted)">{t("No SSH keys found.")}</p>
          ) : null}
          {keys.length > 0 && matchingKeys.length === 0 ? (
            <p className="mbs-2 text-xs text-(--ui-text-muted)">{t("No matching SSH keys.")}</p>
          ) : null}
          <div className="max-h-64 overflow-y-auto">
            {matchingKeys.map((key) => (
              <div
                className="mbs-2 flex min-w-0 flex-wrap items-center gap-2"
                key={`${key.identityFile}:${key.fingerprint}`}
              >
                <div className="min-w-0 flex-1 text-ui-caption">
                  <p className="break-all text-ui-body font-medium">
                    {key.identityFile?.split(/[\\/]/).pop() ?? key.keyType}
                  </p>
                  <p className="break-all text-(--ui-text-muted)">{key.identityFile}</p>
                  <p className="break-all text-(--ui-text-muted)">
                    {key.keyType} · {key.fingerprint}
                  </p>
                </div>
                {canAssignKey && key.identityFile ? (
                  <Button
                    variant="secondary"
                    aria-label={`${t("Assign key")}: ${key.identityFile} (${server?.name})`}
                    tooltip={`${t("Select a key for")}: ${server?.name}`}
                    aria-pressed={!inheritedIdentity && selectedIdentity === key.identityFile}
                    disabled={busy || (!inheritedIdentity && selectedIdentity === key.identityFile)}
                    onClick={() => {
                      void act(async () => {
                        await assignIdentity(key.identityFile);
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
          </div>
        </section>
        <section
          id={`${panelId}-security-hosts`}
          hidden={securityPanel !== "hosts"}
          className="flex min-w-0 flex-col gap-3"
        >
          <h3 className="text-sm font-medium">
            {t("Known hosts")}{hostInventory.value ? ` (${hosts.length})` : ""}
          </h3>
          <SearchInput
            appearance="field"
            aria-label={t("Search known hosts")}
            placeholder={t("Search known hosts")}
            value={hostSearch}
            onChange={(event) => setHostSearch(event.target.value)}
          />
          {hostInventory.loading ? (
            <p role="status" className="text-ui-caption text-(--ui-text-muted)">
              {t("Loading\u2026")}
            </p>
          ) : null}
          {hostsError ? (
            <Alert tone="danger" role="alert">
              {hostsError}
              <Button loading={hostInventory.loading} onClick={hostInventory.retry}>{t("Retry")}</Button>
            </Alert>
          ) : null}
          {!hosts.length && !hostInventory.loading && !hostsError ? (
            <p className="text-xs text-(--ui-text-muted)">{t("No known hosts yet.")}</p>
          ) : null}
          {hosts
            .filter((host) =>
              `${host.hostPatterns} ${host.keyType} ${host.fingerprint}`
                .toLocaleLowerCase()
                .includes(hostSearch.trim().toLocaleLowerCase()),
            )
            .map((host, index) => (
              <p key={index} className="mbs-2 break-all text-xs">
                {host.hostPatterns} · {host.keyType} · {host.fingerprint}
              </p>
            ))}
        </section>
        <section
          id={`${panelId}-security-import`}
          hidden={securityPanel !== "import"}
          className="flex flex-col gap-3"
        >
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
                        onClose();
                        onUseServer(candidate.id);
                      }
                    : undefined
                }
                onEdit={
                  onEditServer
                    ? (candidate) => {
                        onClose();
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
  );
}
