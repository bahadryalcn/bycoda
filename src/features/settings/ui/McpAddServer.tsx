import { Text } from "../../../shared/ui/Text";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t, useLocale } from "../../../shared/i18n";
import { HarnessIcon } from "../../sessions/public/HarnessIcon";
import { Button } from "../../../shared/ui/Button";
import { Select as SharedSelect } from "../../../shared/ui/Select";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { SettingsFeedback } from "../../../shared/ui/settings";
import { MCP_PROVIDER_LABELS, scopeLabel, type McpConnection } from "../model/mcp";
import { errorText } from "../../../shared/lib/errors";
type Scope = McpConnection["scope"];
export type Provider = McpConnection["provider"];
export const PROVIDERS: Provider[] = ["claude", "claude_desktop", "codex", "cursor", "opencode"];
const SCOPES: Record<Provider, Scope[]> = {
  claude: ["user", "project", "local"],
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
          "Project: saved in the selected project's provider configuration; it may be shared with the project.",
        )
      : t(
          "Local project: applies only to the selected project in your personal Claude configuration.",
        );
}

/** The one server name an `mcpServers` block carries; the host rejects a different typed Name. */
export function serverNameInJson(config: string): string | null {
  try {
    const servers = (JSON.parse(config) as { mcpServers?: unknown } | null)?.mcpServers;
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) return null;
    const names = Object.keys(servers);
    return names.length === 1 ? names[0] : null;
  } catch {
    return null;
  }
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
  onClose,
  onAdded,
}: {
  cwd: string;
  initialProvider: Provider;
  onClose: () => void;
  onAdded: () => Promise<void>;
}) {
  useLocale();
  const [provider, setProvider] = useState<Provider>(initialProvider);
  const [scope, setScope] = useState<Scope>(SCOPES[initialProvider][0]);
  const [name, setName] = useState("");
  const [config, setConfig] = useState("");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState("");
  const adding = useRef(false);
  const formId = useId();
  const nameInJson = serverNameInJson(config);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (adding.current) return;
    adding.current = true;
    let written = added;
    try {
      setBusy(true);
      setError("");
      if (!written) {
        const parsed: unknown = JSON.parse(config);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error(t("Configuration must be a JSON object"));
        }
        await invoke("mcp_add", {
          cwd,
          provider,
          scope,
          name: nameInJson ? "" : name.trim(),
          config,
        });
        written = true;
        setAdded(true);
      }
      await onAdded();
      onClose();
    } catch (cause) {
      setError(
        written ? t("Server added. Refresh failed. Retry to check status.") : errorText(cause),
      );
    } finally {
      adding.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t("Add MCP server")}
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
            {added ? t("Retry") : t("Add server")}
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
            disabled={busy || added}
            label={t("Provider")}
            value={provider}
            options={PROVIDERS.map((option) => ({
              value: option,
              label: MCP_PROVIDER_LABELS[option],
              icon: <ProviderIcon provider={option} />,
            }))}
            onChange={(next) => {
              setProvider(next);
              setScope(SCOPES[next][0]);
            }}
          />
          <McpPicker
            disabled={busy || added}
            label={t("Scope")}
            description={scopeDescription(scope)}
            value={scope}
            options={SCOPES[provider].map((option) => ({
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
          description={
            nameInJson
              ? t("The name comes from the JSON configuration.")
              : t("Needed when the JSON is a bare server object without an mcpServers entry.")
          }
          value={nameInJson ?? name}
          disabled={busy || added || nameInJson !== null}
          pattern={provider === "opencode" ? undefined : "[A-Za-z0-9_-]*"}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("my-server")}
        />

        <TextareaField
          label={t("JSON configuration")}
          description={t("Paste an mcpServers block or a server object.")}
          required
          value={config}
          disabled={busy || added}
          onChange={(event) => setConfig(event.target.value)}
          rows={6}
          monospace
          spellCheck={false}

          placeholder={'{"mcpServers":{"my-server":{"command":"npx","args":["-y","example-mcp"]}}}'}
        />

        {error ? <SettingsFeedback state="error">{error}</SettingsFeedback> : null}
      </form>
    </Modal>
  );
}
