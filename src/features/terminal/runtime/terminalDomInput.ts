import type { Terminal } from "@xterm/xterm";
import { IS_MAC } from "../../../platform/tauri/platform";
import { isMacTerminalClearShortcut, macTerminalShortcutData } from "../model/terminalKeys";

/**
 * Clipboard, IME composition and key shortcut handling between the DOM and xterm.
 * Input still reaches the PTY only through xterm's `onData`.
 */
export function bindTerminalDomInput(options: {
  term: Terminal;
  host: HTMLElement;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
}) {
  const { term, host } = options;

  const onCopy = (event: ClipboardEvent) => {
    const text = term.getSelection();
    if (!text) return;
    event.clipboardData?.setData("text/plain", text);
    event.preventDefault();
  };
  const onPaste = (event: ClipboardEvent) => {
    const text = event.clipboardData?.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    term.paste(text);
  };
  host.addEventListener("copy", onCopy);
  host.addEventListener("paste", onPaste);

  term.attachCustomKeyEventHandler((event) => {
    const shortcutData = IS_MAC ? macTerminalShortcutData(event) : null;
    if (shortcutData) {
      if (event.type === "keydown") {
        event.preventDefault();
        event.stopPropagation();
        term.input(shortcutData);
      }
      return false;
    }
    if (IS_MAC && isMacTerminalClearShortcut(event)) {
      if (event.isComposing) return false;
      if (event.type === "keydown") {
        event.preventDefault();
        term.clear();
      }
      return false;
    }

    const mod = event.metaKey || event.ctrlKey;
    if (!mod || event.altKey) return true;
    const key = event.key.toLowerCase();
    if (key === "c") {
      if (term.hasSelection()) return false;
      if (event.metaKey && !event.ctrlKey) return false;
      return true;
    }
    if (key === "v") return false;
    return true;
  });

  host.addEventListener("compositionstart", options.onCompositionStart);
  host.addEventListener("compositionend", options.onCompositionEnd);

  return {
    dispose() {
      host.removeEventListener("copy", onCopy);
      host.removeEventListener("paste", onPaste);
      host.removeEventListener("compositionstart", options.onCompositionStart);
      host.removeEventListener("compositionend", options.onCompositionEnd);
    },
  };
}
