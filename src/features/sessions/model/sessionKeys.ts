export const STOP_TURN_COMMAND = "Session: Stop Turn";

/** Two Escape presses closer together than this count as Esc Esc. */
export const DOUBLE_ESCAPE_MS = 800;

type KeyInput = {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
};

/** Bare Escape: the built-in default for stopping, as in Claude Code. */
export function isDefaultStopChord(event: KeyInput): boolean {
  return (
    event.key === "Escape" && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey
  );
}

/**
 * Ctrl+C (Control, never Command) also interrupts a running turn, as in
 * Claude Code. Only offered with no text selected so copying still works.
 */
export function isInterruptChord(
  event: KeyInput & { code?: string },
  hasSelection: boolean,
): boolean {
  return (
    !hasSelection &&
    event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    (event.code === "KeyC" || event.key.toLowerCase() === "c")
  );
}

export type ComposerEscapeAction = "exit-edit" | "arm" | "recall";

/**
 * What a bare Escape does in an idle composer once its popups are closed:
 * leave edit-last-message mode, or on an empty composer arm a second press
 * that recalls the last message for editing (Claude Code's Esc Esc).
 */
export function composerEscapeAction(input: {
  editingLastTurn: boolean;
  empty: boolean;
  canRecall: boolean;
  armedAt: number | null;
  now: number;
}): ComposerEscapeAction | null {
  if (input.editingLastTurn) return "exit-edit";
  if (!input.empty || !input.canRecall) return null;
  return input.armedAt !== null && input.now - input.armedAt <= DOUBLE_ESCAPE_MS ? "recall" : "arm";
}
