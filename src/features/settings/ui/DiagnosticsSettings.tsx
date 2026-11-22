import { errorText } from "../../../shared/lib/errors";
import { Text } from "../../../shared/ui/Text";
import { useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { getPerformanceTrace, clearPerformanceTrace } from "../../../shared/lib/performanceTrace";
import {
  PERFORMANCE_TRACE_KEY,
  applyPerformanceTraceEnabled,
  loadPerformanceTraceEnabled,
  savePerformanceTraceEnabled,
} from "../../../shared/lib/performanceTraceSettings";
import { Button } from "../../../shared/ui/Button";
import { Trash2 } from "../../../shared/ui/icons";
import { CopyButton } from "../../../shared/ui/CopyButton";
import { Group, Row, Toggle, SettingsFeedback } from "../../../shared/ui/settings";
import { loadHostStallProfiles, saveHostStallProfiles } from "../model/hostStallProfiles";

/** This computer's Host switch for saving CPU profiles when its event loop stalls. */
function HostStallProfilesRow() {
  const [enabled, setEnabled] = useState<boolean>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Sync the mounted switch with the local Host setting and discard late replies when it closes.
  useEffect(() => {
    let active = true;
    loadHostStallProfiles().then(
      (value) => {
        if (active) setEnabled(value);
      },
      (reason: unknown) => {
        if (active) setError(errorText(reason));
      },
    );
    return () => {
      active = false;
    };
  }, []);
  const onChange = (next: boolean) => {
    setSaving(true);
    setError(undefined);
    saveHostStallProfiles(next)
      .then(setEnabled, (reason: unknown) => setError(errorText(reason)))
      .finally(() => setSaving(false));
  };
  return (
    <Row
      id="host-stall-profiles"
      label={t("Host CPU profiles")}
      description={t(
        "Save a 30-second CPU profile to the Host log folder when its event loop stalls repeatedly.",
      )}
      info={t("For developers. Starting a profile briefly freezes the Host, so keep this off.")}
      feedback={
        error ? (
          <SettingsFeedback state="error">
            {t("Could not reach this computer's Host setting: {p1}", { p1: error })}
          </SettingsFeedback>
        ) : undefined
      }
    >
      <Toggle
        label={t("Host CPU profiles")}
        on={enabled === true}
        disabled={enabled === undefined || saving}
        onChange={onChange}
      />
    </Row>
  );
}

/**
 * Page-level "Restore defaults": the trace goes back to off. The mounted group follows through
 * the same storage event sibling windows use.
 */
export function restorePerformanceTraceDefault() {
  savePerformanceTraceEnabled(false);
  const saved = loadPerformanceTraceEnabled() === false;
  window.dispatchEvent(
    new StorageEvent("storage", { key: PERFORMANCE_TRACE_KEY, storageArea: localStorage }),
  );
  return saved;
}

/** Timings only: the copied JSON holds stage names, times, durations and counters. */
export function DiagnosticsGroup() {
  useLocale();
  const [enabled, setEnabled] = useState(loadPerformanceTraceEnabled);
  /** Set when the last toggle took effect in this window but could not be stored. */
  const [unsaved, setUnsaved] = useState(false);
  // One operation result at a time: Copy and Clear replace each other's message.
  const [result, setResult] = useState<"cleared" | null>(null);

  // The stored preference is shared with sibling windows: follow it, and apply it here.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (event.key !== null && event.key !== PERFORMANCE_TRACE_KEY) return;
      const durable = loadPerformanceTraceEnabled();
      applyPerformanceTraceEnabled(durable);
      setEnabled(durable);
      setUnsaved(false);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!result) return;
    const timer = window.setTimeout(() => setResult(null), 1600);
    return () => window.clearTimeout(timer);
  }, [result]);

  const onEnabled = (next: boolean) => {
    savePerformanceTraceEnabled(next);
    setEnabled(next);
    // The helper swallows storage failures, so read the stored value back: if it
    // differs the preference only holds for this window until a retry succeeds.
    setUnsaved(loadPerformanceTraceEnabled() !== next);
  };

  const traceJson = () =>
    JSON.stringify(
      { version: 1, exportedAt: new Date().toISOString(), records: getPerformanceTrace() },
      null,
      2,
    );

  const onClear = () => {
    clearPerformanceTrace();
    setResult("cleared");
  };

  return (
    <Group title={null}>
      <Row
        id="performance-trace"
        label={t("Performance trace")}
        description={t("Record startup timing, rendering stalls and long main-thread tasks.")}
        info={t("Only durations are kept, never message text, paths or script names.")}
        feedback={
          unsaved ? (
            <SettingsFeedback
              state="warning"
              action={{ label: t("Retry saving"), onClick: () => onEnabled(enabled) }}
            >
              {enabled
                ? t(
                    "Performance trace is on in this window, but the setting could not be saved. It will revert after a restart.",
                  )
                : t(
                    "Performance trace is off in this window, but the setting could not be saved. It will revert after a restart.",
                  )}
            </SettingsFeedback>
          ) : undefined
        }
      >
        <Toggle label={t("Performance trace")} on={enabled} onChange={onEnabled} />
      </Row>
      <Row
        id="performance-trace-data"
        label={t("Trace data")}
        description={t("Copy the recorded timings as JSON, or clear them.")}
        dependsOn={enabled}
        disabledReason={t("Turn on Performance trace first")}
      >
        <Text role="status" size="caption" tone="secondary" className="empty:hidden">
          {result === "cleared" ? t("Cleared") : ""}
        </Text>
        <CopyButton
          className="shrink-0"
          label={t("Copy trace")}
          text={traceJson}
          onClick={() => setResult(null)}
        />
        <Button
          className="shrink-0"
          startIcon={<Trash2 strokeWidth={1.75} aria-hidden />}
          onClick={onClear}
        >
          {t("Clear")}
        </Button>
      </Row>
      <HostStallProfilesRow />
    </Group>
  );
}
