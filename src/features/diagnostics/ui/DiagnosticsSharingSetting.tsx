import { DIAGNOSTIC_RETENTION_DAYS } from "@bycoda/account-contracts";
import { useState, useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
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
 * Off / Ask me / Send automatically for diagnostic logs, what is in them, and a manual
 * "Send logs now". Rendered in Account → Privacy & data and Settings → Privacy.
 */
export function DiagnosticsSharingSetting() {
  useLocale();
  const mode = useSyncExternalStore(subscribeDiagnosticsConsent, getDiagnosticsMode);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DiagnosticSendStatus | null>(null);
  const send = async () => {
    setBusy(true);
    setResult(null);
    try {
      const status = await sendDiagnosticLogs({ trigger: "manual", note });
      setResult(status);
      if (status === "sent") setNote("");
    } catch {
      setResult("failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
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
      <p className="text-ui-caption text-muted">
        {t(
          "Diagnostic logs are the app and Host logs, with secrets, e-mail addresses and your user name removed on this computer. They never include your conversations, prompts or code. They are kept {p0} days.",
          { p0: DIAGNOSTIC_RETENTION_DAYS },
        )}{" "}
        {mode === "auto"
          ? t("After a crash they are sent automatically, and once a week.")
          : mode === "ask"
            ? t("After a crash you are asked whether to send them.")
            : t("Nothing is sent unless you choose Send logs now.")}
      </p>
      <TextField
        label={t("What went wrong? (optional)")}
        value={note}
        maxLength={NOTE_MAX}
        onChange={(event) => setNote(event.target.value)}
      />
      <div>
        <Button variant="secondary" loading={busy} onClick={() => send().catch(() => undefined)}>
          {t("Send logs now")}
        </Button>
      </div>
      {result ? (
        <InlineMessage tone={result === "sent" ? "success" : "danger"}>
          {diagnosticResultText(result)}
        </InlineMessage>
      ) : null}
    </div>
  );
}
