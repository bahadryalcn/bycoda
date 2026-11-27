/** What a key press on a task card does. The card itself owns these keys; nested
 * controls (its buttons, the overflow menu, the failure modal) keep theirs. */
export type TaskCardKeyIntent = "open" | "earlier" | "later";

/** Maps one key press to a card intent, or null when the card leaves it alone.
 * `ownTarget` is true only when the card itself has focus, so keys pressed in a
 * button or menu inside the card never open or move it. Enter and Space open the
 * detail panel (the usual activation keys for a focusable control). Alt+Up and
 * Alt+Down run the board's existing move-earlier and move-later actions; they are
 * ignored while the board is busy, because those actions are not gated on busy. */
export function taskCardKeyIntent(input: {
  key: string;
  altKey: boolean;
  ownTarget: boolean;
  canMoveEarlier: boolean;
  canMoveLater: boolean;
  busy: boolean;
}): TaskCardKeyIntent | null {
  if (!input.ownTarget) return null;
  if (input.key === "Enter" || input.key === " ") return "open";
  if (input.altKey && !input.busy) {
    if (input.key === "ArrowUp" && input.canMoveEarlier) return "earlier";
    if (input.key === "ArrowDown" && input.canMoveLater) return "later";
  }
  return null;
}
