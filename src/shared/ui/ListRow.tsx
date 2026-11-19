import type { ComponentPropsWithRef, ReactNode } from "react";
import styles from "./ListRow.module.css";

/** Class of the one row skin, for a row element a controller must render itself (virtualized, drag, tree). */
export const listRowClassName = styles.row;
/** Slot classes of the row skin: leading `icon` (16), `check` (14) and `trailing` (shortcut, count, chevron). */
export const listRowSlotClassName = {
  icon: styles.icon,
  check: styles.check,
  trailing: styles.trailing,
};

export type ListRowProps = ComponentPropsWithRef<"button"> & {
  /** `sm` dense 28 (default: options, results, tree-like lists); `md` menu 32. */
  size?: "sm" | "md";
  /** Committed selection fill. Option and tree rows still pass `aria-selected` themselves. */
  selected?: boolean;
  /** Keyboard-active row (`aria-activedescendant`); paints like hover. On `role="option"` it also sets `aria-selected` unless passed. */
  active?: boolean;
  /** Destructive item: danger text. */
  danger?: boolean;
  /** Leading glyph in the 16px slot. */
  icon?: ReactNode;
  /** Shortcut, count or chevron in the end slot. */
  trailing?: ReactNode;
};

/**
 * The one row skin for a single-action list row: 28px dense or 32px menu height, row radius, secondary text, 16px leading
 * icon, trailing slot, hover / keyboard-active / selected / pressed fills and danger text. Menu items, select and picker
 * options and tree rows use the same recipe; this component is the plain button form of it. It owns no focus, selection or
 * typeahead; the list controller passes `role`, `aria-selected`, `id` and handlers.
 * @group data
 * @use A selectable or clickable row in a listbox, result list or recent list; `role="option"` rows of a controller that keeps focus in an input (replaces Button variant="item" there).
 * @avoid Rows with inline actions: ActionHost. Hierarchy: TreeRow. Command menus: DropdownMenu or ContextMenu. Sections: Disclosure.
 */
export function ListRow({
  size = "sm",
  selected,
  active,
  danger,
  icon,
  trailing,
  className,
  children,
  type = "button",
  ...props
}: ListRowProps) {
  return (
    <button
      type={type}
      {...props}
      aria-selected={props["aria-selected"] ?? (props.role === "option" ? !!active : undefined)}
      data-selected={selected ? "true" : undefined}
      data-active={active ? "true" : undefined}
      data-danger={danger ? "true" : undefined}
      data-row-size={size}
      className={[styles.row, size === "md" && styles.menu, className].filter(Boolean).join(" ")}
    >
      {icon != null ? (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
      {trailing != null ? <span className={styles.trailing}>{trailing}</span> : null}
    </button>
  );
}
