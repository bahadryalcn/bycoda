import type { VirtualItem } from "@tanstack/react-virtual";
import { useCollectionWindow } from "../../hooks/useCollectionVirtualizer";

/** Lists longer than this render only the rows near the viewport; shorter ones mount every row. */
export const PICKER_WINDOW_THRESHOLD = 120;

const OPTION_HEIGHT = 32;
const HEADING_HEIGHT = 24;

export type PickerWindowEntry =
  | { kind: "heading"; key: string; group: string; groupKey: string }
  | { kind: "option"; key: string; groupKey?: string; index: number };

export type PickerWindow = {
  items: VirtualItem[];
  totalSize: number;
  measureElement: (node: HTMLElement | null) => void;
  /** Mount the entry and scroll it into view; the row may not be in the DOM yet. */
  scrollToEntry: (entry: number) => void;
};

/**
 * Windowing model of a long picker list. `entries` are the flattened group headings and options in
 * display order; paddingStart reserves any controls above the listbox in the same viewport.
 */
export function usePickerWindow(
  entries: readonly PickerWindowEntry[],
  getScrollElement: () => HTMLElement | null,
  enabled: boolean,
  paddingStart = 0,
): PickerWindow {
  const { items, totalSize, measureElement, scrollToIndex } = useCollectionWindow<
    HTMLElement,
    HTMLElement
  >({
    count: enabled ? entries.length : 0,
    getScrollElement,
    paddingStart,
    estimateSize: (index) => (entries[index]?.kind === "heading" ? HEADING_HEIGHT : OPTION_HEIGHT),
    getItemKey: (index) => entries[index]?.key ?? index,
    overscan: 8,
    enabled,
  });
  return {
    items,
    totalSize,
    measureElement,
    scrollToEntry: (entry) => scrollToIndex(entry, { align: "auto" }),
  };
}
