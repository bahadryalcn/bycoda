import { Sheet } from "../../../shared/ui/Sheet";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Badge } from "../../../shared/ui/Badge";
import { LiveText } from "../../../shared/ui/LiveText";
import { Text } from "../../../shared/ui/Text";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Check, CircleDashed } from "../../../shared/ui/icons";
import { errorText } from "../../../shared/lib/errors";
import { sanitizeConnectionError } from "../model/remoteConnection";

import { TextareaField } from "../../../shared/ui/TextareaField";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { Tab, TabList, TabPanel, Tabs } from "../../../shared/ui/Tabs";
import { Alert } from "../../../shared/ui/Alert";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { InlineError } from "../../../shared/ui/InlineError";
import { connectionProblem } from "../model/connectionReason";
import {
  saveSshConnection,
  setServerSshIdentity,
  type ServerRecord,
  type SshEndpoint,
} from "../model/serverInventory";
import { sameSshEndpoint } from "../model/sshEndpointReview";
import { ConfigImportChoices } from "./SshConfigImportChoices";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { useGenerateSshKey } from "./ServersTerminalWorkspace";
type Problem = ReturnType<typeof connectionProblem> | undefined;
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
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- reads the native SSH inventory when its command changes
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    void invoke<T>(command)
      .then(
        (result) => {
          if (current) setValue(result);
        },
        (reason) => {
          if (current) setError(sanitizeConnectionError(errorText(reason)));
        },
      )
      .finally(() => {
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
  // Mirrors the textarea so a preview that resolves after an edit is dropped, not applied.
  const configRef = useRef(config);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- keeps native preview completions matched to the committed input
  useLayoutEffect(() => {
    configRef.current = config;
  });
  const [preview, setPreview] = useState<Preview>();
  // Each panel owns its failure, so an assign error never shows on Known hosts or Import.
  const [keysProblem, setKeysProblem] = useState<Problem>();
  const [importProblem, setImportProblem] = useState<Problem>();
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
  const matchingHosts = hosts.filter((host) =>
    `${host.hostPatterns} ${host.keyType} ${host.fingerprint}`
      .toLocaleLowerCase()
      .includes(hostSearch.trim().toLocaleLowerCase()),
  );
  const assignIdentity = async (path?: string) => {
    if (!server) return;
    const saved = await setServerSshIdentity(server.id, path);
    onAssigned?.(saved);
  };
  const act = async (
    setFailure: (problem: Problem) => void,
    title: string,
    callback: () => Promise<void>,
  ) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFailure(undefined);
    try {
      await callback();
    } catch (reason) {
      setFailure(connectionProblem(title, reason));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  // Previews the pasted config once typing pauses; a result for older text is dropped.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- debounces the native preview call for the current pasted configuration
  useEffect(() => {
    const content = config;
    if (!content.trim()) return;
    const timer = window.setTimeout(() => {
      void invoke<Preview>("ssh_config_preview", { content }).then(
        (result) => {
          if (configRef.current === content) {
            setImportProblem(undefined);
            setPreview(result);
          }
        },
        (reason) => {
          if (configRef.current === content)
            setImportProblem(
              connectionProblem(t("Could not preview the SSH configuration."), reason),
            );
        },
      );
    }, 400);
    return () => window.clearTimeout(timer);
  }, [config]);
  const existingFor = (host: Preview["hosts"][number]) =>
    servers.filter(
      (candidate) =>
        candidate.kind === "ssh" &&
        (candidate.effectiveSshEndpoint ?? candidate.sshEndpoint) &&
        sameSshEndpoint((candidate.effectiveSshEndpoint ?? candidate.sshEndpoint)!, host.endpoint),
    );
  const newHosts =
    preview?.hosts.filter((host) => !host.duplicate && !existingFor(host).length) ?? [];
  return (
    <Sheet title={t("SSH settings")} onClose={() => onClose()} size="lg">
      <div className="flex flex-col gap-4">
        <Tabs id={panelId} value={securityPanel} onValueChange={setSecurityPanel}>
          <TabList label={t("SSH settings sections")}>
            <Tab value="keys">{t("Keys")}</Tab>
            <Tab value="hosts">
              {t("Known hosts")}
              {hostInventory.value ? ` (${hosts.length})` : ""}
            </Tab>
            <Tab value="import">{t("Import SSH config")}</Tab>
          </TabList>
          <TabPanel value="keys" keepMounted>
            {keysProblem ? (
              <InlineError details={keysProblem.details}>{keysProblem.title}</InlineError>
            ) : null}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <InfoPopover className="shrink-0">
                <p>{t("Private keys stay in OpenSSH or your OS agent.")}</p>
                <p>
                  {t(
                    "Each jump host uses its own identity and host-key verification. Configure per-hop SSH policies to choose a different key for each hop.",
                  )}
                </p>
              </InfoPopover>
              {generateKey ? (
                <Button
                  disabled={busy}
                  disabledReason={busy ? t("Wait for the current action to finish.") : undefined}
                  loading={generating}
                  onClick={() =>
                    void act(setKeysProblem, t("Could not generate the SSH key."), async () => {
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
            {agentInventory.error ? (
              <Alert
                tone="danger"
                action={{
                  label: t("Retry"),
                  onClick: agentInventory.retry,
                  pending: agentInventory.loading,
                }}
                extra={
                  <ErrorDetails
                    title={t("Could not read the SSH agent.")}
                    detail={agentInventory.error}
                  />
                }
              >
                {t("Could not read the SSH agent.")}
              </Alert>
            ) : null}
            {agent ? (
              <Text as="div" tone="inherit" className="mbs-2">
                <span>
                  {t("SSH agent")}:{" "}
                  {agent.status === "available"
                    ? t("Available")
                    : agent.status === "empty"
                      ? t("No identities")
                      : t("Unavailable")}
                </span>
                {agent.identities.map((identity, index) => (
                  <p className="mbs-1 break-all" key={index}>
                    {identity.keyType} · {identity.fingerprint}
                  </p>
                ))}
              </Text>
            ) : null}
            {canAssignKey && selectedIdentity ? (
              <div className="mbs-2 flex min-w-0 flex-wrap items-center gap-2">
                <Text wrap="anywhere" as="p" tone="inherit" className="min-w-0 flex-1">
                  <LiveText
                    text={`${inheritedIdentity ? t("SSH key") : t("Assigned")}: ${selectedIdentity}`}
                  />
                </Text>
                <Button
                  variant="secondary"
                  disabled={busy}
                  disabledReason={busy ? t("Wait for the current action to finish.") : undefined}
                  onClick={() =>
                    void act(setKeysProblem, t("Could not assign the SSH key."), async () => {
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
              <Alert
                tone="danger"
                action={{
                  label: t("Retry"),
                  onClick: keyInventory.retry,
                  pending: keyInventory.loading,
                }}
                extra={
                  <ErrorDetails
                    title={t("Could not load the SSH keys.")}
                    detail={keyInventory.error}
                  />
                }
              >
                {t("Could not load the SSH keys.")}
              </Alert>
            ) : null}
            {keyInventory.loading && keys.length === 0 ? <LoadingText className="mbs-2" /> : null}
            {!keyInventory.loading && !keyInventory.error && keys.length === 0 ? (
              <EmptyState size="inline" className="mbs-2" description={t("No SSH keys found.")} />
            ) : null}
            {keys.length > 0 && matchingKeys.length === 0 ? (
              <EmptyState
                size="inline"
                kind="filtered"
                className="mbs-2"
                description={t("No matching SSH keys")}
                onReset={() => setKeySearch("")}
              />
            ) : null}
            <div {...surfaceAttributes({ dividers: "pane" }, "flex min-w-0 flex-col")}>
              {matchingKeys.map((key) => (
                <div
                  className="flex min-w-0 flex-wrap items-center gap-3 py-3"
                  key={`${key.identityFile}:${key.fingerprint}`}
                >
                  <Text as="div" tone="inherit" className="min-w-0 flex-1">
                    <Text wrap="anywhere" as="p" size="body" tone="inherit" weight="medium">
                      {key.identityFile?.split(/[\\/]/).pop() ?? key.keyType}
                    </Text>
                    <Text wrap="anywhere" as="p" size="inherit" tone="muted">
                      {key.identityFile}
                    </Text>
                    <div className="mbs-1 flex min-w-0 flex-wrap items-center gap-2">
                      <Badge size="xs">{key.keyType}</Badge>
                      <Text wrap="anywhere" size="caption" tone="muted">
                        {key.fingerprint}
                      </Text>
                    </div>
                  </Text>
                  {canAssignKey && key.identityFile ? (
                    <Button
                      variant="ghost"
                      iconOnly
                      label={`${t("Assign key")}: ${key.identityFile} (${server?.name})`}
                      pressed={!inheritedIdentity && selectedIdentity === key.identityFile}
                      disabled={
                        busy || (!inheritedIdentity && selectedIdentity === key.identityFile)
                      }
                      disabledReason={
                        busy
                          ? t("Wait for the current action to finish.")
                          : !inheritedIdentity && selectedIdentity === key.identityFile
                            ? t("This key is already assigned.")
                            : undefined
                      }
                      onClick={() => {
                        void act(setKeysProblem, t("Could not assign the SSH key."), async () => {
                          await assignIdentity(key.identityFile);
                        });
                      }}
                    >
                      {!inheritedIdentity && selectedIdentity === key.identityFile ? (
                        <Check className="icon-xs" />
                      ) : (
                        <CircleDashed className="icon-xs" />
                      )}
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </TabPanel>
          <TabPanel value="hosts" keepMounted className="flex min-w-0 flex-col gap-3">
            <SearchInput
              appearance="field"
              aria-label={t("Search known hosts")}
              placeholder={t("Search known hosts")}
              value={hostSearch}
              onChange={(event) => setHostSearch(event.target.value)}
            />
            {hostInventory.loading ? <LoadingText /> : null}
            {hostsError ? (
              <Alert
                tone="danger"
                action={{
                  label: t("Retry"),
                  onClick: hostInventory.retry,
                  pending: hostInventory.loading,
                }}
                extra={
                  <ErrorDetails title={t("Could not load the known hosts.")} detail={hostsError} />
                }
              >
                {t("Could not load the known hosts.")}
              </Alert>
            ) : null}
            {!hosts.length && !hostInventory.loading && !hostsError ? (
              <EmptyState size="inline" description={t("No known hosts yet.")} />
            ) : null}
            {hosts.length > 0 && matchingHosts.length === 0 ? (
              <EmptyState
                size="inline"
                kind="filtered"
                description={t("No results")}
                onReset={() => setHostSearch("")}
              />
            ) : null}
            {matchingHosts.map((host, index) => (
              <div
                key={index}
                {...surfaceAttributes({ separator: "block" }, "flex min-w-0 flex-col gap-2 py-3")}
              >
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <Text wrap="anywhere" weight="medium">
                    {host.hostPatterns}
                  </Text>
                  <Badge size="xs">{host.keyType}</Badge>
                </div>
                <Text wrap="anywhere" size="caption" tone="muted">
                  {host.fingerprint}
                </Text>
              </div>
            ))}
          </TabPanel>
          <TabPanel value="import" keepMounted className="flex flex-col gap-3">
            <TextareaField
              label={t("SSH config")}
              value={config}
              onChange={(event) => {
                configRef.current = event.target.value;
                setConfig(event.target.value);
                setPreview(undefined);
              }}
              rows={6}
            />
            {importProblem ? (
              <InlineError details={importProblem.details}>{importProblem.title}</InlineError>
            ) : null}
            {preview?.warnings.map((warning, index) => (
              <Alert key={index} tone="warning">
                {warning}
              </Alert>
            ))}
            {newHosts.length > 1 ? (
              <Button
                loading={busy}
                onClick={() =>
                  void act(setImportProblem, t("Could not import the SSH hosts."), async () => {
                    for (const host of newHosts) {
                      await saveSshConnection({
                        name: host.alias,
                        endpoint: host.endpoint,
                        importOnly: true,
                      });
                      setPreview(
                        (previous) =>
                          previous && {
                            ...previous,
                            hosts: previous.hosts.filter((h) => h !== host),
                          },
                      );
                    }
                  })
                }
              >
                {t("Import all new")}
              </Button>
            ) : null}
            {preview?.hosts.map((host, index) => {
              const existing = existingFor(host);
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
                    void act(setImportProblem, t("Could not import this SSH host."), async () => {
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
          </TabPanel>
        </Tabs>
      </div>
    </Sheet>
  );
}
