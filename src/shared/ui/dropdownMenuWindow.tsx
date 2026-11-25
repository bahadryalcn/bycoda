import { Fragment, useRef, type ReactNode } from "react";
import { defaultRangeExtractor } from "@tanstack/react-virtual";
import { useCollectionWindow } from "../hooks/useCollectionVirtualizer";
import type { DropdownMenuAction } from "./dropdownMenuModel";

/**
 * Keeps the focused row mounted even when pointer scrolling moves the viewport away.
 * @group actions
 * @status internal
 * @use Long, flat action menus inside DropdownMenu with windowing enabled.
 * @avoid Standalone menus: use DropdownMenu, which owns focus, selection and dismissal.
 */
export function DropdownMenuWindow({
  actions,
  focusedId,
  renderAction,
}: {
  actions: DropdownMenuAction[];
  focusedId?: string;
  renderAction: (item: DropdownMenuAction, index: number) => ReactNode;
}) {
  // The menu surface's forwarded ref attaches after this child's layout effects.
  // Its direct child is already attached when the virtualizer subscribes to scroll.
  const body = useRef<HTMLDivElement>(null);
  const focusedIndex = actions.findIndex((action) => action.id === focusedId);
  const { items, totalSize, measureElement } = useCollectionWindow({
    count: actions.length,
    getScrollElement: () => body.current?.parentElement ?? null,
    getItemKey: (index) => actions[index].id,
    estimateSize: () => 28,
    rangeExtractor: (range) => {
      const indices = defaultRangeExtractor(range);
      if (focusedIndex >= 0 && focusedIndex < indices[0]) indices.unshift(focusedIndex);
      else if (focusedIndex > indices[indices.length - 1]) indices.push(focusedIndex);
      return indices;
    },
  });
  return (
    <div ref={body}>
      {items.map((row, i) => {
        const gap = row.start - (items[i - 1]?.end ?? 0);
        return (
          <Fragment key={row.key}>
            {gap > 0 && <div aria-hidden="true" style={{ height: gap }} />}
            <div data-index={row.index} ref={measureElement}>
              {renderAction(actions[row.index], row.index)}
            </div>
          </Fragment>
        );
      })}
      <div aria-hidden="true" style={{ height: totalSize - (items[items.length - 1]?.end ?? 0) }} />
    </div>
  );
}
