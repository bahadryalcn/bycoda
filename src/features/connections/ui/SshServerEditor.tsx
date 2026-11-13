import { Text } from "../../../shared/ui/Text";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { FieldGroup } from "../../../shared/ui/FieldGroup";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { useId, useState } from "react";
import { SshCertificateInspection } from "./SshCertificateInspection";
import { SshIdentityField } from "./SshIdentityField";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { SshJumpPolicyEditor } from "./SshJumpPolicyEditor";
import { NumberField } from "../../../shared/ui/NumberField";
import { Switch } from "../../../shared/ui/Switch";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
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
import { InlineError } from "../../../shared/ui/InlineError";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { TextField } from "../../../shared/ui/TextField";
import { saveSshConnection, type ServerRecord, type SshEndpoint } from "../model/serverInventory";
import { errorText } from "./serverActionFeedback";

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
  const [jumpHosts, setJumpHosts, retireJumpHosts] = useRetainedState<string[]>(
    `${scope}:jump-chain`,
    server?.sshEndpoint?.jumpHosts ??
      (server?.sshEndpoint?.jumpHost ? [server.sshEndpoint.jumpHost] : [""]),
  );
  const [perHopPolicy, setPerHopPolicy] = useRetainedState(
    `${scope}:per-hop-policy`,
    Boolean(server?.sshEndpoint?.jumpPolicies?.length),
  );
  const [policyDrafts, setPolicyDrafts, retirePolicyDrafts] = useRetainedState<
    SshJumpPolicyDraft[]
  >(`${scope}:jump-policies`, () =>
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
  const formId = useId();
  // A saved new server or quick connection must not reopen pre-filled. Edits keep their draft.
  const clearDraft = () => {
    if (server) return;
    setName("");
    setHost("");
    setUser("");
    setPort("22");
    setIdentityFile("");
    setCertificateFile("");
    const emptyHops = [""];
    setJumpHosts(emptyHops);
    retireJumpHosts(emptyHops);
    setPerHopPolicy(false);
    const emptyPolicies = [emptySshJumpPolicyDraft()];
    setPolicyDrafts(emptyPolicies);
    retirePolicyDrafts(emptyPolicies);
    setProxyEnabled(false);
    setProxyHost("");
    setProxyScheme("http");
    setProxyPort("8080");
    setSaveConnection(false);
  };
  return (
    <Modal
      title={onConnect ? t("Quick connect") : server ? t("Edit SSH server") : t("Add SSH server")}
      onClose={() => {
        if (!saving) onClose();
      }}
      size="md"
      footer={
        <ModalActions>
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={saving}>
            {onConnect ? t("Connect") : t("Save")}
          </Button>
        </ModalActions>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-3"
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
          let phase: "save" | "connect" = "save";
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
            if (onConnect) {
              phase = "connect";
              onConnect(endpoint, name.trim() || sshEndpointPreview(endpoint), saved);
            } else if (saved) onSaved?.(saved);
            clearDraft();
          } catch (reason) {
            setError(
              `${phase === "connect" ? t("Couldn’t open this SSH connection.") : t("Couldn’t save the SSH server.")} ${errorText(reason)}`,
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        <FieldGroup legend={t("Connection")}>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_6rem] items-start gap-3">
            <TextField
              label={t("Host")}
              placeholder="server.example.com"
              value={host}
              required
              maxLength={253}
              onChange={(event) => setHost(event.target.value)}
              disabled={saving}
            />
            <NumberField
              label={t("SSH port")}
              value={port}
              min={1}
              max={65535}
              required
              onChange={(event) => setPort(event.target.value)}
              disabled={saving}
            />
          </div>
        </FieldGroup>
        <div {...surfaceAttributes({ frame: "stroke", edge: "top" }, "min-w-0 pbs-3")}>
          <FieldGroup legend={t("Credentials")}>
            <TextField
              label={t("SSH user")}
              value={user}
              maxLength={128}
              onChange={(event) => setUser(event.target.value)}
              disabled={saving}
            />
            <SshIdentityField value={identityFile} onChange={setIdentityFile} disabled={saving} />
          </FieldGroup>
        </div>
        <TextField
          label={t("Name")}
          value={name}
          required={!onConnect || saveConnection}
          maxLength={200}
          onChange={(event) => setName(event.target.value)}
          disabled={saving}
        />
        <Text as="div" tone="muted">
          <p>
            {t(
              "Enter the server address and SSH user. Connect opens a terminal; Save adds it to your servers.",
            )}
          </p>
          <p className="mbs-2">{t("Leave empty to use your SSH agent and default identities.")}</p>
        </Text>
        {!onConnect && valid && endpoint.httpProxy ? (
          <Text wrap="anywhere" as="p" tone="muted">
            {endpoint.httpProxy.scheme === "https" ? "HTTPS CONNECT" : "HTTP CONNECT"}:{" "}
            {sshEndpointPreview(endpoint.httpProxy)}
          </Text>
        ) : null}
        <Disclosure
          size="sm"
          defaultOpen={Boolean(
            server?.sshEndpoint?.certificateFile ||
            server?.sshEndpoint?.httpProxy ||
            server?.sshEndpoint?.jumpHost ||
            server?.sshEndpoint?.jumpHosts?.length ||
            server?.sshEndpoint?.jumpPolicies?.length,
          )}
          {...surfaceAttributes({ frame: "stroke", edge: "top" }, "pbs-3")}
          textSize="caption"
          tone="muted"
          summary={t("Advanced SSH settings")}
        >
          <Text as="div" size="caption" tone="muted">
            <div className="flex flex-col gap-3">
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
              <Switch
                checked={perHopPolicy}
                onCheckedChange={setPerHopPolicy}
                disabled={saving}
                label={t("Per-hop SSH policy")}
              />
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
          </Text>
        </Disclosure>
        <Disclosure size="sm" textSize="caption" tone="muted" summary={t("Connection proxy")}>
          <Text as="div" size="caption" tone="muted">
            <div className="flex min-w-0 flex-col gap-2">
              <Switch
                checked={proxyEnabled}
                onCheckedChange={setProxyEnabled}
                disabled={saving}
                label={t("HTTP CONNECT upstream")}
              />
              {proxyEnabled ? (
                <>
                  <FieldGroup variant="bare" disabled={saving}>
                    <RadioGroup
                      variant="inline"
                      label={t("Proxy transport")}
                      value={proxyScheme}
                      onValueChange={(value) => setProxyScheme(value as "http" | "https")}
                      options={[
                        { value: "http", label: "HTTP" },
                        { value: "https", label: "HTTPS" },
                      ]}
                    />
                  </FieldGroup>
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
                    <InlineError live="polite">
                      {t(
                        "Choose either an HTTP proxy or a jump chain. Both cannot be used together.",
                      )}
                    </InlineError>
                  ) : null}
                </>
              ) : null}
            </div>
          </Text>
        </Disclosure>
        {onConnect ? (
          <>
            <Checkbox
              checked={saveConnection}
              disabled={saving}
              onChange={(event) => setSaveConnection(event.target.checked)}
              label={t("Save connection")}
              size="caption"
              className="flex items-center gap-2"
            />
            {valid ? (
              <Text
                aria-label={t("Endpoint preview")}
                as="div"
                tone="inherit"
                {...surfaceAttributes({ frame: "stroke", edge: "top" }, "pbs-3")}
              >
                <Text wrap="anywhere" as="p" size="inherit" tone="inherit" weight="medium">
                  {sshEndpointPreview(endpoint)}
                </Text>
                {endpoint.jumpHosts?.length ? (
                  <Text wrap="anywhere" as="p" size="inherit" tone="muted" className="mbs-1">
                    {t("Jump chain")}: {endpoint.jumpHosts.join(" → ")}
                  </Text>
                ) : null}
                {endpoint.jumpPolicies?.length ? (
                  <Text wrap="anywhere" as="p" size="inherit" tone="muted" className="mbs-1">
                    {t("Jump chain")}: {endpoint.jumpPolicies.map(sshEndpointPreview).join(" → ")}
                  </Text>
                ) : null}
                {endpoint.httpProxy ? (
                  <Text wrap="anywhere" as="p" size="inherit" tone="muted" className="mbs-1">
                    {endpoint.httpProxy.scheme === "https" ? "HTTPS CONNECT" : "HTTP CONNECT"}:{" "}
                    {sshEndpointPreview(endpoint.httpProxy)}
                  </Text>
                ) : null}
                {endpoint.identityFile ? (
                  <Text wrap="anywhere" as="p" size="inherit" tone="muted" className="mbs-1">
                    {t("Identity file")}: {endpoint.identityFile}
                  </Text>
                ) : null}
                {endpoint.certificateFile ? (
                  <Text wrap="anywhere" as="p" size="inherit" tone="muted" className="mbs-1">
                    {t("Public SSH certificate file")}: {endpoint.certificateFile}
                  </Text>
                ) : null}
                {!endpoint.user ? (
                  <Text as="p" size="inherit" tone="muted" className="mbs-1">
                    {t("Uses the default SSH user.")}
                  </Text>
                ) : null}
              </Text>
            ) : null}
          </>
        ) : null}
        {error ? <InlineError>{error}</InlineError> : null}
      </form>
    </Modal>
  );
}
