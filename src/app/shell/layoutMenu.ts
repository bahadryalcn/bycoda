import type { ExplorerMenuItem } from "../../features/files/ui/ExplorerMenu";
import {
  LAYOUT_PRESETS,
  suggestedPaneCount,
  type LayoutPreset,
} from "../../features/workspace/model/layoutPresets";

export const LAYOUT_NEEDS_SPLIT_HINT =
  "Split a pane first (Ctrl+D) or drop a session onto a pane edge";

const PRESET_PREFIX = "layout:";

export const SPLIT_RIGHT_ID = "split-right";
export const SPLIT_DOWN_ID = "split-down";

export function layoutPresetMenuId(preset: LayoutPreset): string {
  return `${PRESET_PREFIX}${preset}`;
}

/** The preset a menu id stands for, or null for any other id. */
export function layoutPresetFromMenuId(id: string): LayoutPreset | null {
  if (!id.startsWith(PRESET_PREFIX)) return null;
  const preset = id.slice(PRESET_PREFIX.length);
  return LAYOUT_PRESETS.some((entry) => entry.id === preset) ? (preset as LayoutPreset) : null;
}

export type LayoutMenuOptions = {
  /** Preset the active tab currently matches, if any. */
  current: LayoutPreset | null;
  /** The active tab has two or more panes to arrange. */
  canArrange: boolean;
  /** Include "Split Right" / "Split Down" entries. */
  withSplits?: boolean;
  splitRightShortcut?: string;
  splitDownShortcut?: string;
  /** Show descriptions under the presets (roomy menus only). */
  withDescriptions?: boolean;
};

/** Items of the Layout menu, shared by the title bar and the menu bar. */
export function buildLayoutMenuItems({
  current,
  canArrange,
  withSplits = true,
  splitRightShortcut,
  splitDownShortcut,
  withDescriptions = false,
}: LayoutMenuOptions): ExplorerMenuItem[] {
  const items: ExplorerMenuItem[] = [];
  if (withSplits) {
    items.push(
      {
        kind: "item",
        id: SPLIT_RIGHT_ID,
        label: "Split Right",
        shortcut: splitRightShortcut,
      },
      {
        kind: "item",
        id: SPLIT_DOWN_ID,
        label: "Split Down",
        shortcut: splitDownShortcut,
      },
      { kind: "sep" },
    );
  }
  for (const preset of LAYOUT_PRESETS) {
    items.push({
      kind: "item",
      id: layoutPresetMenuId(preset.id),
      label: preset.label,
      description: withDescriptions
        ? canArrange
          ? preset.description
          : `Create ${suggestedPaneCount(preset.id)} panes, keeping the current session`
        : undefined,
      checked: canArrange && current === preset.id,
      disabled: !canArrange && preset.id === "equalize",
      title: canArrange
        ? preset.description
        : preset.id === "equalize"
          ? LAYOUT_NEEDS_SPLIT_HINT
          : `Create ${suggestedPaneCount(preset.id)} panes, keeping the current session`,
    });
  }
  return items;
}
