import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/** Compose into an existing surface slot without adding overlay or focus behavior. */
export function Portal({ children, target }: { children: ReactNode; target: Element }) {
  return createPortal(children, target);
}
