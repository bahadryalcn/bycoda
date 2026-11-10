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
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
]);

type KeyEventLike = {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
};

/**
 * The Host browser key action for a key press, or undefined when the press is plain
 * text (sent through the text path) or paste (sent as text from the paste event, so
 * the Host's own clipboard is never typed into the page).
 */
export function browserKeyInput(event: KeyEventLike) {
  const modifiers = [
    event.ctrlKey ? "Control" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    event.metaKey ? "Meta" : "",
  ].filter(Boolean);
  if (NAMED_KEYS.has(event.key)) return { kind: "key", key: event.key, modifiers };
  const shortcut = (event.ctrlKey || event.metaKey) && /^[a-z0-9]$/i.test(event.key);
  if (!shortcut || event.key.toLowerCase() === "v") return undefined;
  return { kind: "key", key: event.key.toUpperCase(), modifiers };
}
