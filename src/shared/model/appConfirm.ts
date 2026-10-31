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
  /**
   * Optional async work run when the owner confirms. In the in-app dialog it stays open with both buttons
   * disabled while the work runs, shows a rejection with the confirming button live for a retry, and the
   * request resolves true only after the work succeeded. The platform fallback has no place to show a
   * retry: it runs the work once after a yes and lets a rejection reach the caller.
   */
  onConfirm?: () => void | Promise<void>;
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

/** Longest wait for the in-app dialog to appear before the platform dialog asks instead. */
export const CONFIRM_SHOW_TIMEOUT_MS = 15_000;
const shownListeners = new WeakMap<AppConfirmRequest, Set<() => void>>();
/** Requests the platform dialog took over; the in-app host must not open them late. */
const abandoned = new WeakSet<AppConfirmRequest>();

/** The host checks this after each await: an abandoned request is already answered elsewhere. */
export function isAppConfirmAbandoned(request: AppConfirmRequest): boolean {
  return abandoned.has(request);
}

/** The host calls this once its dialog is on screen, which ends the appear-timeout. */
export function markAppConfirmShown(request: AppConfirmRequest): void {
  const listeners = shownListeners.get(request);
  shownListeners.delete(request);
  listeners?.forEach((listener) => listener());
}

async function platformAnswer(request: AppConfirmRequest): Promise<boolean> {
  const confirmed = await platformConfirm(request);
  if (confirmed) await request.onConfirm?.();
  return confirmed;
}

/**
 * Resolves true only when the owner confirms; Escape, Cancel and closing resolve false. Without a mounted
 * host (tests, a bare component in the web preview) it falls back to the platform dialog, so a destructive
 * action still never skips asking. A host whose dialog never appears is replaced by the platform dialog
 * after 15 seconds, so an approval cannot hang forever.
 */
export function confirmInApp(request: AppConfirmRequest): Promise<boolean> {
  if (!host) return platformAnswer(request);
  const inApp = host;
  abandoned.delete(request);
  return new Promise<boolean>((resolve, reject) => {
    let settled = false;
    const listeners = shownListeners.get(request) ?? new Set<() => void>();
    shownListeners.set(request, listeners);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      abandoned.add(request);
      shownListeners.delete(request);
      console.warn("[confirm] in-app dialog did not appear; asking with the platform dialog");
      platformAnswer(request).then(resolve, reject);
    }, CONFIRM_SHOW_TIMEOUT_MS);
    const shown = () => clearTimeout(timer);
    listeners.add(shown);
    inApp(request).then(
      (answer) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolve(answer);
      },
      (error: unknown) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(error);
      },
    );
  });
}

/** The native dialog, bypassing the in-app host. For decisions that must not depend on page state. */
export function platformConfirm(request: AppConfirmRequest): Promise<boolean> {
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
