import { keybindingPressed, matchCustomKeybinding, type ShortcutEvent } from "./settings";
import type { LayoutPreset } from "../../workspace/model/layoutPresets";

/** Layout actions are opt-in so they do not take over editor/terminal chords. */
export const LAYOUT_SHORTCUTS: Record<string, LayoutPreset> = {
  "Pane: Arrange Columns": "columns",
  "Pane: Arrange Rows": "rows",
  "Pane: Arrange Grid": "grid",
  "Pane: Arrange Main Left": "main-left",
  "Pane: Arrange Main Top": "main-top",
  "Pane: Equalize Sizes": "equalize",
};

type AppShortcutEvent = ShortcutEvent & {
  key: string;
  isComposing: boolean;
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
];

const APP_COMMANDS = new Set(APP_SHORTCUTS.map(([command]) => command));

/**
 * Which app command a key press should run, or null. Ignores the event during
 * IME composition so a chord cannot interrupt a composition, and honours a
 * rebound or disabled shortcut through `keybindingPressed`.
 */
export function resolveAppShortcut(event: AppShortcutEvent): string | null {
  if (event.isComposing) return null;
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
