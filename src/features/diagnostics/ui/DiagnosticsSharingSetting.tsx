import { useRef, useState, useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
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
 * Diagnostic sharing modes and their help, plus manual report review with an optional note.
 * The retention explanation belongs in the info icon of the host row (Settings → Privacy).
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
      confirmLabel: t("Review report"),
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
        {mode !== "off" ? (
          <InfoPopover label={t("Share diagnostic logs")}>
            <Text as="p" size="caption" tone="secondary">
              {mode === "auto"
                ? t("Review a crash report or weekly logs before they are sent automatically.")
                : t("Every report requires approval.")}
            </Text>
          </InfoPopover>
        ) : null}
        <SegmentedControl
          label={t("Share diagnostic logs")}
          value={mode}
          onValueChange={(value) => setDiagnosticsMode(value as DiagnosticsMode)}
          options={[
            { value: "off", label: t("Do not send") },
            { value: "ask", label: t("Ask every time") },
            { value: "auto", label: t("Send every time") },
          ]}
        />
        <Button
          variant="ghost"
          size="sm"
          loading={busy}
          disabled={mode === "off"}
          disabledReason={t("Choose a diagnostic sharing mode to review a report.")}
          onClick={() => send().catch(() => undefined)}
        >
          {t("Send logs now")}
        </Button>
      </div>
      {result ? (
        <InlineMessage
          tone={result === "sent" ? "success" : result === "declined" ? "info" : "danger"}
        >
          {diagnosticResultText(result)}
        </InlineMessage>
      ) : null}
      {dialog}
    </div>
  );
}
