import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t, useLocale } from "../../../shared/i18n";
import { HarnessIcon } from "../../sessions/public/HarnessIcon";
import { Button } from "../../../shared/ui/Button";
import { Select as SharedSelect } from "../../../shared/ui/Select";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { AdvancedSettings, Row, SettingsFeedback } from "./settingsControls";
import { MCP_PROVIDER_LABELS, type McpConnection } from "../model/mcp";
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

export function scopeLabel(scope: Scope): string {
  return scope === "user" ? t("Global") : scope === "project" ? t("Project") : t("Local project");
}

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
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
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
  const [error, setError] = useState("");
  const adding = useRef(false);
  const formId = useId();

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (adding.current) return;
    adding.current = true;
    try {
      const parsed: unknown = JSON.parse(config);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(t("Configuration must be a JSON object"));
      }
      setBusy(true);
      setError("");
      await invoke("mcp_add", {
        cwd,
        provider,
        scope,
        name: name.trim(),
        config,
      });
      await onAdded();
      onClose();
    } catch (cause) {
      setError(String(cause));
    } finally {
      adding.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t("Add MCP server")}
      description={t("Paste a server configuration and choose where to add it.")}
      onClose={() => {
        if (!adding.current) onClose();
      }}
      fitViewport
      footer={
        <ModalActions>
          <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={busy}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            form={formId}
            loading={busy}
            disabled={busy}
          >
            {t("Add server")}
          </Button>
        </ModalActions>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          void add(event).catch((cause) => setError(String(cause)));
        }}
        className="space-y-4 p-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <McpPicker
            disabled={busy}
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
            disabled={busy}
            label={t("Scope")}
            value={scope}
            options={SCOPES[provider].map((option) => ({
              value: option,
              label: scopeLabel(option),
            }))}
            onChange={setScope}
          />
        </div>
        <p className="text-ui-caption text-(--ui-text-secondary)" role="status">
          {MCP_PROVIDER_LABELS[provider]} · {scopeDescription(scope)}
        </p>
        <p className="break-all text-ui-caption text-(--ui-text-muted)">
          {t("Selected project: {p0}", { p0: cwd })}
        </p>
        <label className="block text-ui-caption text-(--ui-text-secondary)">
          {t("Name")}{" "}
          <span className="text-(--ui-text-muted)">{t("(optional for an mcpServers block)")}</span>
          <TextField
            hideLabel
            label={t("Name")}
            value={name}
            disabled={busy}
            pattern={provider === "opencode" ? undefined : "[A-Za-z0-9_-]*"}
            onChange={(event) => setName(event.target.value)}

            placeholder={t("my-server")}
          />
        </label>
        <label className="block text-ui-caption text-(--ui-text-secondary)">
          {t("JSON configuration")}
          <TextareaField
            hideLabel
            label={t("JSON configuration")}
            required
            value={config}
            disabled={busy}
            onChange={(event) => setConfig(event.target.value)}
            rows={7}
            spellCheck={false}

            placeholder={
              '{"mcpServers":{"my-server":{"command":"npx","args":["-y","example-mcp"]}}}'
            }
          />
        </label>
        <p className="text-ui-caption text-(--ui-text-muted)">
          {t(
            "Paste one entry from an mcpServers block, or a single server object with a name above.",
          )}
        </p>
        <AdvancedSettings title={t("Advanced: configuration requirements")}>
          <Row
            label={t("Before adding a server")}
            description={t(
              "Check the command or URL and required credentials. Adding saves configuration for the selected provider and scope; it does not confirm a working connection. Refresh to check available status.",
            )}
          />
        </AdvancedSettings>
        {error ? <SettingsFeedback state="error">{error}</SettingsFeedback> : null}
      </form>
    </Modal>
  );
}
