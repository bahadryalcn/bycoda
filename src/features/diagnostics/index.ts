export { useDiagnostics } from "./hooks/useDiagnostics";
export { CrashReportNotice } from "./ui/CrashReportNotice";
export { DiagnosticsSharingSetting } from "./ui/DiagnosticsSharingSetting";
export { diagnosticResultText } from "./ui/diagnosticsCopy";
export { recordHostConnection, recordNavigation, traceHostRpc } from "./model/breadcrumbs";
export type { EnvironmentFacts } from "./model/diagnosticsEnvironment";
export { sendDiagnosticLogs } from "./model/diagnosticsService";
export {
  getDiagnosticsMode,
  setDiagnosticsMode,
  subscribeDiagnosticsConsent,
  type DiagnosticsMode,
} from "./model/diagnosticsConsent";
export type {
  DiagnosticSendStatus,
  DiagnosticsDeps,
  DiagnosticsIdentity,
} from "./model/diagnosticsReport";
