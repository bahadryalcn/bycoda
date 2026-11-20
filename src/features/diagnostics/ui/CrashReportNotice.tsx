import { useState, useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
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
  // -- The outcome belongs to the crash it was produced for; a later crash starts with the question again.
  const [outcome, setOutcome] = useState<{
    crash: NonNullable<typeof pending>;
    status: DiagnosticSendStatus;
  } | null>(null);
  if (!pending) return null; // -- Sending clears the crash toast; no second success toast.
  const result = outcome?.crash === pending ? outcome.status : null;
  const send = async (always: boolean) => {
    setBusy(true);
    try {
      setOutcome({ crash: pending, status: await sendPendingCrash(always) });
    } catch {
      setOutcome({ crash: pending, status: "failed" }); // -- the marker stays, so Send can be tried again.
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
      actions={[
        { label: t("Send"), pending: busy, onClick: () => void send(false).catch(() => undefined) },
        {
          label: t("Always send"),
          disabled: busy,
          onClick: () => void send(true).catch(() => undefined),
        },
        {
          label: t("Don't send"),
          disabled: busy,
          onClick: () => void dismissPendingCrash().catch(() => undefined),
        },
      ]}
      onDismiss={() => void dismissPendingCrash().catch(() => undefined)}
      dismissDisabled={busy}
    />
  );
}
