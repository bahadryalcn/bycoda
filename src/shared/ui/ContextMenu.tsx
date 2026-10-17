import { NativeContextMenu, type ContextMenuProps } from "./arc/context-menu/native-context-menu";
export type { ContextMenuItem, ContextMenuProps } from "./arc/context-menu/native-context-menu";
/** Shared point/anchor menu; retains existing native popup, submenu and focus ownership. */
export function ContextMenu(props: ContextMenuProps) {
  return <NativeContextMenu {...props} />;
}
