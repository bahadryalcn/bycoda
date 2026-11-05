import { useCallback, useRef } from "react";
import { useRetainedScroll } from "./useRetainedScroll";

/** Stable composed ref: retention and virtual measurement share one scroll owner. */
export function useCollectionScroll(key: string, ready: boolean) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const retainedRef = useRetainedScroll<HTMLDivElement>(key, { ready });
  const scrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollerRef.current = node;
      retainedRef(node);
    },
    [retainedRef],
  );
  return { scrollerRef, scrollRef };
}
