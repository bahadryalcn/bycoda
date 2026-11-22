import { Text } from "../../../shared/ui/Text";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { HarnessIcon } from "../../sessions/public/HarnessIcon";
import { Button } from "../../../shared/ui/Button";
import { Select as SharedSelect } from "../../../shared/ui/Select";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { SettingsFeedback } from "../../../shared/ui/settings";
import {
  MCP_PROVIDER_LABELS,
  scopeLabel,
  type ManagedMcpConfig,
  type ManagedMcpIdentity,
  type McpConnection,
} from "../model/mcp";
import type { McpHub } from "../hooks/useMcpHub";
import { errorText } from "../../../shared/lib/errors";
import { invokeMcpConfig, type RemoteMcpConfigTarget } from "../model/mcpConfigTarget";
type Scope = McpConnection["scope"];
export type Provider = McpConnection["provider"];
type Destination = Provider | "hub";
export const PROVIDERS: Provider[] = ["claude", "claude_desktop", "codex", "cursor", "opencode"];
const SCOPES: Record<Provider, Scope[]> = {
  claude: ["local", "project", "user"],
  claude_desktop: ["user"],
  codex: ["user"],
  cursor: ["project", "user"],
  opencode: ["project", "user"],
};

export function scopeDescription(scope: Scope): string {
  return scope === "user"
    ? t("Global: applies to every project for this provider on this machine.")
    : scope === "project"
      ? t(
          "Saved in the project’s configuration file. Add private credentials from the server details.",
        )
      : t(
          "Local project: applies only to the selected project in your personal Claude configuration.",
        );
}

export function ProviderIcon({ provider }: { provider: Provider }) {
  useLocale();
  return (
    <HarnessIcon
      harness={provider === "claude_desktop" ? "claude" : provider}
      className="size-3.5 shrink-0"
    />
  );
}

function McpPicker<T extends string>({
  label,
  description,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  description?: string;
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <SharedSelect
      loopNavigation
      disabled={disabled}
      label={label}
      description={description}
      value={value}
      options={options}
      onValueChange={(value) => onChange(value as T)}
    />
  );
}

