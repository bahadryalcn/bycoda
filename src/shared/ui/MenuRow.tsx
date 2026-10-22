import { ContextMenuRow, contextMenuRowClassName } from "./arc/context-menu/context-menu";
import type { ComponentProps } from "react";
export const menuRowClassName = contextMenuRowClassName;
export type MenuRowProps = ComponentProps<typeof ContextMenuRow>;
/** Shared row presentation for existing domain/native nested-menu controllers. */
export function MenuRow({ className, ...props }: MenuRowProps) {
  return (
    <ContextMenuRow {...props} className={["bycoda-arc", className].filter(Boolean).join(" ")} />
  );
}
