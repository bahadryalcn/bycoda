import { invoke } from "@tauri-apps/api/core";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { TextareaField } from "../../../shared/ui/TextareaField";
import type { McpServerRow } from "../model/mcpSettingsCache";

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
    return cause instanceof Error ? cause.message : String(cause);
  }
}

/**
 * Edits one server entry in its provider file. Saving sends the revision it loaded, so a
 * change made elsewhere is refused instead of overwritten; the draft stays until saved or reverted.
 */
export function McpServerConfigEditor({
  server,
  cwd,
  globalOnly,
  disabled,
  onSaved,
}: {
  server: McpServerRow;
  cwd: string;
  globalOnly: boolean;
  disabled: boolean;
  onSaved: () => Promise<void>;
}) {
  const [loaded, setLoaded] = useState<ServerConfig>();
  const [draft, setDraft] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const epoch = useRef(0);
  const identity = `${server.provider}:${server.scope}:${server.configPath}:${server.name}`;

  async function load() {
    const version = ++epoch.current;
    setLoadError("");
    try {
      const result = await invoke<ServerConfig>(
        "mcp_server_config_read",
        target(server, cwd, globalOnly),
      );
      if (version !== epoch.current) return;
      setLoaded(result);
      setDraft(result.config);
      setSaveError("");
    } catch (cause) {
      if (version === epoch.current) setLoadError(String(cause));
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

  async function save() {
    if (!loaded || saving) return;
    const invalid = jsonError(draft);
    if (invalid) {
      setSaveError(invalid);
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const result = await invoke<ServerConfig>("mcp_server_config_write", {
        ...target(server, cwd, globalOnly),
        config: draft,
        expectedRevision: loaded.revision,
      });
      setLoaded(result);
      setDraft(result.config);
      await onSaved();
    } catch (cause) {
      setSaveError(String(cause));
    } finally {
      setSaving(false);
    }
  }

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
          setSaveError("");
        }}
      />
      {saveError ? <InlineError>{saveError}</InlineError> : null}
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={!dirty || saving}
          onClick={() => {
            setDraft(loaded.config);
            setSaveError("");
          }}
        >
          {t("Revert")}
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
