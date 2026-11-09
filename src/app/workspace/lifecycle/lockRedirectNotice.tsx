import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { TransientNotice } from "../../../shared/ui/TransientNotice";

const LOCK_REDIRECT_NOTICE_MS = 12_000;

/** Tell the person why the window left a project; the notice mounts on its own, outside the workspace tree. */
export function showLockRedirectNotice(message: string): void {
  if (typeof document === "undefined") return;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const close = () =>
    queueMicrotask(() => {
      root.unmount();
      host.remove();
    });
  root.render(
    createElement(TransientNotice, {
      tone: "warning",
      message,
      durationMs: LOCK_REDIRECT_NOTICE_MS,
      onDismiss: close,
    }),
  );
}
