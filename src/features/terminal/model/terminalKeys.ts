type TerminalKeyEvent = Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">;

export function terminalToolShortcut(
  event: TerminalKeyEvent,
  suggestionsAllowed = true,
): "search" | "command" | null {
  if (event.altKey || event.shiftKey || (event.ctrlKey && event.metaKey)) return null;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") return "search";
  if (suggestionsAllowed && event.ctrlKey && !event.metaKey && event.key === " ") return "command";
  return null;
}

/**
 * Plain Ctrl+letter is shell input (^W delete word, ^D EOF, ^P/^N history, ...),
 * so a focused terminal owns it ahead of the app's default chords. Shift, Alt and
 * Meta combinations, Ctrl+Tab, Ctrl+digits and punctuation stay with the app.
 * `code` covers non-Latin layouts, where `key` is not an ASCII letter.
 */
export function isTerminalControlKey(
  event: TerminalKeyEvent & Partial<Pick<KeyboardEvent, "code">>,
): boolean {
  return (
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    (/^Key[A-Z]$/.test(event.code ?? "") || /^[a-z]$/i.test(event.key))
  );
}

/** Translate macOS editing shortcuts into sequences understood by common shells. */
export function macTerminalShortcutData(event: TerminalKeyEvent): string | null {
  if (event.ctrlKey || event.shiftKey) return null;

  if (event.altKey && !event.metaKey) {
    if (event.key === "ArrowLeft") return "\x1bb";
    if (event.key === "ArrowRight") return "\x1bf";
    return null;
  }

  if (event.metaKey && !event.altKey) {
    if (event.key === "ArrowLeft") return "\x01";
    if (event.key === "ArrowRight") return "\x05";
    if (event.key === "Backspace") return "\x15";
  }

  return null;
}

/**
 * Whether a key press is the macOS Cmd+K clear. It only reaches the terminal
 * when "App: Search" is disabled or rebound, since the app claims it first.
 */
export function isMacTerminalClearShortcut(event: TerminalKeyEvent): boolean {
  return (
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "k"
  );
}

/**
 * Printable text or a single backspace: input that edits the prompt line in
 * place. Control input (Enter, Tab, arrows, Ctrl chords, multiline paste)
 * may submit or navigate, so suggestion surfaces must not survive it.
 */
export function isTerminalTextEdit(data: string): boolean {
  // oxlint-disable-next-line no-control-regex -- classify transient input without storing or logging it
  return data === "\x7f" || data === "\b" || !/[\x00-\x1f\x7f]/.test(data);
}
