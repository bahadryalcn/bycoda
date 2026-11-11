import { useSyncExternalStore } from "react";
import { t as translate } from "../i18n";

/** The bound translator from `useT()`; the module `t` is for code outside render. */
type Translate = typeof translate;

/* ================================================================================================
 * The one shortcut model and formatter. Button and Tooltip hints, DropdownMenu shortcut slots,
 * ShortcutKeys/ShortcutKbd and the Arc shortcut recorder all read shortcuts through this file.
 *
 * A canonical shortcut is a string such as "mod+shift+k". `mod` is ⌘ on Apple platforms and Ctrl
 * elsewhere, so one binding reads right everywhere. Keys come from the physical key where it
 * matters, so ⌥K records as "alt+k" instead of "˚".
 *
 * Display labels are also accepted: "Ctrl+Shift+P", "⌘⇧P", "Esc Esc" (a sequence),
 * "Shift+Enter / Shift+F3" (alternatives) and "Ctrl/Cmd+F" (Ctrl or ⌘ by platform).
 * ============================================================================================== */

export type Platform = "mac" | "other";
export interface ShortcutToken {
  /** What the key cap shows. */ label: string;
  /** Physical key id, matched against held keys. */ id: string;
  spoken: string;
}
/** Keys held together. */
export type ShortcutChord = readonly ShortcutToken[];
/** Chords pressed one after another ("Esc Esc"). */
export type ShortcutSequence = readonly ShortcutChord[];

const MODIFIER_ORDER = ["mod", "ctrl", "alt", "shift", "meta"] as const;
type Modifier = (typeof MODIFIER_ORDER)[number];
const isModifier = (part: string): part is Modifier =>
  (MODIFIER_ORDER as readonly string[]).includes(part);

const CODE_KEYS: Record<string, string> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
  Space: "space",
  Enter: "enter",
  NumpadEnter: "enter",
  Escape: "escape",
  Backspace: "backspace",
  Delete: "delete",
  Tab: "tab",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Home: "home",
  End: "end",
  PageUp: "pageup",
  PageDown: "pagedown",
};
const MODIFIER_KEYS: Record<string, string> = {
  Meta: "meta",
  OS: "meta",
  Control: "ctrl",
  Alt: "alt",
  AltGraph: "alt",
  Shift: "shift",
};

/** The physical key id for an event: "k", "1", "enter", "meta", "shift"… `null` for keys that never make a shortcut, such as Caps Lock. */
export function keyId(event: Pick<KeyboardEvent, "key" | "code">): string | null {
  const { code, key } = event;
  if (MODIFIER_KEYS[key]) return MODIFIER_KEYS[key];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return code.slice(6);
  if (CODE_KEYS[code]) return CODE_KEYS[code];
  if (/^F\d{1,2}$/.test(key)) return key.toLowerCase();
  if (
    key === "CapsLock" ||
    key === "Fn" ||
    key === "Dead" ||
    key === "Unidentified" ||
    key === "Process"
  )
    return null;
  return key.length === 1 ? key.toLowerCase() : null;
}

export function splitShortcut(shortcut: string) {
  const parts = shortcut
    .toLowerCase()
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  const key = parts.filter((part) => !isModifier(part)).pop() ?? "";
  return { mods: new Set(parts.filter(isModifier)), key };
}

const normalizeMods = (mods: Set<string>, platform: Platform) => {
  if (platform === "mac" && mods.delete("meta")) mods.add("mod");
  if (platform === "other" && mods.delete("ctrl")) mods.add("mod");
  return mods;
};

/** One spelling per combination: on a Mac, Command is `mod`; elsewhere, Ctrl is. Modifiers come in a fixed order. */
export function normalizeShortcut(shortcut: string, platform: Platform) {
  const { mods, key } = splitShortcut(shortcut);
  normalizeMods(mods, platform);
  return [...MODIFIER_ORDER.filter((mod) => mods.has(mod)), key].filter(Boolean).join("+");
}

/** Reads a keydown into a shortcut string, or `null` while only modifiers are down. */
export function shortcutFromEvent(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  platform: Platform,
) {
  const key = keyId(event);
  if (!key || ["meta", "ctrl", "alt", "shift"].includes(key)) return null;
  const mods: string[] = [];
  if (platform === "mac" ? event.metaKey : event.ctrlKey) mods.push("mod");
  if (platform === "mac" ? event.ctrlKey : false) mods.push("ctrl");
  if (event.altKey) mods.push("alt");
  if (event.shiftKey) mods.push("shift");
  if (platform === "other" && event.metaKey) mods.push("meta");
  return normalizeShortcut([...mods, key].join("+"), platform);
}

