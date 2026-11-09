import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Renders children into an existing DOM element; descendants keep React state and context.
 * Adds no overlay, focus trap, Escape handling or stacking.
 * @status internal
 */
export function Portal({ children, target }: { children: ReactNode; target: Element }) {
  return createPortal(children, target);
}
