import { ContextMenuRow, contextMenuRowClassName } from "./arc/context-menu/context-menu";
import type { ComponentProps } from "react";
export const menuRowClassName = contextMenuRowClassName;
export type MenuRowProps = ComponentProps<typeof ContextMenuRow>;
/**
 * Menu row presentation only (icon, label, shortcut, chevron, active state); owns no open state, focus or keyboard handling.
 * `menuRowClassName` gives the same look to rows you render yourself.
 * @group overlay
 * @use Rows of an existing domain-owned or native nested menu controller that cannot use DropdownMenu.
 * @avoid New menus: DropdownMenu (trigger) or ContextMenu (right-click); they own focus, typeahead and submenus.
 * @arc context-menu
 */
export function MenuRow({ className, ...props }: MenuRowProps) {
  return (
    <ContextMenuRow {...props} className={["bycoda-arc", className].filter(Boolean).join(" ")} />
  );
}
