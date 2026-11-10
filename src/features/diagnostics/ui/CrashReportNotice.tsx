import { useState, useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Toast } from "../../../shared/ui/ToastRegion";
import type { DiagnosticSendStatus } from "../model/diagnosticsReport";
import {
  dismissPendingCrash,
  getPendingCrash,
  sendPendingCrash,
  subscribeDiagnostics,
} from "../model/diagnosticsService";
import { diagnosticResultText } from "./diagnosticsCopy";

/**
 * Asks, once per crash, whether to send diagnostic logs. Only shown in mode "ask" (or never
 * decided); automatic mode sends silently and off discards the marker.
 */
export function CrashReportNotice() {
  useLocale();
  const pending = useSyncExternalStore(subscribeDiagnostics, getPendingCrash);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DiagnosticSendStatus | null>(null);
  if (!pending && result !== "sent") return null;
  if (!pending) {
    return (
      <Toast
        tone="success"
        message={diagnosticResultText("sent")}
        durationMs={4000}
        onDismiss={() => setResult(null)}
      />
    );
  }
  const send = async (always: boolean) => {
    setBusy(true);
    try {
      setResult(await sendPendingCrash(always));
    } catch {
      setResult("failed"); // -- the marker stays, so Send can be tried again.
    } finally {
      setBusy(false);
    }
  };
  const failed = result !== null && result !== "sent";
  return (
    <Toast
      tone={failed ? "danger" : "info"}
      title={t("bycoda closed unexpectedly")}
      message={
        failed
          ? diagnosticResultText(result)
          : t(
              "Send diagnostic logs to help us fix it? They are redacted on this computer and never include your conversations.",
            )
      }
      durationMs={null}
      width="lg"
      actionsPlacement="footer"
      actions={
        <>
          <Button
            variant="secondary"
            loading={busy}
            onClick={() => send(false).catch(() => undefined)}
          >
            {t("Send")}
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => send(true).catch(() => undefined)}
          >
            {t("Always send")}
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void dismissPendingCrash().catch(() => undefined)}
          >
            {t("Don't send")}
          </Button>
        </>
      }
      onDismiss={() => void dismissPendingCrash().catch(() => undefined)}
      dismissDisabled={busy}
    />
  );
}
