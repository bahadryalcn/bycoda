import type { ReactNode } from "react";
import { LAYER } from "../../lib/layers";
import type { PopoverAlign, PopoverSide } from "../../lib/popover";
import { Popover, type PopoverAnchor, type PopoverDismissReason } from "../Popover";
import styles from "./picker.module.css";

export type PickerPopoverProps = {
  open: boolean;
  /** The trigger. An element (or ref) also receives focus back after Escape. */
  anchor: PopoverAnchor;
  /** Outside press or Escape. The owner closes (sets `open` false). */
  onDismiss: (reason: PopoverDismissReason) => void;
  /** Accessible name of the popover surface. */
  label: string;
  /** `dialog` (default) when a search field or footer sits beside the list; `listbox` hosts are the list itself. */
  role?: "dialog" | "presentation";
  id?: string;
  side?: PopoverSide;
  align?: PopoverAlign;
  gap?: number;
  /** Defaults to 288px, the common picker width. */
  width?: number;
  /** Defaults to 360px; the list scrolls inside, header and footer stay. */
  maxHeight?: number;
  minHeight?: number;
  /** Defaults to the dialog popover layer inside a dialog, otherwise the popover layer. */
  layer?: number;
  /** Return focus to the anchor element after Escape. Defaults to true. */
  restoreFocus?: boolean;
  /** A pointer landing inside anything matching this selector is not outside. */
  ignore?: string;
  /** Rows above the list: PopoverSearchHeader, a caption with a shortcut. */
  header?: ReactNode;
  /** PickerFooter actions or a note below the list. */
  footer?: ReactNode;
  /** Usually one PickerList. */
  children: ReactNode;
  className?: string;
  [data: `data-${string}`]: string | undefined;
};

function anchorNode(anchor: PopoverAnchor): HTMLElement | null {
  if (!anchor) return null;
  if (anchor instanceof HTMLElement) return anchor;
  return "current" in anchor && anchor.current instanceof HTMLElement ? anchor.current : null;
}

/**
 * The popover frame of a picker: shared Popover placement, layering and dismissal, a fixed header and
 * footer around one scrolling list. Selection, query and open state stay with the owner.
 */
export function PickerPopover({
  open,
  anchor,
  onDismiss,
  label,
  role = "dialog",
  id,
  side = "bottom",
  align = "start",
  gap = 4,
  width = 288,
  maxHeight = 360,
  minHeight,
  layer,
  restoreFocus = true,
  ignore,
  header,
  footer,
  children,
  className,
  ...data
}: PickerPopoverProps) {
  if (!open) return null;
  const node = anchorNode(anchor);
  const resolvedLayer =
    layer ?? (node?.closest('[role="dialog"]') ? LAYER.dialogPopover : LAYER.popover);
  return (
    <Popover
      {...data}
      id={id}
      anchor={anchor}
      side={side}
      align={align}
      gap={gap}
      width={width}
      maxHeight={maxHeight}
      minHeight={minHeight}
      constrainHeight
      layer={resolvedLayer}
      ignore={ignore}
      restoreFocus={restoreFocus}
      role={role}
      aria-label={role === "dialog" ? label : undefined}
      data-dialog-popover={role === "dialog" ? "" : undefined}
      data-picker-popover=""
      onDismiss={(reason) => {
        onDismiss(reason);
        if (reason === "escape" && restoreFocus) node?.focus({ preventScroll: true });
      }}
      className={["bycoda-arc bycoda-arc-menu", styles.popover, className].filter(Boolean).join(" ")}
    >
      {header}
      <div className={styles.popoverBody}>{children}</div>
      {footer}
    </Popover>
  );
}
