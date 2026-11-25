const NAMED_KEYS = new Set([
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "ContextMenu",
  "Pause",
  "PrintScreen",
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
]);

type KeyEventLike = {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  code?: string;
  getModifierState?: (key: "AltGraph") => boolean;
};

export function browserModifiers(
  event: Pick<KeyEventLike, "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
) {
  return [
    event.ctrlKey ? "Control" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    event.metaKey ? "Meta" : "",
  ].filter(Boolean);
}

/**
 * The Host browser key action for a key press, or undefined when the press is plain
 * text (sent through the text path) or paste (sent as text from the paste event, so
 * the Host's own clipboard is never typed into the page).
 */
export function browserKeyInput(event: KeyEventLike) {
  const modifiers = browserModifiers(event);
  const key = event.key === " " ? "Space" : event.key;
  if (NAMED_KEYS.has(key)) return { kind: "key", key, modifiers };
  if (event.getModifierState?.("AltGraph") || !(event.ctrlKey || event.metaKey || event.altKey))
    return undefined;
  if (key.toLowerCase() === "v" && (event.ctrlKey || event.metaKey) && !event.altKey)
    return undefined;
  if (/^[a-z0-9]$/i.test(key)) return { kind: "key", key: key.toUpperCase(), modifiers };
  if (event.code && SHORTCUT_CODES.has(event.code))
    return { kind: "key", key: event.code, modifiers };
  return undefined;
}

const SHORTCUT_CODES = new Set([
  "Backquote",
  "Minus",
  "Equal",
  "BracketLeft",
  "BracketRight",
  "Backslash",
  "Semicolon",
  "Quote",
  "Comma",
  "Period",
  "Slash",
]);
