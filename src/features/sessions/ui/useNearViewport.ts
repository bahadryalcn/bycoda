import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Latches true once the element comes within `margin` of the viewport. Media
 * only needs to start loading near view; it never un-loads on scroll, so the
 * transcript height stays stable. Without IntersectionObserver it is always near.
 */
export function useNearViewport<T extends Element>(margin = 400): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near || !ref.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: `${margin}px` },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [near, margin]);
  return [ref, near];
}
