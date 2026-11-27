import { IS_MAC } from "../../../platform/tauri/platform";
import {
  keyId,
  normalizeShortcut,
  splitShortcut,
  type Platform,
} from "../../../shared/ui/shortcut";

/** The same spelling is accepted by tauri-plugin-global-shortcut. */
export const QUICK_COMPOSER_DEFAULT_SHORTCUT = IS_MAC
  ? "Command+Shift+Space"
  : "Control+Shift+Space";

type Modifiers = Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

const SYMBOLS: Record<string, string> = {
  Escape: "Esc",
  Space: "Space",
  Backquote: "`",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Equal: "=",
  Minus: "-",
  Period: ".",
  Quote: "'",
  Semicolon: ";",
  Slash: "/",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "Return",
  NumpadEnter: "Return",
  Tab: "Tab",
  Backspace: "Delete",
  Delete: "Delete Forward",
  Home: "Home",
  End: "End",
  PageUp: "Page Up",
  PageDown: "Page Down",
};

function supportedCode(code: string): boolean {
  return (
    /^Key[A-Z]$/.test(code) ||
    /^Digit[0-9]$/.test(code) ||
    /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code) ||
    Object.prototype.hasOwnProperty.call(SYMBOLS, code)
  );
}

const PRIMARY_MODIFIERS = ["Command", "Control", "Option"];

/** Any chord with at least one of Command, Control or Option. */
export function isShortcut(value: string): boolean {
  const parts = value.split("+");
  const code = parts.pop();
  if (!code || !supportedCode(code)) return false;
  if (!parts.some((part) => PRIMARY_MODIFIERS.includes(part))) return false;
  return (
    parts.length > 0 &&
    parts.length <= 4 &&
    new Set(parts).size === parts.length &&
    parts.every((part) => ["Command", "Control", "Option", "Shift"].includes(part))
  );
}

/** An OS-wide hotkey must keep a Command or Control modifier. */
export function isGlobalShortcut(value: string): boolean {
  return (
    isShortcut(value) &&
    value
      .split("+")
      .slice(0, -1)
      .some((part) => ["Command", "Control"].includes(part))
  );
}

const MODIFIER_ORDER = ["Command", "Control", "Option", "Shift"] as const;

/** Normalises modifier order so a stored chord always matches what a key press produces. */
export function canonicalShortcut(value: string): string | null {
  if (!isShortcut(value)) return null;
  const parts = value.split("+");
  const code = parts.pop() as string;
  return [...MODIFIER_ORDER.filter((part) => parts.includes(part)), code].join("+");
}

export function shortcutFromKeyEvent(
  event: Pick<KeyboardEvent, "code"> & Modifiers,
): string | null {
  if (!supportedCode(event.code)) return null;
  const modifiers = [
    event.metaKey && "Command",
    event.ctrlKey && "Control",
    event.altKey && "Option",
    event.shiftKey && "Shift",
  ].filter(Boolean);
  if (!event.metaKey && !event.ctrlKey && !event.altKey) return null;
  return [...modifiers, event.code].join("+");
}

const RECORDER_MODIFIERS: Record<string, string> = {
  Command: "meta",
  Control: "ctrl",
  Option: "alt",
  Shift: "shift",
};

/** A stored chord (`Control+KeyK`) in the shared recorder's spelling (`mod+k`), or null when it has none. */
export function recorderShortcutFromStored(value: string, platform: Platform): string | null {
  const parts = value.split("+");
  const code = parts.pop();
  const key = code && supportedCode(code) ? keyId({ code, key: code }) : null;
  const mods = parts.map((part) => RECORDER_MODIFIERS[part]);
  if (!key || mods.some((mod) => !mod)) return null;
  return normalizeShortcut([...mods, key].join("+"), platform);
}

function codeForRecorderKey(key: string): string | null {
  if (/^[a-z]$/.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  if (/^f\d{1,2}$/.test(key)) return supportedCode(key.toUpperCase()) ? key.toUpperCase() : null;
  return Object.keys(SYMBOLS).find((code) => keyId({ code, key: code }) === key) ?? null;
}

/**
 * A chord the shared recorder produced (`mod+k`) in the stored spelling (`Control+KeyK`), or null when it has no stored form
 * (no Command, Control or Option, or a key the stored form does not support).
 * shortcut: a numpad digit is stored as its top-row digit, since the stored form has no numpad codes.
 */
export function storedShortcutFromRecorder(value: string, platform: Platform): string | null {
  const { mods, key } = splitShortcut(normalizeShortcut(value, platform));
  const code = codeForRecorderKey(key);
  if (!code) return null;
  const mac = platform === "mac";
  const modifiers = [
    (mac ? mods.has("mod") : mods.has("meta")) && "Command",
    (mac ? mods.has("ctrl") : mods.has("mod")) && "Control",
    mods.has("alt") && "Option",
    mods.has("shift") && "Shift",
  ].filter(Boolean);
  return canonicalShortcut([...modifiers, code].join("+"));
}

function codeLabel(code: string): string {
  return code.startsWith("Key")
    ? code.slice(3)
    : code.startsWith("Digit")
      ? code.slice(5)
      : (SYMBOLS[code] ?? code);
}

export function quickComposerShortcutPreview(
  modifiers: Modifiers,
  code?: string,
  key?: string,
): string {
  const prefix = [
    modifiers.metaKey && (IS_MAC ? "⌘" : "Win+"),
    modifiers.ctrlKey && (IS_MAC ? "⌃" : "Ctrl+"),
    modifiers.altKey && (IS_MAC ? "⌥" : "Alt+"),
    modifiers.shiftKey && (IS_MAC ? "⇧" : "Shift+"),
  ]
    .filter(Boolean)
    .join("");
  if (!code) return prefix;
  const displayedKey = supportedCode(code)
    ? codeLabel(code)
    : key && key !== "Unidentified"
      ? key.length === 1
        ? key.toUpperCase()
        : key
      : "";
  return prefix + displayedKey;
}

/** `aria-keyshortcuts` token form: Meta/Control/Alt/Shift plus a bare key. */
export function shortcutTokens(value: string): string {
  return value
    .split("+")
    .map((part) => {
      if (part === "Command") return "Meta";
      if (part === "Option") return "Alt";
      if (part.startsWith("Key")) return part.slice(3);
      if (part.startsWith("Digit")) return part.slice(5);
      return part;
    })
    .join("+");
}

export function quickComposerShortcutLabel(value: string): string {
  const parts = value.split("+");
  const code = parts.pop() ?? "Space";
  const modifiers = IS_MAC
    ? { Command: "⌘", Control: "⌃", Option: "⌥", Shift: "⇧" }
    : { Command: "Win+", Control: "Ctrl+", Option: "Alt+", Shift: "Shift+" };
  return (
    parts.map((part) => modifiers[part as "Command" | "Control" | "Option" | "Shift"]).join("") +
    codeLabel(code)
  );
}
