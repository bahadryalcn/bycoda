import { useRef, useState, useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Text } from "../../../shared/ui/Text";
import { TextField } from "../../../shared/ui/TextField";
import {
  getDiagnosticsMode,
  setDiagnosticsMode,
  subscribeDiagnosticsConsent,
  type DiagnosticsMode,
} from "../model/diagnosticsConsent";
import type { DiagnosticSendStatus } from "../model/diagnosticsReport";
import { sendDiagnosticLogs } from "../model/diagnosticsService";
import { diagnosticResultText } from "./diagnosticsCopy";

const NOTE_MAX = 2000;

/**
 * Off / Ask me / Send automatically for diagnostic logs, the line that says what a non-Off mode
 * does, and a manual "Send logs now" whose optional note is asked in a dialog. The retention
 * explanation belongs in the info icon of the row that hosts this control (Settings → Privacy).
 */
export function DiagnosticsSharingSetting() {
  useLocale();
  const mode = useSyncExternalStore(subscribeDiagnosticsConsent, getDiagnosticsMode);
  const { confirm, dialog } = useConfirm();
  // The dialog body is a snapshot of one render, so the typed note lives in a ref.
  const note = useRef("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DiagnosticSendStatus | null>(null);
  const send = async () => {
    note.current = "";
    const ok = await confirm({
      title: t("Send logs now"),
      message: t("Help us fix crashes by sending redacted app logs."),
      confirmLabel: t("Send logs now"),
      tone: "neutral",
      body: (
        <TextField
          label={t("What went wrong? (optional)")}
          maxLength={NOTE_MAX}
          onChange={(event) => {
            note.current = event.target.value;
          }}
        />
      ),
    });
    if (!ok) return;
    setBusy(true);
    setResult(null);
    try {
      setResult(await sendDiagnosticLogs({ trigger: "manual", note: note.current }));
    } catch {
      setResult("failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <SegmentedControl
          label={t("Share diagnostic logs")}
          value={mode}
          onValueChange={(value) => setDiagnosticsMode(value as DiagnosticsMode)}
          options={[
            { value: "off", label: t("Off") },
            { value: "ask", label: t("Ask me") },
            { value: "auto", label: t("Send automatically") },
          ]}
        />
        <Button
          variant="ghost"
          size="sm"
          loading={busy}
          onClick={() => send().catch(() => undefined)}
        >
          {t("Send logs now")}
        </Button>
      </div>
      {mode !== "off" ? (
        <Text as="p" size="caption" tone="muted">
          {mode === "auto"
            ? t("After a crash they are sent automatically, and once a week.")
            : t("After a crash you are asked whether to send them.")}
        </Text>
      ) : null}
      {result ? (
        <InlineMessage tone={result === "sent" ? "success" : "danger"}>
          {diagnosticResultText(result)}
        </InlineMessage>
      ) : null}
      {dialog}
    </div>
  );
}
