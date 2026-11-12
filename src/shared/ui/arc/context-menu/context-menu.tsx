"use client";

import { MenuRow } from "../../MenuRow";

import { Popover, popupListClassName } from "../../Popover";
import { useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Check, Copy, Trash2 } from "../../icons";
import styles from "./context-menu.module.css";

/** Arc presentation for menus positioned by the application's overlay stack. */
export const contextMenuRowClassName = styles.item;
/** Destructive tone for a row that uses `contextMenuRowClassName` directly. */
export const contextMenuDestructiveClassName = styles.destructive;
/**
 * Slot classes shared by every menu path (DropdownMenu, point/anchor ContextMenu, MenuRow
 * consumers, standalone Arc ContextMenu): leading icon, copy column with an optional
 * description line, and the trailing shortcut / check / submenu chevron.
 */
export const contextMenuSlotClassName = {
  icon: styles.icon,
  copy: styles.copy,
  label: styles.label,
  description: styles.description,
  trailing: styles.trailing,
  shortcut: styles.shortcut,
  separator: styles.separator,
  heading: styles.heading,
  header: styles.header,
} as const;
/** Compatibility alias for existing Arc consumers; MenuRow owns presentation. */
export const ContextMenuRow = MenuRow;

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  checked?: boolean;
}

export interface ContextMenuProps {
  children: ReactNode;
  items: ContextMenuItem[];
  label?: string;
}

/** Standalone Arc menu; the same Popover and row primitive used by shared command menus. */
export function ContextMenu({ children, items, label = "Context menu" }: ContextMenuProps) {
  const [open, setOpen] = useState(false);
  const [point, setPoint] = useState({ x: 0, y: 0, key: 0 });
  const menuRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const pressedWhileOpen = useRef(false);
  const hasIcons = items.some((item) => item.icon != null);

  function showMenu(x: number, y: number) {
    setPoint((current) => ({ x, y, key: current.key + 1 }));
    setOpen(true);
  }

  function showAtTarget() {
    const rect = targetRef.current?.getBoundingClientRect();
    if (rect) showMenu(rect.left + 12, rect.bottom + 8);
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const enabled = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        'button[role^="menuitem"]:not(:disabled)',
      ),
    ];
    const at = enabled.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | undefined;
    if (event.key === "ArrowDown") next = (at + 1) % enabled.length;
    if (event.key === "ArrowUp") next = (at - 1 + enabled.length) % enabled.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = enabled.length - 1;
    if (next !== undefined && enabled.length) {
      event.preventDefault();
      enabled[next]?.focus({ preventScroll: true });
    }
  }

  return (
    <>
      <div
        ref={targetRef}
        className={styles.target}
        tabIndex={0}
        onPointerDown={(event) => {
          pressedWhileOpen.current = open && event.button === 0;
        }}
        onClick={() => {
          if (pressedWhileOpen.current) {
            pressedWhileOpen.current = false;
            return;
          }
          if (open) setOpen(false);
          else showAtTarget();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          showMenu(event.clientX, event.clientY);
        }}
        onKeyDown={(event) => {
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault();
            showAtTarget();
          }
        }}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {children}
      </div>
      {open && (
        <Popover
          key={point.key}
          ref={menuRef}
          anchor={point}
          gap={0}
          minWidth={208}
          maxHeight={300}
          autoFocus
          className={`bycoda-arc ${popupListClassName} ${styles.menu}`}
          role="menu"
          aria-label={label}
          tabIndex={-1}
          onDismiss={(reason) => {
            setOpen(false);
            if (reason === "escape") targetRef.current?.focus({ preventScroll: true });
          }}
          onKeyDown={onMenuKeyDown}
          onFocus={(event) => {
            if (event.target === event.currentTarget)
              event.currentTarget
                .querySelector<HTMLElement>('button[role^="menuitem"]:not(:disabled)')
                ?.focus({ preventScroll: true });
          }}
        >
          {items.map((item) => (
            <ContextMenuRow
              key={item.id}
              type="button"
              role={item.checked == null ? "menuitem" : "menuitemcheckbox"}
              aria-checked={item.checked}
              tabIndex={-1}
              disabled={item.disabled}
              destructive={item.destructive}
              onPointerMove={(event) => {
                if (!item.disabled) event.currentTarget.focus({ preventScroll: true });
              }}
              onClick={() => {
                item.onSelect?.();
                setOpen(false);
                targetRef.current?.focus({ preventScroll: true });
              }}
            >
              {hasIcons && (
                <span className={styles.icon} aria-hidden="true">
                  {item.icon}
                </span>
              )}
              <span className={styles.copy}>{item.label}</span>
              {item.checked != null && (
                <span className={styles.trailing} aria-hidden="true">
                  {item.checked ? <Check /> : null}
                </span>
              )}
            </ContextMenuRow>
          ))}
        </Popover>
      )}
    </>
  );
}

export const contextMenuExampleItems: ContextMenuItem[] = [
  { id: "copy", label: "Copy link", icon: <Copy size={15} /> },
  { id: "delete", label: "Delete project", icon: <Trash2 size={15} />, destructive: true },
];

export default ContextMenu;
