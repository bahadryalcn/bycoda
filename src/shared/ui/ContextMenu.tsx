import { NativeContextMenu, type ContextMenuProps } from "./arc/context-menu/native-context-menu";
export type { ContextMenuItem, ContextMenuProps } from "./arc/context-menu/native-context-menu";
/**
 * Point or anchor menu opened by right-click, the context-menu key or an InlineMoreAction. Owns the native popup, submenus, keyboard focus and dismissal; items are `ContextMenuItem` data and rows render through MenuRow.
 * @group overlay
 * @use Secondary actions of a row, file, tab or editor selection at a pointer or anchor position.
 * @avoid Menu opened from a visible button: DropdownMenu. Choosing a value: Select. Panel with controls: Popover.
 * @arc context-menu
 */
export function ContextMenu(props: ContextMenuProps) {
  return <NativeContextMenu {...props} />;
}
