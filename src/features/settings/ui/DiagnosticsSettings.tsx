import { useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { getPerformanceTrace, clearPerformanceTrace } from "../../../shared/lib/performanceTrace";
import {
  loadPerformanceTraceEnabled,
  savePerformanceTraceEnabled,
} from "../../../shared/lib/performanceTraceSettings";
import { copyText } from "../../../platform/tauri/clipboard";
import { Button } from "../../../shared/ui/Button";
import { Group, Row, Toggle } from "./settingsControls";

/** Timings only: the copied JSON holds stage names, times, durations and counters. */
export function DiagnosticsGroup() {
  useLocale();
  const [enabled, setEnabled] = useState(loadPerformanceTraceEnabled);
  const [copied, setCopied] = useState(false);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    if (!copied && !cleared) return;
    const timer = window.setTimeout(() => {
      setCopied(false);
      setCleared(false);
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [copied, cleared]);

  const onEnabled = (next: boolean) => {
    savePerformanceTraceEnabled(next);
    setEnabled(next);
  };

  const onCopy = async () => {
    const payload = { version: 1, exportedAt: new Date().toISOString(), records: getPerformanceTrace() };
    await copyText(JSON.stringify(payload, null, 2));
    setCopied(true);
  };

  const onClear = () => {
    clearPerformanceTrace();
    setCleared(true);
  };

  return (
    <Group title={t("Diagnostics")} layout="full">
      <Row
        id="performance-trace"
        label={t("Performance trace")}
        description={t(
          "Record startup timing, rendering stalls and long main-thread tasks. Only durations are kept, never message text, paths or script names.",
        )}
      >
        <Toggle label={t("Performance trace")} on={enabled} onChange={onEnabled} />
      </Row>
      <Row
        id="performance-trace-data"
        label={t("Trace data")}
        description={t("Copy the recorded timings as JSON, or clear them.")}
      >
        <span role="status" className="text-ui-caption text-(--ui-text-secondary)">
          {copied ? t("Copied") : cleared ? t("Cleared") : ""}
        </span>
        <Button className="shrink-0" onClick={onCopy}>
          {t("Copy trace")}
        </Button>
        <Button className="shrink-0" onClick={onClear}>
          {t("Clear")}
        </Button>
      </Row>
    </Group>
  );
}
