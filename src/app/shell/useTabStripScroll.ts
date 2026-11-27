import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useStableCallback } from "../../shared/hooks/useStableCallback";
import { observeResize } from "../../shared/lib/observeResize";

/** Which tab-strip edges still have overflow to scroll toward. */
export function tabStripOverflow(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
): { left: boolean; right: boolean } {
  const maxScroll = scrollWidth - clientWidth;
  if (maxScroll <= 1) return { left: false, right: false };
  return {
    left: scrollLeft > 1,
    right: scrollLeft < maxScroll - 1,
  };
}

/**
 * Overflow indicators, chevron scrolling and keep-active-tab-visible behavior for
 * the title-bar tab strip. The strip element itself stays owned by the caller.
 */
export function useTabStripScroll({
  tabStripRef,
  activeId,
  tabCount,
  dragging,
}: {
  tabStripRef: RefObject<HTMLDivElement | null>;
  activeId: string;
  /** Number of tab slots at their full width (including closing slots until removed). */
  tabCount: number;
  /** While a tab is dragged the active tab is not scrolled into view. */
  dragging: boolean;
}) {
  const [tabOverflow, setTabOverflow] = useState({ left: false, right: false });
  // Stable without the compiler too: the observer effect below depends on this identity.
  const syncTabOverflow = useStableCallback(() => {
    const el = tabStripRef.current;
    const next = el
      ? tabStripOverflow(el.scrollLeft, el.clientWidth, el.scrollWidth)
      : { left: false, right: false };
    setTabOverflow((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
  });
  const scrollTabsBy = useStableCallback((direction: -1 | 1) => {
    const el = tabStripRef.current;
    if (!el) return;
    const amount = Math.max(el.clientWidth * 0.6, 112);
    el.scrollBy({ left: direction * amount, behavior: "smooth" });
  });
  const activeTabRef = useRef<HTMLDivElement | null>(null);
  const overflowing = tabOverflow.left || tabOverflow.right;

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Scroll the selected tab into view when the strip overflows or a drag ends.
  useEffect(() => {
    if (dragging || !overflowing) return;
    activeTabRef.current?.scrollIntoView({
      inline: "nearest",
      block: "nearest",
    });
  }, [activeId, dragging, overflowing]);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Track the strip's scroll and resize events to update its chevrons.
  useLayoutEffect(() => {
    const el = tabStripRef.current;
    if (!el) return;
    el.addEventListener("scroll", syncTabOverflow, { passive: true });
    const unobserve = observeResize(el, syncTabOverflow);
    return () => {
      el.removeEventListener("scroll", syncTabOverflow);
      unobserve();
    };
  }, [syncTabOverflow, tabStripRef]);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Measure the strip when a fixed-width tab slot is added or removed.
  useLayoutEffect(() => {
    syncTabOverflow();
  }, [tabCount, syncTabOverflow]);

  return { tabOverflow, scrollTabsBy, activeTabRef };
}
