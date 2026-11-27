// React Native defines `navigator` without `platform`; the mobile app reaches this through shared path helpers.
const platformName =
  typeof navigator !== "undefined" && typeof navigator.platform === "string"
    ? navigator.platform
    : "";

export const IS_MAC = /Mac|iPhone|iPad/.test(platformName);

// Case-sensitive: "Darwin" must not read as Windows ("Win32", "Win64").
export const IS_WIN = platformName.startsWith("Win");

export const IS_LINUX = /Linux/i.test(platformName);

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
