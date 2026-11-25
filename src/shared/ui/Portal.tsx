import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
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

/** Places one connected portal host in its home or outlet without remounting children. */
export function useMovablePortalHost(outlet?: HTMLElement) {
  const home = useRef<HTMLDivElement | null>(null);
  const [host, setHost] = useState<HTMLDivElement>();
  const [attachHome] = useState(() => (element: HTMLDivElement | null) => {
    if (!element) return;
    const target = document.createElement("div");
    target.className = "contents";
    element.append(target);
    home.current = element;
    setHost(target);
    return () => target.remove();
  });
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Reparents the connected portal host when its outlet changes.
  useLayoutEffect(() => {
    const parent = outlet ?? home.current;
    if (!host || !parent || parent === host.parentElement) return;
    if (host.isConnected && parent.isConnected && typeof parent.moveBefore === "function") {
      parent.moveBefore(host, null);
      return;
    }
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && host.contains(active) ? active : undefined;
    const scrolled = [host, ...host.querySelectorAll("*")].flatMap((element) =>
      element.scrollTop || element.scrollLeft
        ? [{ element, top: element.scrollTop, left: element.scrollLeft }]
        : [],
    );
    parent.append(host);
    focused?.focus({ preventScroll: true });
    for (const { element, top, left } of scrolled) {
      element.scrollTop = top;
      element.scrollLeft = left;
    }
  }, [host, outlet]);
  return { attachHome, host };
}