/** True when a keydown is this shortcut. Use it to run the action a recorded shortcut is bound to. */
export function matchesShortcut(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  shortcut: string,
  platform: Platform,
) {
  const pressed = shortcutFromEvent(event, platform);
  return !!pressed && pressed === normalizeShortcut(shortcut, platform);
}

const MAC_KEYS: Record<string, [string, string]> = {
  enter: ["↩", "Return"],
  backspace: ["⌫", "Delete"],
  delete: ["⌦", "Forward delete"],
  tab: ["⇥", "Tab"],
  escape: ["esc", "Escape"],
};
const SHARED_KEYS: Record<string, [string, string]> = {
  space: ["Space", "Space"],
  enter: ["Enter", "Enter"],
  escape: ["Esc", "Escape"],
  backspace: ["Backspace", "Backspace"],
  delete: ["Del", "Delete"],
  tab: ["Tab", "Tab"],
  up: ["↑", "Up arrow"],
  down: ["↓", "Down arrow"],
  left: ["←", "Left arrow"],
  right: ["→", "Right arrow"],
  home: ["Home", "Home"],
  end: ["End", "End"],
  pageup: ["PgUp", "Page up"],
  pagedown: ["PgDn", "Page down"],
  ",": [",", "Comma"],
  ".": [".", "Period"],
  "/": ["/", "Slash"],
  ";": [";", "Semicolon"],
  "'": ["'", "Quote"],
  "[": ["[", "Left bracket"],
  "]": ["]", "Right bracket"],
  "\\": ["\\", "Backslash"],
  "-": ["-", "Minus"],
  "=": ["=", "Equals"],
  "`": ["`", "Backtick"],
};

/** Caps for normalized modifiers and one key. `raw` keeps the author's spelling of an unknown key. */
function chordTokens(
  mods: ReadonlySet<string>,
  key: string,
  platform: Platform,
  t: Translate,
  raw?: string,
): ShortcutToken[] {
  const tokens: ShortcutToken[] = [];
  if (platform === "mac") {
    if (mods.has("ctrl")) tokens.push({ label: "⌃", id: "ctrl", spoken: t("Control") });
    if (mods.has("alt")) tokens.push({ label: "⌥", id: "alt", spoken: t("Option") });
    if (mods.has("shift")) tokens.push({ label: "⇧", id: "shift", spoken: t("Shift") });
    if (mods.has("mod") || mods.has("meta"))
      tokens.push({ label: "⌘", id: "meta", spoken: t("Command") });
  } else {
    if (mods.has("mod") || mods.has("ctrl"))
      tokens.push({ label: "Ctrl", id: "ctrl", spoken: t("Control") });
    if (mods.has("alt")) tokens.push({ label: "Alt", id: "alt", spoken: t("Alt") });
    if (mods.has("shift")) tokens.push({ label: "Shift", id: "shift", spoken: t("Shift") });
    if (mods.has("meta")) tokens.push({ label: "Win", id: "meta", spoken: t("Windows") });
  }
  if (key) {
    const named = (platform === "mac" ? MAC_KEYS[key] : undefined) ?? SHARED_KEYS[key];
    const label = raw && raw.length > 1 && !/^f\d{1,2}$/.test(key) ? raw : key.toUpperCase();
    tokens.push(
      named ? { label: named[0], id: key, spoken: t(named[1]) } : { label, id: key, spoken: label },
    );
  }
  return tokens;
}

/** Key caps for a canonical shortcut in platform order: ⌃ ⌥ ⇧ ⌘ on a Mac, Ctrl Alt Shift Win elsewhere. */
export function shortcutTokens(shortcut: string, platform: Platform): ShortcutToken[] {
  return shortcutTokensWith(shortcut, platform, translate);
}

/** {@link shortcutTokens} with a bound translator, safe to call during render. */
export function shortcutTokensWith(
  shortcut: string,
  platform: Platform,
  t: Translate,
): ShortcutToken[] {
  const { mods, key } = splitShortcut(normalizeShortcut(shortcut, platform));
  return chordTokens(mods, key, platform, t);
}

