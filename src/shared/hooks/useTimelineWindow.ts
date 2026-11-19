import { useLayoutEffect, useRef, useState } from "react";
import { defaultRangeExtractor } from "@tanstack/react-virtual";
import { COLLECTION_WINDOW_THRESHOLD, useCollectionVirtualizer } from "./useCollectionVirtualizer";
import { useStableCallback } from "./useStableCallback";

const ESTIMATED_ROW_HEIGHT = 96;

/** Nearest ancestor that scrolls vertically: the timeline never owns its scroller. */
function scrollParent(node: HTMLElement): HTMLElement | null {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow === "auto" || overflow === "scroll") return parent;
  }
  return null;
}

/** Height a row takes in the list: its box, the day separator above it and the gaps. */
function rowHeight(element: HTMLElement, entry?: ResizeObserverEntry): number {
  const own = entry?.borderBoxSize?.[0]?.blockSize ?? element.offsetHeight;
  if (!own) return 0;
  const parent = element.parentElement;
  const gap = parent ? parseFloat(getComputedStyle(parent).rowGap) || 0 : 0;
  const before = element.previousElementSibling as HTMLElement | null;
  const separator = before?.hasAttribute("data-timeline-day") ? before.offsetHeight + gap : 0;
  return own + gap + separator;
}

/**
 * Finite DOM window over a message list whose rows keep normal flow: the caller renders only
 * `indexes` between `padStart` and `padEnd` of block padding, so alignment, gaps and day
 * separators stay the list's own CSS. The scroller is the nearest scrolling ancestor.
 * Rows that are focused stay mounted; rows added before the first one keep the reader's place.
 * TanStack Virtual lives here, outside the compiled component that renders the rows.
 */
export function useTimelineWindow({
  keys,
  onSizeChange,
}: {
  /** One stable key per row, oldest first. An empty list disables windowing. */
  keys: readonly string[];
  /** Called after measured rows replace estimates, so a reader following the end can stay there. */
  onSizeChange?: () => void;
}) {
  const [list, setList] = useState<HTMLElement | null>(null);
  const [scroll, setScroll] = useState<HTMLElement | null>(null);
  const [margin, setMargin] = useState(0);
  // Focus and measured sizes are read only by the virtualizer, so a change must not re-render rows.
  const focused = useRef<string | null>(null);
  const sizes = useRef(new Map<string, number>());
  const firstKey = useRef<string | undefined>(undefined);
  const notify = useStableCallback(onSizeChange);
  const focus = useStableCallback((key: string | null) => {
    focused.current = key;
  });
  const virtualizer = useCollectionVirtualizer<HTMLElement, HTMLElement>({
    count: keys.length,
    getScrollElement: () => scroll,
    getItemKey: (index) => keys[index],
    estimateSize: (index) => sizes.current.get(keys[index]) ?? ESTIMATED_ROW_HEIGHT,
    scrollMargin: margin,
    rangeExtractor: (range) => {
      const pinned = focused.current === null ? -1 : keys.indexOf(focused.current);
      return [...new Set([...defaultRangeExtractor(range), ...(pinned >= 0 ? [pinned] : [])])].sort(
        (a, b) => a - b,
      );
    },
    measureElement: (element, entry) => {
      const key = keys[Number(element.dataset.index)];
      const height = rowHeight(element, entry);
      // A hidden list measures zero: keep the last real size instead of collapsing the row.
      if (!height) return (key && sizes.current.get(key)) || ESTIMATED_ROW_HEIGHT;
      if (key !== undefined) sizes.current.set(key, height);
      return height;
    },
  });
  const enabled = keys.length > COLLECTION_WINDOW_THRESHOLD;
  const items = enabled ? virtualizer.getVirtualItems() : [];
  const total = enabled ? virtualizer.getTotalSize() : 0;

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- the scroller is a DOM ancestor the list discovers once it is mounted
  useLayoutEffect(() => {
    setScroll(list ? scrollParent(list) : null);
  }, [list]);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- the list's offset inside the scroller follows layout (footers, skeletons above it), which only observers report
  useLayoutEffect(() => {
    if (!list || !scroll || !enabled) return;
    const update = () => {
      const next =
        list.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
      setMargin((previous) => (Math.abs(previous - next) < 0.5 ? previous : next));
    };
    update();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    const mutations = typeof MutationObserver === "undefined" ? null : new MutationObserver(update);
    resize?.observe(scroll);
    for (const sibling of list.parentElement?.children ?? [])
      if (sibling !== list) resize?.observe(sibling);
    if (list.parentElement) mutations?.observe(list.parentElement, { childList: true });
    return () => {
      resize?.disconnect();
      mutations?.disconnect();
    };
  }, [list, scroll, enabled]);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- the scroller's offset must follow rows inserted above the reader, which the DOM does not do for a window
  useLayoutEffect(() => {
    const previous = firstKey.current;
    firstKey.current = keys[0];
    if (!enabled || !scroll || previous === undefined || previous === keys[0]) return;
    const index = keys.indexOf(previous);
    if (index <= 0) return;
    let added = 0;
    for (let row = 0; row < index; row++)
      added += sizes.current.get(keys[row]) ?? ESTIMATED_ROW_HEIGHT;
    scroll.scrollBy(0, added);
  }, [keys, enabled, scroll]);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- tells the scroller's owner the content height changed after rows were measured
  useLayoutEffect(() => {
    if (enabled) notify?.();
  }, [total, enabled, notify]);

  return {
    windowed: enabled,
    /** Row indexes to render, ascending. */
    indexes: items.map((item) => item.index),
    padStart: items.length ? Math.max(0, items[0].start - margin) : 0,
    padEnd: items.length ? Math.max(0, total - (items[items.length - 1].end - margin)) : 0,
    attachList: setList,
    /** Ref callback of each rendered row; the row carries `data-index`. */
    measureRow: virtualizer.measureElement,
    focus,
  };
}
