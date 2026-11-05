import { useVirtualizer, type VirtualizerOptions } from "@tanstack/react-virtual";

export const COLLECTION_WINDOW_THRESHOLD = 64;

/** Shared finite-window policy for collections and semantic table adapters. */
export function useCollectionVirtualizer<TScroll extends Element, TItem extends Element>(
  options: Omit<
    VirtualizerOptions<TScroll, TItem>,
    "observeElementRect" | "observeElementOffset" | "scrollToFn"
  >,
) {
  return useVirtualizer<TScroll, TItem>({
    enabled: options.count > COLLECTION_WINDOW_THRESHOLD,
    initialRect: { width: 640, height: 480 },
    overscan: 6,
    ...options,
  });
}