/** "⌘⇧K" on a Mac, "Ctrl+Shift+K" elsewhere, plus a spoken form for assistive technology. */
export function formatShortcut(shortcut: string, platform: Platform) {
  const tokens = shortcutTokens(shortcut, platform);
  return {
    text: tokens.map((token) => token.label).join(platform === "mac" ? "" : "+"),
    spoken: tokens.map((token) => token.spoken).join(" "),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Display labels
 * ---------------------------------------------------------------------------------------------- */

const MAC_GLYPH_MODS: Record<string, Modifier> = {
  "⌃": "ctrl",
  "⌥": "alt",
  "⇧": "shift",
  "⌘": "mod",
};
const PART_ALIASES: Record<string, string> = {
  control: "ctrl",
  ctl: "ctrl",
  "⌃": "ctrl",
  "ctrl/cmd": "mod",
  "cmd/ctrl": "mod",
  "ctrl/⌘": "mod",
  "⌘/ctrl": "mod",
  cmdorctrl: "mod",
  commandorcontrol: "mod",
  cmd: "mod",
  command: "mod",
  "⌘": "mod",
  win: "meta",
  windows: "meta",
  super: "meta",
  option: "alt",
  opt: "alt",
  altgr: "alt",
  "⌥": "alt",
  "⇧": "shift",
  esc: "escape",
  return: "enter",
  "↩": "enter",
  "⏎": "enter",
  del: "delete",
  "⌦": "delete",
  "⌫": "backspace",
  "⇥": "tab",
  spacebar: "space",
  arrowup: "up",
  arrowdown: "down",
  arrowleft: "left",
  arrowright: "right",
  "↑": "up",
  "↓": "down",
  "←": "left",
  "→": "right",
  pgup: "pageup",
  pgdn: "pagedown",
  plus: "+",
};

function parseChord(text: string, platform: Platform, t: Translate): ShortcutToken[] {
  const mods = new Set<string>();
  let parts: string[];
  if (text.length > 1 && text.includes("+")) {
    // "Ctrl++" names the plus key; every other "+" joins two keys.
    parts = text.split(/\+(?=.)/);
  } else {
    // "⌘⇧P": leading modifier glyphs, then the key.
    let rest = text;
    while (rest.length > 1 && MAC_GLYPH_MODS[rest[0]!]) {
      mods.add(MAC_GLYPH_MODS[rest[0]!]!);
      rest = rest.slice(1);
    }
    parts = [rest];
  }
  let key = "";
  let raw = "";
  for (const part of parts) {
    if (!part) continue;
    const lower = part.toLowerCase();
    const id = PART_ALIASES[lower] ?? lower;
    if (isModifier(id)) mods.add(id);
    else {
      key = id;
      raw = part;
    }
  }
  return chordTokens(normalizeMods(mods, platform), key, platform, t, raw);
}

/**
 * Parses a canonical shortcut or a display label into alternatives (" / "), each a sequence of
 * chords (space separated). Unknown key names keep their spelling.
 */
export function parseShortcutLabel(label: string, platform: Platform): ShortcutSequence[] {
  return parseShortcutLabelWith(label, platform, translate);
}

/** {@link parseShortcutLabel} with a bound translator, safe to call during render. */
export function parseShortcutLabelWith(
  label: string,
  platform: Platform,
  t: Translate,
): ShortcutSequence[] {
  return label
    .replace(/\s*\+\s*(?=\S)/g, "+")
    .split(/\s+\/\s+/)
    .map((alternative) =>
      alternative
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((chord) => parseChord(chord, platform, t))
        .filter((chord) => chord.length > 0),
    )
    .filter((sequence) => sequence.length > 0);
}

/** A display label in the platform's spelling: "⌘⇧K" / "Ctrl+Shift+K", sequences and alternatives kept. */
export function formatShortcutLabel(label: string, platform: Platform) {
  return formatShortcutLabelWith(label, platform, translate);
}

/** {@link formatShortcutLabel} with a bound translator, safe to call during render. */
export function formatShortcutLabelWith(label: string, platform: Platform, t: Translate) {
  const alternatives = parseShortcutLabelWith(label, platform, t);
  const join = platform === "mac" ? "" : "+";
  return {
    alternatives,
    text: alternatives
      .map((sequence) =>
        sequence.map((chord) => chord.map((token) => token.label).join(join)).join(" "),
      )
      .join(" / "),
    spoken: alternatives
      .map((sequence) =>
        sequence.map((chord) => chord.map((token) => token.spoken).join(" ")).join(", "),
      )
      .join(` ${t("or")} `),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Platform
 * ---------------------------------------------------------------------------------------------- */

const subscribe = () => () => {};
export const detectPlatform = (): Platform => {
  if (typeof navigator === "undefined") return "mac";
  const hint =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    navigator.userAgent;
  return /mac|iphone|ipad|ipod/i.test(hint) ? "mac" : "other";
};
/** The viewer's platform. Server renders assume a Mac and settle on the first client render. */
export function usePlatform(override?: Platform): Platform {
  const detected = useSyncExternalStore(subscribe, detectPlatform, () => "mac" as Platform);
  return override ?? detected;
}
