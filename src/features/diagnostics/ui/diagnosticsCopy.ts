import { t } from "../../../shared/i18n";
import type { DiagnosticSendStatus } from "../model/diagnosticsReport";

/** The one user-facing sentence for a send result, shared by every surface. */
export function diagnosticResultText(status: DiagnosticSendStatus): string {
  switch (status) {
    case "sent":
      return t("Diagnostic logs sent. Thank you.");
    case "rate-limited":
      return t("Too many reports. Wait a little and try again.");
    case "not-configured":
      return t("Sending diagnostic logs is not available in this build.");
    case "empty":
      return t("There were no logs to send.");
    case "failed":
      return t("Could not send the diagnostic logs.");
  }
}
