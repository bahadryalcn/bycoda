import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * True while the element is within `margin` of the viewport. Media only needs to
 * start loading near view. By default it latches and never un-loads, so the
 * transcript height stays stable. With `releaseMargin` (wider than `margin`) it
 * turns false again once the element leaves that wider margin, so a caller can
 * drop heavy resources while its fixed-size box keeps the layout. Without
 * IntersectionObserver it is always near. `observeKey` changes when the caller
 * swaps the observed element, so the new one is watched instead of the old one.
 */
export function useNearViewport<T extends Element>(
  margin = 400,
  releaseMargin?: number,
  observeKey?: unknown,
): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  const settled = near && releaseMargin === undefined;
  useEffect(() => {
    // Observes the box against the transcript scroller; a latching hook stops after
    // its first hit, a releasing one keeps watching so it can report leaving.
    const element = ref.current;
    if (!element || settled) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const root = element.closest(".agent-transcript");
    const enter = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { root, rootMargin: `${margin}px` },
    );
    enter.observe(element);
    let leave: IntersectionObserver | undefined;
    if (releaseMargin !== undefined) {
      leave = new IntersectionObserver(
        (entries) => {
          // Entries arrive oldest first: only the latest state decides.
          if (entries.length > 0 && !entries[entries.length - 1].isIntersecting) setNear(false);
        },
        { root, rootMargin: `${Math.max(margin, releaseMargin)}px` },
      );
      leave.observe(element);
    }
    return () => {
      enter.disconnect();
      leave?.disconnect();
    };
  }, [settled, margin, releaseMargin, observeKey]);
  return [ref, near];
}
