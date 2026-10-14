import { invoke } from "@tauri-apps/api/core";
import { parseWindowTransfer, type WindowTransferPayload } from "./windowTransfer";

let transferPromise: Promise<WindowTransferPayload | null> | null = null;

/** One take per webview — safe under React StrictMode double-mount. */
export function loadWindowTransfer(): Promise<WindowTransferPayload | null> {
  if (!transferPromise) {
    transferPromise = invoke<string | null>("take_window_transfer")
      .catch(() => null)
      .then((raw) => (raw ? parseWindowTransfer(raw) : null));
  }
  return transferPromise;
}
