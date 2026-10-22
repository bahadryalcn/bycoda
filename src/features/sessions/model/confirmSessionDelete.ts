import { isTauri } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";

/** WebView confirmations can be swallowed by macOS menu/context-menu actions. */
export function confirmSessionDelete(message: string): Promise<boolean> {
  if (isTauri()) {
    return ask(message, {
      title: "Delete conversations",
      kind: "warning",
      okLabel: "Delete",
      cancelLabel: "Cancel",
    });
  }
  return Promise.resolve(window.confirm(message));
}
