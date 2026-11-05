import type { ContextMenuItem } from "../../../shared/ui/ContextMenu";
import { formatShortcutLabel, usePlatform } from "../../../shared/ui/shortcut";

type Platform = ReturnType<typeof usePlatform>;

export function createEditorContextMenuItem(platform: Platform) {
  return (id: string, label: string, disabled = false, shortcut?: string): ContextMenuItem => ({
    kind: "item",
    id,
    label,
    disabled,
    shortcut: shortcut ? formatShortcutLabel(shortcut, platform).text : undefined,
  });
}
