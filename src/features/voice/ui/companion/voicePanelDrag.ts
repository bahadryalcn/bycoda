import type { PointerEvent as ReactPointerEvent } from "react";

/** Pointer travel before a press on the header turns into a move; keeps clicks and double-clicks intact. */
export const DRAG_THRESHOLD = 4;

const INTERACTIVE =
  'button, a, input, select, textarea, summary, label, [role="button"], [role="menuitem"], [role="slider"], [contenteditable="true"], [data-no-drag]';

/**
 * Whether a press on `target` inside the header may start a move. Controls keep their own
 * behavior; the move handle itself stays a drag source although it is a button.
 */
export function startsHeaderDrag(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const control = target.closest(INTERACTIVE);
  return !control || control.hasAttribute("data-drag-handle");
}

export function pastDragThreshold(dx: number, dy: number) {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD;
}

export type HeaderDragEvent = ReactPointerEvent<HTMLElement>;
