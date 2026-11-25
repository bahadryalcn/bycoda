import type { Terminal } from "@xterm/xterm";
import { IS_MAC } from "../../../platform/tauri/platform";
import { isImeComposition } from "../../../shared/lib/keyboard";
import { withTimeout } from "../../../shared/lib/withTimeout";
import {
  isMacOptionText,
  isMacTerminalClearShortcut,
  macTerminalShortcutData,
} from "../model/terminalKeys";

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
  const document = host.ownerDocument;
  const view = document.defaultView;
  let pasteRequest = 0;
  const cancelClipboardPaste = () => {
    pasteRequest += 1;
  };
  const pasteFromClipboard = async () => {
    if (!view || term.options.disableStdin) return;
    const request = ++pasteRequest;
    let text: string;
    try {
      // Read from the local WebView, even when the PTY is connected over SSH.
      text = await withTimeout(view.navigator.clipboard.readText(), 1500, "Clipboard read");
    } catch {
      // Clipboard access may be denied by the WebView or OS.
      return;
    }
    if (
      text &&
      request === pasteRequest &&
      host.contains(document.activeElement) &&
      !term.options.disableStdin
    )
      term.paste(text);
  };

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
  const onContextMenu = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 2 ||
      event.shiftKey ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      term.options.disableStdin ||
      term.modes.mouseTrackingMode !== "none"
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    term.focus();
    void pasteFromClipboard().catch(() => undefined);
  };
  host.addEventListener("copy", onCopy);
  host.addEventListener("paste", onPaste);
  // Intercept before xterm moves its hidden textarea to the native menu position.
  host.addEventListener("contextmenu", onContextMenu, true);
  host.addEventListener("focusout", cancelClipboardPaste);
  view?.addEventListener("blur", cancelClipboardPaste);

  term.attachCustomKeyEventHandler((event) => {
    const composing = isImeComposition(event);
    if (IS_MAC && event.type === "keydown") {
      // xterm reads this option immediately after the custom handler returns.
      term.options.macOptionIsMeta =
        !composing && event.altKey && !event.metaKey && !isMacOptionText(event);
    }
    if (composing) return true;
    if (
      event.key === "Insert" &&
      event.shiftKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      if (event.type === "keydown") {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) void pasteFromClipboard().catch(() => undefined);
      }
      return false;
    }
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

  const onCompositionStart = () => {
    cancelClipboardPaste();
    options.onCompositionStart();
  };
  host.addEventListener("compositionstart", onCompositionStart);
  host.addEventListener("compositionend", options.onCompositionEnd);

  return {
    dispose() {
      cancelClipboardPaste();
      host.removeEventListener("copy", onCopy);
      host.removeEventListener("paste", onPaste);
      host.removeEventListener("contextmenu", onContextMenu, true);
      host.removeEventListener("focusout", cancelClipboardPaste);
      view?.removeEventListener("blur", cancelClipboardPaste);
      host.removeEventListener("compositionstart", onCompositionStart);
      host.removeEventListener("compositionend", options.onCompositionEnd);
    },
  };
}
