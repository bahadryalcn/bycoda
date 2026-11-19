import { keybindingPressed, matchCustomKeybinding, type ShortcutEvent } from "./settings";
import { isImeComposition } from "../../../shared/lib/keyboard";
import type { LayoutPreset } from "../../workspace";
import type { FocusDir } from "../../workspace/model/layout";
import type { SettingsSectionId } from "./settings";

/** Optional direct destinations, available to record without taking existing chords. */
export const SETTINGS_SHORTCUTS: Record<string, SettingsSectionId> = {
  "Settings: General": "general",
  "Settings: Providers": "providers",
  "Settings: Connections": "connections",
  "Settings: Appearance": "appearance",
  "Settings: Workspace": "workspace",
  "Settings: Terminal": "terminal",
  "Settings: Keybindings": "keybindings",
  "Settings: Notifications": "notifications",
  "Settings: Inbox": "inbox",
};

/** Layout actions are opt-in so they do not take over editor/terminal chords. */
export const LAYOUT_SHORTCUTS: Record<string, LayoutPreset> = {
  "Pane: Arrange Columns": "columns",
  "Pane: Arrange Rows": "rows",
  "Pane: Arrange Grid": "grid",
  "Pane: Arrange Main Left": "main-left",
  "Pane: Arrange Main Top": "main-top",
  "Pane: Equalize Sizes": "equalize",
};

/** Keyboard route to docking a pane beside its neighbour, the same move the pointer drag makes. */
export const PANE_MOVE_COMMANDS: Record<string, { dir: FocusDir; key: string }> = {
  "Pane: Move Left": { dir: "left", key: "ArrowLeft" },
  "Pane: Move Right": { dir: "right", key: "ArrowRight" },
  "Pane: Move Up": { dir: "up", key: "ArrowUp" },
  "Pane: Move Down": { dir: "down", key: "ArrowDown" },
};

/** The pane move direction a key press requests, or null. */
export function paneMoveDirection(event: ShortcutEvent & { key: string }): FocusDir | null {
  const modified = (event.metaKey || event.ctrlKey) && event.altKey && event.shiftKey;
  for (const [command, { dir, key }] of Object.entries(PANE_MOVE_COMMANDS)) {
    if (keybindingPressed(command, event, modified && event.key === key)) return dir;
  }
  return null;
}

type AppShortcutEvent = ShortcutEvent & {
  key: string;
  isComposing: boolean;
  keyCode: number;
};

/** command, key, and whether Shift must be held. */
const APP_SHORTCUTS: [string, string, boolean][] = [
  ["App: New Window", "n", true],
  ["App: Open Project", "o", false],
  ["App: Toggle Sidebar", "b", false],
  ["App: Toggle Session Sidebar", "b", true],
  ["App: Go to File", "p", false],
  ["App: Command Palette", "p", true],
  ["View: Reload", "r", true],
  ["App: Search", "k", false],
  ["App: Settings", ",", false],
  ["App: Find in Files", "f", true],
  ["App: Open Inbox", "i", true],
  ["App: Open Notes", "l", true],
  ["App: Open Tasks", "y", true],
  ["App: Open Automations", "u", true],
  ["App: Open Crews", "e", true],
  ["App: Focus Approval Requests", "j", true],
];

const APP_COMMANDS = new Set([
  ...APP_SHORTCUTS.map(([command]) => command),
  ...Object.keys(SETTINGS_SHORTCUTS),
]);

/**
 * Which app command a key press should run, or null. Ignores the event during
 * IME composition so a chord cannot interrupt a composition, and honours a
 * rebound or disabled shortcut through `keybindingPressed`.
 */
export function resolveAppShortcut(event: AppShortcutEvent): string | null {
  if (isImeComposition(event)) return null;
  // A rebound chord is resolved before the default table, otherwise recording
  // a new combination could never fire, and it may legitimately be Alt-only.
  const custom = matchCustomKeybinding(event);
  if (custom && APP_COMMANDS.has(custom))
    return keybindingPressed(custom, event, false) ? custom : null;
  if (!event.metaKey && !event.ctrlKey) return null;
  if (event.altKey) return null;
  const key = event.key.toLowerCase();
  for (const [command, expected, shift] of APP_SHORTCUTS) {
    if (key !== expected || event.shiftKey !== shift) continue;
    return keybindingPressed(command, event, true) ? command : null;
  }
  return null;
}
