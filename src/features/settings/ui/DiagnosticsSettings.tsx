import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { getPerformanceTrace, clearPerformanceTrace } from "../../../shared/lib/performanceTrace";
import {
  PERFORMANCE_TRACE_KEY,
  applyPerformanceTraceEnabled,
  loadPerformanceTraceEnabled,
  savePerformanceTraceEnabled,
} from "../../../shared/lib/performanceTraceSettings";
import { copyText } from "../../../platform/tauri/clipboard";
import { Button } from "../../../shared/ui/Button";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Group, Row, Toggle, SettingsFeedback } from "./settingsControls";

/**
 * Page-level "Restore defaults": the trace goes back to off. The mounted group follows through
 * the same storage event sibling windows use.
 */
export function restorePerformanceTraceDefault() {
  savePerformanceTraceEnabled(false);
  window.dispatchEvent(new StorageEvent("storage", { key: PERFORMANCE_TRACE_KEY, storageArea: localStorage }));
}

/** Timings only: the copied JSON holds stage names, times, durations and counters. */
export function DiagnosticsGroup() {
  useLocale();
  const [enabled, setEnabled] = useState(loadPerformanceTraceEnabled);
  /** Set when the last toggle took effect in this window but could not be stored. */
  const [unsaved, setUnsaved] = useState(false);
  // One operation result at a time: Copy and Clear replace each other's message.
  const [result, setResult] = useState<"copied" | "cleared" | null>(null);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copyPending = useRef(false);

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

  const onCopy = async () => {
    if (copyPending.current) return;
    copyPending.current = true;
    setCopying(true);
    setResult(null);
    setError(null);
    try {
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        records: getPerformanceTrace(),
      };
      await copyText(JSON.stringify(payload, null, 2));
      setResult("copied");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      copyPending.current = false;
      setCopying(false);
    }
  };

  const onClear = () => {
    clearPerformanceTrace();
    setError(null);
    setResult("cleared");
  };

  return (
    <Group title={t("Diagnostics")}>
      <Row
        id="performance-trace"
        label={t("Performance trace")}
        description={t("Record startup timing, rendering stalls and long main-thread tasks.")}
        info={
          <InfoPopover className="shrink-0">
            <p>{t("Only durations are kept, never message text, paths or script names.")}</p>
          </InfoPopover>
        }
        feedback={
          unsaved ? (
            <SettingsFeedback
              state="warning"
              action={
                <Button size="sm" onClick={() => onEnabled(enabled)}>
                  {t("Retry saving")}
                </Button>
              }
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
        feedback={error ? <SettingsFeedback state="error">{error}</SettingsFeedback> : undefined}
      >
        <span role="status" className="text-ui-caption text-(--ui-text-secondary) empty:hidden">
          {result === "copied" ? t("Copied") : result === "cleared" ? t("Cleared") : ""}
        </span>
        <Button className="shrink-0" onClick={onCopy} loading={copying}>
          {t("Copy trace")}
        </Button>
        <Button className="shrink-0" onClick={onClear} disabled={copying}>
          {t("Clear")}
        </Button>
      </Row>
    </Group>
  );
}
