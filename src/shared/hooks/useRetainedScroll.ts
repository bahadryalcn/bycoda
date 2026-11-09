import { useCallback, useLayoutEffect, useState } from "react";
import { useRetainedState } from "./useRetainedState";

/** Window-lifetime scroll, scoped by the feature's project/host/list key.
 * Defer restoration until the owner has rendered its list data. */
export function useRetainedScroll<T extends HTMLElement>(
  key: string,
  { ready = true }: { ready?: boolean } = {},
) {
  // Mutating this snapshot avoids a component render for every scroll event. It is a
  // view-mode entry, so it is cheap to lose and evictable once its list unmounts.
  const [position] = useRetainedState(`${key}:scroll`, () => ({ top: 0, left: 0 }), "view");
  const [element, setElement] = useState<T | null>(null);
  const ref = useCallback((node: T | null) => setElement(node), []);
  useLayoutEffect(() => {
    if (!element || !ready) return;
    element.scrollTop = position.top;
    element.scrollLeft = position.left;
    const remember = () => {
      position.top = element.scrollTop;
      position.left = element.scrollLeft;
    };
    element.addEventListener("scroll", remember, { passive: true });
    return () => {
      // Hidden Activity panels can already have zero geometry during cleanup.
      // Their last real scroll event, rather than that hidden layout, owns the snapshot.
      element.removeEventListener("scroll", remember);
    };
  }, [element, ready, position]);
  return ref;
}
