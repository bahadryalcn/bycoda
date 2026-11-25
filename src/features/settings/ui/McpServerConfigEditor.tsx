import { useEffect, useEffectEvent, useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { RotateCcw } from "../../../shared/ui/icons";
import { usePendingSource } from "../../../shared/ui/settings";
import type { McpServerRow } from "../model/mcpSettingsCache";
import { errorText } from "../../../shared/lib/errors";
import { invokeMcpConfig, type RemoteMcpConfigTarget } from "../model/mcpConfigTarget";

type ServerConfig = { config: string; revision: string };

/** Native arguments that identify one entry; the native side re-discovers and refuses anything else. */
const target = (server: McpServerRow, cwd: string, globalOnly: boolean) => ({
  cwd,
  provider: server.provider,
  scope: server.scope,
  configPath: server.configPath,
  name: server.name,
  ...(globalOnly ? { globalOnly: true } : {}),
});

/** Validates locally so a typo never reaches the file; the native writer validates again. */
function jsonError(text: string): string {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? ""
      : t("Configuration must be a JSON object");
  } catch (cause) {
    return errorText(cause);
  }
}

/**
 * Edits one server entry in its provider file. Saving sends the revision it loaded, so a
 * change made elsewhere is refused instead of overwritten; the draft stays until saved or reverted.
 */
type EditorProps = {
  server: McpServerRow;
  cwd: string;
  globalOnly: boolean;
  remote?: RemoteMcpConfigTarget;
  disabled: boolean;
  onSaved: () => Promise<void>;
};

export function McpServerConfigEditor(props: EditorProps) {
  const [opened, setOpened] = useState(false);
  return (
    <Disclosure
      summary={t("Edit provider JSON")}
      summaryActions={
        props.server.scope === "project" ? (
          <InfoPopover label={t("Project credentials")}>
            {t("This file can be shared with the project. Store tokens in Project credentials.")}
          </InfoPopover>
        ) : undefined
      }
      size="sm"
      onOpenChange={(open) => {
        if (open) setOpened(true);
      }}
    >
      {opened ? <ServerConfigForm {...props} /> : null}
    </Disclosure>
  );
}

function ServerConfigForm({ server, cwd, globalOnly, remote, disabled, onSaved }: EditorProps) {
  const [loaded, setLoaded] = useState<ServerConfig>();
  const [draft, setDraft] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState<{ title: string; detail?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const epoch = useRef(0);
  const identity = `${server.provider}:${server.scope}:${server.configPath}:${server.name}`;

  async function load() {
    const version = ++epoch.current;
    setLoadError("");
    try {
      const result = await invokeMcpConfig<ServerConfig>(
        "mcp_server_config_read",
        target(server, cwd, globalOnly),
        remote,
      );
      if (version !== epoch.current) return;
      setLoaded(result);
      setDraft(result.config);
      setSaveError(null);
    } catch (cause) {
      if (version === epoch.current) setLoadError(errorText(cause));
    }
  }
  const loadOnMount = useEffectEvent(() => void load());
  // Reason: read the entry from disk when the editor opens or its identity changes; epoch drops stale reads.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- loads the on-disk entry for this identity; epoch drops stale replies
  useEffect(() => {
    const replies = epoch;
    loadOnMount();
    return () => {
      replies.current++;
    };
  }, [identity]);

  /** Resolves true only once the native write acknowledged this draft; a refused or failed write keeps it. */
  async function save(): Promise<boolean> {
    if (!loaded || saving) return false;
    const invalid = jsonError(draft);
    if (invalid) {
      setSaveError({
        title: t("Enter a valid JSON object for the MCP configuration."),
        detail: invalid,
      });
      return false;
    }
    setSaving(true);
    setSaveError(null);
    let written = false;
    try {
      const result = await invokeMcpConfig<ServerConfig>(
        "mcp_server_config_write",
        {
          ...target(server, cwd, globalOnly),
          config: draft,
          expectedRevision: loaded.revision,
        },
        remote,
      );
      written = true;
      setLoaded(result);
      setDraft(result.config);
      await onSaved();
    } catch (cause) {
      setSaveError({
        title: written
          ? t("Could not refresh the saved MCP configuration.")
          : t("Could not save MCP configuration."),
        detail: errorText(cause),
      });
    } finally {
      setSaving(false);
    }
    return written;
  }

  // The leave prompt names the entry and the fact of a change, never the draft: it can hold env values or headers.
  usePendingSource(
    loaded && draft !== loaded.config
      ? {
          id: `mcp-config:${identity}`,
          title: t("Configuration for {p0}", { p0: server.name }),
          changes: [{ id: "config", label: t("Configuration") }],
          canSave: !disabled && !saving && !jsonError(draft),
          pending: saving,
          save,
          discard: () => {
            setDraft(loaded.config);
            setSaveError(null);
          },
        }
      : null,
  );

  if (loadError)
    return (
      <InlineError details={loadError} retry={{ onRetry: () => void load() }}>
        {t("Configuration could not be read.")}
      </InlineError>
    );
  if (!loaded) return <LoadingText>{t("Loading configuration…")}</LoadingText>;
  const dirty = draft !== loaded.config;
  return (
    <div className="grid w-full min-w-0 gap-2">
      <TextareaField
        label={t("Configuration for {p0}", { p0: server.name })}
        hideLabel
        value={draft}
        rows={Math.min(18, Math.max(6, draft.split("\n").length + 1))}
        monospace
        spellCheck={false}
        disabled={disabled || saving}
        onChange={(event) => {
          setDraft(event.target.value);
          setSaveError(null);
        }}
      />
      {saveError ? <InlineError details={saveError.detail}>{saveError.title}</InlineError> : null}
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          label={t("Revert")}
          disabled={!dirty || saving}
          onClick={() => {
            setDraft(loaded.config);
            setSaveError(null);
          }}
        >
          <RotateCcw aria-hidden />
        </Button>
        <Button
          variant="primary"
          size="sm"
          loading={saving}
          disabled={!dirty || disabled || saving}
          onClick={() => void save()}
        >
          {t("Save")}
        </Button>
      </div>
    </div>
  );
}
