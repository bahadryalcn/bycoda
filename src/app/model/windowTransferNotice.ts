import { t } from "../../shared/i18n";

export type WindowTransferNoticeTone = "info" | "danger";

export type WindowTransferNotice = {
  /** Grows with every publication so an identical sentence still restarts the notice. */
  id: number;
  tone: WindowTransferNoticeTone;
  message: string;
};

let latest: WindowTransferNotice | null = null;
let counter = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/**
 * Shows one notice for a cross-window transfer that is waiting, was refused, was cancelled or was
 * rolled back. The rendered notice (role alert/status) is what assistive technology announces. The normal success path
 * never publishes: the tab simply arrives. The protocol itself is untouched.
 */
export function publishWindowTransferNotice(tone: WindowTransferNoticeTone, message: string) {
  counter += 1;
  latest = { id: counter, tone, message };
  emit();
}

export function dismissWindowTransferNotice() {
  if (!latest) return;
  latest = null;
  emit();
}

export function getWindowTransferNotice(): WindowTransferNotice | null {
  return latest;
}

export function subscribeWindowTransferNotice(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** A rejection reason for display; the protocol keeps the raw `String(error)`. */
export function transferFailureReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return raw.replace(/^(?:\w*Error:\s*)+/, "").trim();
}

export function queuedTransferMessage(): string {
  return t("This tab moves to a new window when the response finishes.");
}

export function cancelledTransferMessage(): string {
  return t("The move to a new window was cancelled.");
}

export function rejectedTransferMessage(error: unknown): string {
  const reason = transferFailureReason(error);
  if (!reason)
    return t("The tab could not be placed in this window. It stays in its original window.");
  const sentence = /[.!?]$/.test(reason) ? reason : `${reason}.`;
  return t("The tab could not be placed in this window. {p0} It stays in its original window.", {
    p0: sentence,
  });
}

export function restoredSplitMessage(): string {
  return t("The pane went back to its original split.");
}
