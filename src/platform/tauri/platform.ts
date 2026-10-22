export const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

// Case-sensitive: "Darwin" must not read as Windows ("Win32", "Win64").
export const IS_WIN = typeof navigator !== "undefined" && navigator.platform.startsWith("Win");

export const IS_LINUX = typeof navigator !== "undefined" && /Linux/i.test(navigator.platform);

/** Native desktop blur on macOS/Windows; transparency-only glass on Linux. */
export const HAS_NATIVE_GLASS = IS_MAC || IS_WIN || IS_LINUX;

export const MOD = IS_MAC ? "⌘" : "Ctrl+";
export const ALT = IS_MAC ? "⌥" : "Alt+";
export const SHIFT = IS_MAC ? "⇧" : "Shift+";

export const FULLSCREEN_SHORTCUT = IS_MAC ? "⌃⌘F" : "F11";

export function isFullscreenShortcut(
  event: {
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
  },
  isMac = IS_MAC,
): boolean {
  if (event.altKey || event.shiftKey) return false;
  return isMac
    ? event.key.toLowerCase() === "f" && event.ctrlKey && event.metaKey
    : event.key === "F11" && !event.ctrlKey && !event.metaKey;
}
