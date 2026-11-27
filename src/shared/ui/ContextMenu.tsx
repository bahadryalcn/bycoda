import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { NativeContextMenu, type ContextMenuProps } from "./arc/context-menu/native-context-menu";
export type { ContextMenuItem, ContextMenuProps } from "./arc/context-menu/native-context-menu";
/**
 * Point or anchor menu opened by right-click, the context-menu key or an InlineMoreAction.
 * Shares Popover's floating frame. Owns submenus, keyboard focus and dismissal; items are
 * `ContextMenuItem` data and rows render through MenuRow.
 * @group overlay
 * @use Secondary actions of a row, file, tab or editor selection at a pointer or anchor position.
 * @avoid Menu opened from a visible button: DropdownMenu. Choosing a value: Select. Panel with controls: Popover.
 * @arc context-menu
 */
export function ContextMenu(props: ContextMenuProps) {
  return <NativeContextMenu {...props} />;
}

export type ContextMenuActions = Pick<ContextMenuProps, "items" | "onPick" | "ariaLabel">;

/** Use on an existing focusable surface or its container, without a separate menu button. */
export function usePointContextMenu(actions?: ContextMenuActions) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const close = () => setPoint(null);
  const openAt = (element: HTMLElement) => {
    const bounds = element.getBoundingClientRect();
    setPoint({ x: bounds.left, y: bounds.bottom });
  };
  return {
    openAt,
    trigger: actions && {
      onContextMenu: (event: MouseEvent<HTMLElement>) => {
        if (event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        setPoint({ x: event.clientX, y: event.clientY });
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (
          event.defaultPrevented ||
          !(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        openAt(event.target as HTMLElement);
      },
    },
    menu:
      actions && point ? (
        <ContextMenu
          {...point}
          {...actions}
          onPick={(id) => {
            close();
            actions.onPick(id);
          }}
          onClose={close}
        />
      ) : null,
  };
}
