import { useEffect } from "react";
import { tauriDiagnosticsNative } from "../model/diagnosticsNative";
import type { DiagnosticsDeps } from "../model/diagnosticsReport";
import { startDiagnostics } from "../model/diagnosticsService";
import { installUiLogBuffer, setUiLogSink } from "../model/uiLogBuffer";
import { createUiLogFile } from "../model/uiLogFile";

/**
 * Starts the UI log buffer and the crash/periodic scheduler for this window; in the desktop
 * shell UI warnings and errors are also written to the local log file. Reporting is inert
 * outside the desktop shell, in builds without accounts and while the consent is off.
 */
export function useDiagnostics(env: Omit<DiagnosticsDeps, "native">): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the environment functions are stable module references; the effect runs once per window.
  useEffect(() => {
    installUiLogBuffer();
    const { available, writeUiLog } = tauriDiagnosticsNative;
    if (available && writeUiLog) setUiLogSink(createUiLogFile(writeUiLog));
    return startDiagnostics({ ...env, native: tauriDiagnosticsNative });
  }, []);
}
