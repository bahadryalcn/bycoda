import { invoke } from "@tauri-apps/api/core";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { Heading } from "../../../shared/ui/Heading";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Switch } from "../../../shared/ui/Switch";
import { Text } from "../../../shared/ui/Text";
import { remoteRequest } from "../../connections/public/connections";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { RemoteMachine } from "../../connections";
import { withDirectServer, type McpLoadingPolicy, type McpLoadingState } from "../model/mcp";
import { cacheMcpLoading, getCachedMcpLoading } from "../model/mcpSettingsCache";
import { playCue } from "../model/sounds";
import { Select, SettingsFeedback } from "./settingsControls";
import styles from "./McpLoadingMode.module.css";

/** Owner-only: when the Host loads hub-hosted MCP servers into sessions. */
export function McpLoadingMode({ cwd }: { cwd: string }) {
  const [state, setState] = useState<McpLoadingState | undefined>(() => getCachedMcpLoading(cwd));
  const [machine, setMachine] = useState<RemoteMachine>();
  const [loading, setLoading] = useState(!state);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const epoch = useRef(0);
  const pending = useRef(false);

  async function load() {
    const version = ++epoch.current;
    try {
      const machines = await invoke<RemoteMachine[]>("remote_machines");
      const local = machines?.find(isLocalSyncMachine);
      if (!local) throw new Error("Local host unavailable");
      const next = await remoteRequest<McpLoadingState>(local.id, "mcp.hub.loading.get", { cwd });
      if (version !== epoch.current) return;
      cacheMcpLoading(cwd, next);
      setMachine(local);
      setState(next);
    } catch {
      if (version === epoch.current)
        setError(
          t("MCP loading settings unavailable. Check the local host connection, then refresh."),
        );
    } finally {
      if (version === epoch.current) setLoading(false);
    }
  }
  const loadOnMount = useEffectEvent(() => void load());
  // Reason: read the Host policy on mount and per project; stale replies are dropped by epoch.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- keeps the Host-owned policy in step while mounted; epoch drops stale replies
  useEffect(() => {
    const replies = epoch;
    loadOnMount();
    return () => {
      replies.current++;
    };
  }, [cwd]);

  async function save(policy: McpLoadingPolicy) {
    if (!machine || pending.current) return;
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await remoteRequest<{ policy: McpLoadingPolicy }>(
        machine.id,
        "mcp.hub.loading.set",
        { mode: policy.mode, direct: policy.direct },
      );
      setState((current) => {
        const next = current && { ...current, policy: result.policy };
        if (next) cacheMcpLoading(cwd, next);
        return next;
      });
    } catch {
      setError(t("Saving MCP loading failed. The previous setting is still active."));
      void load();
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  const policy = state?.policy;
  const locked = saving || !!state?.corrupt;
  return (
    <Text
      as="section"
      size="secondary"
      tone="inherit"
      leading="inherit"
      className={styles.section}
      aria-labelledby="mcp-loading-heading"
      data-setting-id="mcp-loading"
    >
      <div className={styles.header}>
        <Heading size="item" level={2} id="mcp-loading-heading">
          {t("MCP loading")}
        </Heading>
        <InfoPopover className="shrink-0">
          <p>{t("Applies to new sessions.")}</p>
        </InfoPopover>
      </div>
      {loading && !state && <SettingsFeedback state="loading">{t("Loading…")}</SettingsFeedback>}
      {error && <SettingsFeedback state="error">{error}</SettingsFeedback>}
      {state?.corrupt && (
        <SettingsFeedback state="error">
          {t(
            "The MCP loading file is unreadable, so servers load on demand. Repair it to save changes.",
          )}
        </SettingsFeedback>
      )}
      {policy && (
        <>
          <div className={styles.row}>
            <Select
              label={t("Load MCP servers")}
              value={policy.mode}
              disabled={locked}
              onChange={(mode) => void save({ ...policy, mode: mode as McpLoadingPolicy["mode"] })}
              options={[
                { value: "onDemand", label: t("On demand (default)") },
                { value: "always", label: t("At session start") },
              ]}
            />
          </div>
          {policy.mode === "onDemand" &&
            state.servers.map((name) => (
              <div key={name} className={styles.row}>
                <Switch
                  label={name}
                  description={t("Load at start")}
                  checked={policy.direct.includes(name)}
                  disabled={locked}
                  onCheckedChange={(on) => {
                    playCue("switch");
                    void save(withDirectServer(policy, name, on));
                  }}
                />
              </div>
            ))}
        </>
      )}
    </Text>
  );
}
