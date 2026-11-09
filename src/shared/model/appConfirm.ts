/**
 * One confirmation, whatever opens it. Every feature describes the decision (what, to which target, with
 * which effect) and the app renders it with the shared ConfirmDialog; no feature builds its own dialog.
 */
export type AppConfirmRequest = {
  /** Question naming the action, e.g. "Delete branch?". */
  title: string;
  /** Target and effect, plain text (line breaks are kept). */
  message: string;
  /** The real action, e.g. "Delete branch". Cancel is always the secondary choice. */
  confirmLabel: string;
  /** `danger` only when the action destroys data or stops running work. */
  tone: "danger" | "normal";
  /** Legacy alternative wording retained for callers. */
  fallbackText?: string;
  /**
   * Raise the window before asking. For a request that did not start from this window (a paired mobile
   * device), so an approval can never wait behind a minimized or hidden window.
   */
  reveal?: boolean;
  /**
   * Optional async work run when the owner confirms. In the in-app dialog it stays open with both buttons
   * disabled while the work runs, shows a rejection with the confirming button live for a retry, and the
   * request resolves true only after the work succeeded.
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

/** Longest wait for the in-app dialog to appear before denying an unavailable application surface. */
export const CONFIRM_SHOW_TIMEOUT_MS = 15_000;
const shownListeners = new WeakMap<AppConfirmRequest, Set<() => void>>();
/** Expired requests must never open late. */
const abandoned = new WeakSet<AppConfirmRequest>();

/** The host checks this after each await: an abandoned request was already denied. */
export function isAppConfirmAbandoned(request: AppConfirmRequest): boolean {
  return abandoned.has(request);
}

/** The host calls this once its dialog is on screen, which ends the appear-timeout. */
export function markAppConfirmShown(request: AppConfirmRequest): void {
  const listeners = shownListeners.get(request);
  shownListeners.delete(request);
  listeners?.forEach((listener) => listener());
}

/** Application-only confirmation. Missing or unresponsive UI denies the request. */
export function confirmInApp(request: AppConfirmRequest): Promise<boolean> {
  if (!host) return Promise.resolve(false);
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
      resolve(false);
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

/** Compatibility name for lifecycle callers; all confirmations stay in the application. */
export const platformConfirm = confirmInApp;
