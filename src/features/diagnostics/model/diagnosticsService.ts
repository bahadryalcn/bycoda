import {
  sendDiagnosticReport,
  type DiagnosticRequest,
  type DiagnosticSendStatus,
  type DiagnosticsDeps,
} from "./diagnosticsReport";
import {
  createDiagnosticsScheduler,
  type DiagnosticsScheduler,
  type PendingCrash,
} from "./diagnosticsScheduler";

let deps: DiagnosticsDeps | null = null;
let scheduler: DiagnosticsScheduler | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/**
 * Wires the account platform in and returns the stop function of the scheduler it starts. The
 * app layer calls it once per window; this feature never imports `features/account`, and the
 * account feature reaches this one only through its index.
 */
export function startDiagnostics(next: DiagnosticsDeps): () => void {
  deps = next;
  const own = createDiagnosticsScheduler(next);
  scheduler = own;
  const unsubscribe = own.subscribe(notify);
  const stop = own.start();
  notify();
  return () => {
    stop();
    unsubscribe();
    if (scheduler === own) {
      scheduler = null;
      deps = null;
      notify();
    }
  };
}

export function subscribeDiagnostics(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getPendingCrash = (): PendingCrash | null => scheduler?.getPending() ?? null;
export const sendPendingCrash = async (always = false): Promise<DiagnosticSendStatus> =>
  (await scheduler?.sendPending(always)) ?? "not-configured";
export const dismissPendingCrash = async (): Promise<void> => scheduler?.dismissPending();

/** Uploads a report now (manual button, feedback tick). Consent is the user's click. */
export async function sendDiagnosticLogs(
  request: DiagnosticRequest,
): Promise<DiagnosticSendStatus> {
  return deps ? sendDiagnosticReport(deps, request) : "not-configured";
}
