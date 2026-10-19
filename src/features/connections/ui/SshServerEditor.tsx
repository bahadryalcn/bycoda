import { useState } from "react";
import { SshCertificateInspection } from "./SshCertificateInspection";
import { SshIdentityField } from "./SshIdentityField";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { SshJumpPolicyEditor } from "./SshJumpPolicyEditor";
import { Switch } from "../../../shared/ui/Switch";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import {
  emptySshJumpPolicyDraft,
  sshJumpPolicyDrafts,
  sshJumpPoliciesFromDrafts,
  type SshJumpPolicyDraft,
} from "../model/sshJumpPolicies";
import { SshJumpChainEditor } from "./SshJumpChainEditor";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { sshEndpointPreview, validSshEndpointPreview } from "../model/sshEndpointReview";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import { TextField } from "../../../shared/ui/TextField";
import { saveSshConnection, type ServerRecord, type SshEndpoint } from "../model/serverInventory";

/** Stores endpoint references only. Password and private key material never enter this form. */
export function SshServerEditor({
  server,
  onClose,
  onSaved,
  onConnect,
}: {
  server?: ServerRecord;
  onClose: () => void;
  onSaved?: (server: ServerRecord) => void;
  onConnect?: (endpoint: SshEndpoint, name: string, saved?: ServerRecord) => void;
}) {
  // Retain unfinished drafts, while a later canonical edit starts from its new
  // endpoint/name instead of silently reviving an older editor snapshot.
  const scope = `servers:${onConnect ? "quick" : `editor:${server?.id ?? "new"}:${server ? JSON.stringify([server.name, server.sshEndpoint]) : ""}`}`;
  const [name, setName] = useRetainedState(`${scope}:name`, server?.name ?? "");
  const [host, setHost] = useRetainedState(`${scope}:host`, server?.sshEndpoint?.host ?? "");
  const [user, setUser] = useRetainedState(`${scope}:user`, server?.sshEndpoint?.user ?? "");
  const [port, setPort] = useRetainedState(
    `${scope}:port`,
    String(server?.sshEndpoint?.port ?? 22),
  );
  const [identityFile, setIdentityFile] = useRetainedState(
    `${scope}:identity`,
    server?.sshEndpoint?.identityFile ?? "",
  );
  const [certificateFile, setCertificateFile] = useRetainedState(
    `${scope}:certificate`,
    server?.sshEndpoint?.certificateFile ?? "",
  );
  const [jumpHosts, setJumpHosts] = useRetainedState<string[]>(
    `${scope}:jump-chain`,
    server?.sshEndpoint?.jumpHosts ??
      (server?.sshEndpoint?.jumpHost ? [server.sshEndpoint.jumpHost] : [""]),
  );
  const [perHopPolicy, setPerHopPolicy] = useRetainedState(
    `${scope}:per-hop-policy`,
    Boolean(server?.sshEndpoint?.jumpPolicies?.length),
  );
  const [policyDrafts, setPolicyDrafts] = useRetainedState<SshJumpPolicyDraft[]>(
    `${scope}:jump-policies`,
    () =>
      server?.sshEndpoint?.jumpPolicies?.length
        ? sshJumpPolicyDrafts(server.sshEndpoint.jumpPolicies)
        : [emptySshJumpPolicyDraft()],
  );
  const jumpPolicies = sshJumpPoliciesFromDrafts(policyDrafts);
  const [proxyEnabled, setProxyEnabled] = useRetainedState(
    `${scope}:http-proxy-enabled`,
    Boolean(server?.sshEndpoint?.httpProxy),
  );
  const [proxyHost, setProxyHost] = useRetainedState(
    `${scope}:http-proxy-host`,
    server?.sshEndpoint?.httpProxy?.host ?? "",
  );
  const [proxyScheme, setProxyScheme] = useRetainedState<"http" | "https">(
    `${scope}:http-proxy-scheme`,
    server?.sshEndpoint?.httpProxy?.scheme ?? "http",
  );
  const [proxyPort, setProxyPort] = useRetainedState(
    `${scope}:http-proxy-port`,
    String(server?.sshEndpoint?.httpProxy?.port ?? 8080),
  );
  const chain = jumpHosts.map((hop) => hop.trim());
  const hasChain = chain.length > 0 && !(chain.length === 1 && !chain[0]);
  const [saveConnection, setSaveConnection] = useRetainedState(`${scope}:save`, false);
  const endpoint: SshEndpoint = {
    host: host.trim(),
    user: user.trim() || undefined,
    port: Number(port),
    identityFile: identityFile.trim() || undefined,
    jumpHost: undefined,
    ...(perHopPolicy ? { jumpPolicies: jumpPolicies ?? [] } : hasChain ? { jumpHosts: chain } : {}),
    ...(proxyEnabled
      ? {
          httpProxy: {
            host: proxyHost.trim(),
            port: Number(proxyPort),
            ...(proxyScheme === "https" ? { scheme: proxyScheme } : {}),
          },
        }
      : {}),
    ...(certificateFile.trim() ? { certificateFile: certificateFile.trim() } : {}),
  };
  const proxyConflict = proxyEnabled && (perHopPolicy ? policyDrafts.length > 0 : hasChain);
  const valid =
    (!perHopPolicy || jumpPolicies !== undefined) &&
    (!proxyEnabled || /^\d+$/.test(proxyPort)) &&
    !proxyConflict &&
    validSshEndpointPreview(endpoint);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title={onConnect ? t("Quick connect") : server ? t("Edit SSH server") : t("Add SSH server")}
      onClose={() => {
        if (!saving) onClose();
      }}
      size="sm"
    >
      <form
        className="flex flex-col gap-3 p-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (saving) return;
          const sshPort = Number(port);
          if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) {
            setError(t("Enter a port between 1 and 65535."));
            return;
          }
          setSaving(true);
          setError("");
          try {
            if (!valid) {
              setError(t("Enter a valid SSH endpoint."));
              return;
            }
            let saved: ServerRecord | undefined;
            if (!onConnect || saveConnection)
              saved = await saveSshConnection({
                id: server?.id,
                name: name.trim() || sshEndpointPreview(endpoint),
                endpoint,
              });
            if (onConnect) onConnect(endpoint, name.trim() || sshEndpointPreview(endpoint), saved);
            else if (saved) onSaved?.(saved);
          } catch {
            setError(
              onConnect
                ? t("Couldn’t open this SSH connection.")
                : t("Couldn’t save the SSH server."),
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        <TextField
          label={t("Host")}
          placeholder="server.example.com"
          value={host}
          required
          maxLength={253}
          onChange={(event) => setHost(event.target.value)}
          disabled={saving}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label={t("SSH user")}
            value={user}
            maxLength={128}
            onChange={(event) => setUser(event.target.value)}
            disabled={saving}
          />
          <TextField
            label={t("SSH port")}
            type="number"
            value={port}
            min={1}
            max={65535}
            required
            onChange={(event) => setPort(event.target.value)}
            disabled={saving}
          />
        </div>
        <TextField
          label={t("Name")}
          value={name}
          required={!onConnect || saveConnection}
          maxLength={200}
          onChange={(event) => setName(event.target.value)}
          disabled={saving}
        />
        <details className="text-xs text-(--ui-text-muted)">
          <summary className="cursor-pointer py-1">{t("Connection help")}</summary>
          <p className="mbs-2">
            {t(
              "Enter the server address and SSH user. Connect opens a terminal; Save adds it to your servers.",
            )}
          </p>
          <p className="mbs-2">{t("Leave empty to use your SSH agent and default identities.")}</p>
        </details>
        {!onConnect && valid && endpoint.httpProxy ? (
          <p className="break-all text-xs text-(--ui-text-muted)">
            {endpoint.httpProxy.scheme === "https" ? "HTTPS CONNECT" : "HTTP CONNECT"}:{" "}
            {sshEndpointPreview(endpoint.httpProxy)}
          </p>
        ) : null}
        <details open={Boolean(server?.sshEndpoint?.identityFile)} className="text-xs text-(--ui-text-muted)">
          <summary className="cursor-pointer py-1">{t("Authentication and jump host")}</summary>
          <div className="mbs-2 flex flex-col gap-3">
            <SshIdentityField
              value={identityFile}
              onChange={setIdentityFile}
              disabled={saving}
            />
            <TextField
              label={t("Public SSH certificate file")}
              value={certificateFile}
              maxLength={4096}
              disabled={saving}
              onChange={(event) => setCertificateFile(event.target.value)}
              description={t(
                "Public certificate reference only. Private keys and enrollment stay outside this form.",
              )}
            />
            <SshCertificateInspection reference={certificateFile} disabled={saving} />
            <div className="flex items-center gap-2 text-xs">
              <Switch
                checked={perHopPolicy}
                onCheckedChange={setPerHopPolicy}
                disabled={saving}
                aria-label={t("Per-hop SSH policy")}
              />
              <span>{t("Per-hop SSH policy")}</span>
            </div>
            {perHopPolicy ? (
              <SshJumpPolicyEditor
                value={policyDrafts}
                onChange={setPolicyDrafts}
                disabled={saving}
              />
            ) : (
              <SshJumpChainEditor value={jumpHosts} onChange={setJumpHosts} disabled={saving} />
            )}
          </div>
        </details>
        <details className="text-xs text-(--ui-text-muted)">
          <summary className="cursor-pointer py-1">{t("Connection proxy")}</summary>
          <div className="mbs-2 flex min-w-0 flex-col gap-2">
            <div className="flex items-center gap-2">
              <Switch
                checked={proxyEnabled}
                onCheckedChange={setProxyEnabled}
                disabled={saving}
                aria-label={t("HTTP CONNECT upstream")}
              />
              <span>{t("HTTP CONNECT upstream")}</span>
            </div>
            {proxyEnabled ? (
              <>
                <fieldset disabled={saving} className="border-0 p-0">
                  <SegmentedControl
                    label={t("Proxy transport")}
                    value={proxyScheme}
                    onValueChange={(value) => setProxyScheme(value as "http" | "https")}
                    options={[
                      { value: "http", label: "HTTP" },
                      { value: "https", label: "HTTPS" },
                    ]}
                  />
                </fieldset>
                <TextField
                  label={t("Proxy host")}
                  value={proxyHost}
                  maxLength={253}
                  disabled={saving}
                  onChange={(event) => setProxyHost(event.target.value)}
                />
                <TextField
                  label={t("Proxy port")}
                  value={proxyPort}
                  inputMode="numeric"
                  maxLength={5}
                  disabled={saving}
                  onChange={(event) => setProxyPort(event.target.value)}
                />
                <p>
                  {t(
                    proxyScheme === "https"
                      ? "HTTPS verifies the proxy certificate and hostname before connecting."
                      : "The upstream connection uses plain HTTP. Basic credentials require separate approval for each operation.",
                  )}
                </p>
                {proxyConflict ? (
                  <p role="status" className="text-(--ui-tone-danger-fg)">
                    {t(
                      "Choose either an HTTP proxy or a jump chain. Both cannot be used together.",
                    )}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        </details>
        {onConnect ? (
          <>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={saveConnection}
                disabled={saving}
                onChange={(event) => setSaveConnection(event.target.checked)}
              />
              {t("Save connection")}
            </label>
            <div
              aria-label={t("Endpoint preview")}
              className="border-t border-stroke pbs-3 text-xs"
            >
              <p className="break-all font-medium">
                {valid ? sshEndpointPreview(endpoint) : t("Endpoint preview")}
              </p>
              {endpoint.jumpHosts?.length ? (
                <p className="mbs-1 break-all text-(--ui-text-muted)">
                  {t("Jump chain")}: {endpoint.jumpHosts.join(" → ")}
                </p>
              ) : null}
              {endpoint.jumpPolicies?.length ? (
                <p className="mbs-1 break-all text-(--ui-text-muted)">
                  {t("Jump chain")}: {endpoint.jumpPolicies.map(sshEndpointPreview).join(" → ")}
                </p>
              ) : null}
              {endpoint.httpProxy ? (
                <p className="mbs-1 break-all text-(--ui-text-muted)">
                  {endpoint.httpProxy.scheme === "https" ? "HTTPS CONNECT" : "HTTP CONNECT"}:{" "}
                  {sshEndpointPreview(endpoint.httpProxy)}
                </p>
              ) : null}
              {endpoint.identityFile ? (
                <p className="mbs-1 break-all text-(--ui-text-muted)">
                  {t("Identity file")}: {endpoint.identityFile}
                </p>
              ) : null}
              {endpoint.certificateFile ? (
                <p className="mbs-1 break-all text-(--ui-text-muted)">
                  {t("Public SSH certificate file")}: {endpoint.certificateFile}
                </p>
              ) : null}
              {!endpoint.user ? (
                <p className="mbs-1 text-(--ui-text-muted)">{t("Uses the default SSH user.")}</p>
              ) : null}
            </div>
          </>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-(--ui-tone-danger-fg)">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" type="submit" loading={saving}>
            {onConnect ? t("Connect") : t("Save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