export function AddServerModal({
  cwd,
  initialProvider,
  globalOnly = false,
  remote,
  machineName,
  manageServer,
  editing,
  providerAvailable = true,
  onClose,
  onAdded,
}: {
  cwd: string;
  initialProvider: Provider;
  globalOnly?: boolean;
  remote?: RemoteMcpConfigTarget;
  machineName?: string;
  manageServer?: McpHub["manageServer"];
  editing?: ManagedMcpIdentity & { config: ManagedMcpConfig };
  providerAvailable?: boolean;
  onClose: () => void;
  onAdded: () => Promise<void>;
}) {
  useLocale();
  const scopesFor = (option: Destination) =>
    globalOnly
      ? (["user"] as const)
      : option === "hub"
        ? (["project", "user"] as const)
        : SCOPES[option];
  const initial = manageServer ? "hub" : initialProvider;
  const [provider, setProvider] = useState<Destination>(initial);
  const [scope, setScope] = useState<Scope>(editing?.scope ?? scopesFor(initial)[0]);
  const [format, setFormat] = useState<"url" | "json">(
    initial === "claude_desktop" || (editing && "command" in editing.config) ? "json" : "url",
  );
  const [url, setUrl] = useState(editing && "url" in editing.config ? editing.config.url : "");
  const [name, setName] = useState(editing?.name ?? "");
  const [config, setConfig] = useState(editing ? JSON.stringify(editing.config, null, 2) : "");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState("");
  const adding = useRef(false);
  const formId = useId();

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (adding.current) return;
    adding.current = true;
    let written = added;
    try {
      setBusy(true);
      setError("");
      if (!written) {
        if (format === "url" && !/^https?:\/\//i.test(url.trim())) {
          throw new Error(t("Enter an HTTP or HTTPS server URL."));
        }
        const payload =
          format === "json"
            ? config
            : JSON.stringify({
                ...(provider === "claude" ? { type: "http" } : {}),
                url: url.trim(),
              });
        const parsed: unknown = JSON.parse(payload);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error(t("Configuration must be a JSON object"));
        }
        if (provider === "hub") {
          if (!manageServer) throw new Error(t("Unavailable"));
          await manageServer(
            scope === "project" ? "project" : "user",
            editing
              ? { action: "update", name: editing.name, revision: editing.revision, config: parsed }
              : { action: "add", name: name.trim(), config: parsed },
          );
        } else
          await invokeMcpConfig(
            "mcp_add",
            {
              cwd,
              provider,
              scope,
              name: name.trim(),
              config: payload,
            },
            remote,
          );
        written = true;
        setAdded(true);
      }
      await onAdded();
      onClose();
    } catch (cause) {
      setError(
        written
          ? editing
            ? t("Configuration could not be read.")
            : t("Server added. Refresh failed. Retry to check status.")
          : errorText(cause),
      );
    } finally {
      adding.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal
      title={editing ? editing.name : t("Add MCP server")}
      description={machineName ? t("Save on {p0}", { p0: machineName }) : undefined}
      onClose={() => {
        if (!adding.current) onClose();
      }}
      fitViewport
      footer={
        <ModalActions>
          <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={busy}>
            {added ? t("Done") : t("Cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            form={formId}
            loading={busy}
            disabled={busy}
          >
            {added ? t("Retry") : editing ? t("Save changes") : t("Add server")}
          </Button>
        </ModalActions>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          void add(event).catch((cause) => setError(errorText(cause)));
        }}
        className="space-y-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <McpPicker
            disabled={busy || added || !!editing || !providerAvailable}
            label={t("Provider")}
            value={provider}
            options={[
              ...(manageServer ? [{ value: "hub" as const, label: "bycoda Hub" }] : []),
              ...(providerAvailable && !editing
                ? PROVIDERS.map((option) => ({
                    value: option,
                    label: MCP_PROVIDER_LABELS[option],
                    icon: <ProviderIcon provider={option} />,
                  }))
                : []),
            ]}
            onChange={(next) => {
              setProvider(next);
              setScope(scopesFor(next)[0]);
              if (next === "claude_desktop") setFormat("json");
            }}
          />
          <McpPicker
            disabled={busy || added || !!editing}
            label={t("Scope")}
            description={provider === "hub" ? undefined : scopeDescription(scope)}
            value={scope}
            options={scopesFor(provider).map((option) => ({
              value: option,
              label: scopeLabel(option),
            }))}
            onChange={setScope}
          />
        </div>
        {scope === "user" ? null : (
          <Text as="p" size="caption" tone="secondary" className="break-all">
            {t("Selected project: {p0}", { p0: cwd })}
          </Text>
        )}
        <TextField
          label={t("Name")}
          value={name}
          disabled={busy || added || !!editing}
          required={format === "url" || provider === "hub"}
          pattern={provider === "opencode" ? undefined : "[A-Za-z0-9_-]*"}
          onChange={(event) => setName(event.target.value)}

          placeholder={t("my-server")}
        />

        <McpPicker
          label={t("Setup method")}
          value={format}
          disabled={busy || added}
          options={[
            ...(provider !== "claude_desktop"
              ? [{ value: "url" as const, label: t("Server URL") }]
              : []),
            { value: "json", label: t("JSON configuration") },
          ]}
          onChange={setFormat}
        />
        {format === "url" ? (
          <TextField
            label={t("Server URL")}
            required
            type="url"
            value={url}
            disabled={busy || added}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/mcp"
          />
        ) : (
          <TextareaField
            label={t("JSON configuration")}
            description={
              provider === "hub" ? undefined : t("Paste an mcpServers block or a server object.")
            }
            required
            value={config}
            disabled={busy || added}
            onChange={(event) => setConfig(event.target.value)}
            rows={6}
            monospace
            spellCheck={false}

            placeholder={
              provider === "hub"
                ? '{"command":"npx","args":["-y","example-mcp"]}'
                : '{"mcpServers":{"my-server":{"command":"npx","args":["-y","example-mcp"]}}}'
            }
          />
        )}

        {error ? <SettingsFeedback state="error">{error}</SettingsFeedback> : null}
      </form>
    </Modal>
  );
}
