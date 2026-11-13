import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Renders children into an existing DOM element; descendants keep React state and context.
 * Adds no overlay, focus trap, Escape handling or stacking.
 * @status internal
 * @group overlay
 * @use Internal placement into an existing DOM target while preserving React state.
 * @avoid A floating popup with positioning and dismissal: Popover.
 */
export function Portal({ children, target }: { children: ReactNode; target: Element }) {
  return createPortal(children, target);
}
