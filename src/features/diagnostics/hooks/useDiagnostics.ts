import { useEffect } from "react";
import { tauriDiagnosticsNative } from "../model/diagnosticsNative";
import type { DiagnosticsDeps } from "../model/diagnosticsReport";
import { startDiagnostics } from "../model/diagnosticsService";
import { installUiLogBuffer } from "../model/uiLogBuffer";

/**
 * Starts the UI log buffer and the crash/periodic scheduler for this window. Inert outside the
 * desktop shell, in builds without accounts and while the consent is off.
 */
export function useDiagnostics(env: Omit<DiagnosticsDeps, "native">): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the environment functions are stable module references; the effect runs once per window.
  useEffect(() => {
    installUiLogBuffer();
    return startDiagnostics({ ...env, native: tauriDiagnosticsNative });
  }, []);
}
