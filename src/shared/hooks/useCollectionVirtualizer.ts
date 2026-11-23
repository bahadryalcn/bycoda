import { useVirtualizer, type VirtualizerOptions } from "@tanstack/react-virtual";

export const COLLECTION_WINDOW_THRESHOLD = 64;

type CollectionVirtualizerOptions<TScroll extends Element, TItem extends Element> = Omit<
  VirtualizerOptions<TScroll, TItem>,
  "observeElementRect" | "observeElementOffset" | "scrollToFn"
>;

/** Shared finite-window policy for collections and semantic table adapters. */
export function useCollectionVirtualizer<TScroll extends Element, TItem extends Element>(
  options: CollectionVirtualizerOptions<TScroll, TItem>,
) {
  return useVirtualizer<TScroll, TItem>({
    enabled: options.count > COLLECTION_WINDOW_THRESHOLD,
    initialRect: { width: 640, height: 480 },
    overscan: 6,
    ...options,
  });
}

/** Reads the mutable virtualizer on each render before handing its values to compiled UI. */
export function useCollectionWindow<TScroll extends Element, TItem extends Element>(
  options: CollectionVirtualizerOptions<TScroll, TItem>,
) {
  const virtualizer = useCollectionVirtualizer(options);
  return {
    items: virtualizer.getVirtualItems(),
    totalSize: virtualizer.getTotalSize(),
    measureElement: virtualizer.measureElement,
    scrollToIndex: virtualizer.scrollToIndex,
  };
}
