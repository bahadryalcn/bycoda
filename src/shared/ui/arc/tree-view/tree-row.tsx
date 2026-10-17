import type { ComponentPropsWithRef, CSSProperties } from "react";
import styles from "./tree-row.module.css";

export type TreeRowProps = ComponentPropsWithRef<"button"> & {
  /** Zero-based visual depth; selection and navigation stay with the tree. */
  depth?: number;
  selected?: boolean;
  cut?: boolean;
  dropTarget?: boolean;
};

/** Native tree row presentation adapted from the free Arc tree-view item. */
export function TreeRow({
  depth = 0,
  selected,
  cut = false,
  dropTarget = false,
  className,
  style,
  role = "treeitem",
  ...props
}: TreeRowProps) {
  const level = Number.isFinite(depth) ? Math.min(64, Math.max(0, Math.floor(depth))) : 0;
  return (
    <button
      type="button"
      {...props}
      role={role}
      aria-level={props["aria-level"] ?? (role === "treeitem" ? level + 1 : undefined)}
      aria-selected={props["aria-selected"] ?? selected}
      data-tree-cut={cut || undefined}
      data-tree-drop-target={dropTarget || undefined}
      className={[styles.row, className].filter(Boolean).join(" ")}
      style={{ "--tree-row-depth": level, ...style } as CSSProperties}
    />
  );
}
