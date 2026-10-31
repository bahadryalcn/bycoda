import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, type KeyboardEvent } from "react";
import {
  isAppConfirmAbandoned,
  markAppConfirmShown,
  registerAppConfirmHost,
  type AppConfirmRequest,
} from "../../shared/model/appConfirm";
import { useConfirm } from "../../shared/ui/ConfirmDialog";
import { restoreWindowFocus } from "../model/windowFocus";

/** A key that opened a menu item must not be able to answer the dialog it opened. */
const GUARD_MS = 350;
/** Longest wait for the window to regain focus after a native menu closes. */
const FOCUS_WAIT_MS = 400;

/** Resolves once the native menu that triggered the action is gone and the page has focus again. */
export function afterNativeMenuClose(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener("focus", onFocus);
      window.clearTimeout(timeout);
      // One more frame so the closing popup has released the window before the dialog mounts.
      requestAnimationFrame(() => resolve());
    };
    const onFocus = () => finish();
    const timeout = window.setTimeout(finish, FOCUS_WAIT_MS);
    if (document.hasFocus()) window.setTimeout(finish, 0);
    else window.addEventListener("focus", onFocus);
  });
}

async function revealWindow(): Promise<void> {
  if (!isTauri()) return;
  await restoreWindowFocus(getCurrentWindow()).catch(() => undefined);
}

/**
 * The one in-app surface for confirmations (session delete, discarding unsaved files, git, MCP, ...). It
 * renders the shared ConfirmDialog (danger action, Cancel secondary, Escape cancels, pending and retry
 * from the dialog itself) and opens it only after the menu that started the action has closed, so a
 * WebView overlay is no longer lost to a native macOS menu. Mount it once.
 */
export function AppConfirmHost() {
  const { confirm, dialog } = useConfirm();
  const openedAt = useRef(0);
  useEffect(
    () =>
      registerAppConfirmHost(async (request: AppConfirmRequest) => {
        if (request.reveal) await revealWindow();
        if (isAppConfirmAbandoned(request)) return false;
        await afterNativeMenuClose();
        // The platform dialog already took this request over: opening here would ask twice.
        if (isAppConfirmAbandoned(request)) return false;
        openedAt.current = performance.now();
        const answer = confirm({
          title: request.title,
          message: <span className="whitespace-pre-line">{request.message}</span>,
          confirmLabel: request.confirmLabel,
          danger: request.tone === "danger",
          onConfirm: request.onConfirm,
        });
        markAppConfirmShown(request);
        return answer;
      }),
    [confirm],
  );
  const guard = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.repeat || performance.now() - openedAt.current < GUARD_MS) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  return (
    <div style={{ display: "contents" }} onKeyDownCapture={guard} onKeyUpCapture={guard}>
      {dialog}
    </div>
  );
}
