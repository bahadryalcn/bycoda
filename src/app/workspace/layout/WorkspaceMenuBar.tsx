import type { ComponentProps } from "react";
import { MenuBar } from "../../shell/MenuBar";

type MenuBarProps = ComponentProps<typeof MenuBar>;

export interface WorkspaceMenuBarProps extends Omit<MenuBarProps, "onCloseCurrentTab"> {
  activeTabId: string | null | undefined;
  onCloseCurrentTab: NonNullable<MenuBarProps["onCloseCurrentTab"]>;
}

/** Non-Mac application menu bar; the caller keeps the `!IS_MAC` gate. */
export function WorkspaceMenuBar({
  activeTabId,
  onCloseCurrentTab,
  ...props
}: WorkspaceMenuBarProps) {
  return (
    <MenuBar
      {...props}
      onCloseCurrentTab={activeTabId ? onCloseCurrentTab : undefined}
    />
  );
}
