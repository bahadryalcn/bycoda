import { isTauri } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";

/**
 * One confirmation, whatever opens it. Every feature describes the decision (what, to which target, with
 * which effect) and the app renders it with the shared ConfirmDialog; no feature builds its own dialog.
 */
export type AppConfirmRequest = {
  /** Question naming the action, e.g. "Delete branch?". */
  title: string;
  /** Target and effect, plain text (line breaks are kept). It is also what the platform fallback shows. */
  message: string;
  /** The real action, e.g. "Delete branch". Cancel is always the secondary choice. */
  confirmLabel: string;
  /** `danger` only when the action destroys data or stops running work. */
  tone: "danger" | "normal";
  /** Wording for the platform fallback when it must differ from `message` (one plain sentence). */
  fallbackText?: string;
  /**
   * Raise the window before asking. For a request that did not start from this window (a paired mobile
   * device), so an approval can never wait behind a minimized or hidden window.
   */
  reveal?: boolean;
};

/** The in-app surface. `AppConfirmHost` registers one; it resolves true only when the owner confirms. */
export type AppConfirmHost = (request: AppConfirmRequest) => Promise<boolean>;

let host: AppConfirmHost | null = null;

export function registerAppConfirmHost(next: AppConfirmHost): () => void {
  host = next;
  return () => {
    if (host === next) host = null;
  };
}

/**
 * Resolves true only when the owner confirms; Escape, Cancel and closing resolve false. Without a mounted
 * host (tests, a bare component in the web preview) it falls back to the platform dialog, so a destructive
 * action still never skips asking.
 */
export function confirmInApp(request: AppConfirmRequest): Promise<boolean> {
  if (host) return host(request);
  if (isTauri()) {
    return ask(request.fallbackText ?? request.message, {
      title: request.title,
      kind: request.tone === "danger" ? "warning" : "info",
      okLabel: request.confirmLabel,
      cancelLabel: "Cancel",
    });
  }
  return Promise.resolve(
    window.confirm(request.fallbackText ?? `${request.title}\n\n${request.message}`),
  );
}
