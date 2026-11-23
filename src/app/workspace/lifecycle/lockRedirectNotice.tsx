import { toast } from "../../../shared/ui/ToastRegion";

const LOCK_REDIRECT_NOTICE_MS = 12_000;

/** Tell the person why the window left a project. */
export function showLockRedirectNotice(message: string): void {
  if (typeof document === "undefined") return;
  toast.show({ tone: "warning", message, durationMs: LOCK_REDIRECT_NOTICE_MS });
}
