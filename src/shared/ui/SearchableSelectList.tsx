import { defaultRangeExtractor } from "@tanstack/react-virtual";
import {
  Fragment,
  useLayoutEffect,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type RefObject,
} from "react";
import { useCollectionWindow } from "../hooks/useCollectionVirtualizer";
import { ComboboxList } from "./arc/combobox/combobox";
import type { SearchableSelectOption } from "./SearchableSelect";
import styles from "./SearchableSelect.module.css";

type Entry = { key: string; heading: number; optionIndex: number; isHeading: boolean };

function indexOptions(options: readonly SearchableSelectOption[]) {
  const entries: Entry[] = [];
  const optionEntries: number[] = [];
  const occurrences = new Map<string, number>();
  let heading = -1;
  let ungroupedSections = 0;
  options.forEach(({ group, value }, index) => {
    if (index === 0 || group !== options[index - 1]?.group) {
      if (group) {
        heading = entries.length;
        const occurrence = occurrences.get(group) ?? 0;
        occurrences.set(group, occurrence + 1);
        entries.push({
          key: `heading:${occurrence}:${group}`,
          heading,
          optionIndex: index,
          isHeading: true,
        });
      } else {
        ungroupedSections += 1;
        heading = -ungroupedSections;
      }
    }
    optionEntries.push(entries.length);
    entries.push({ key: `option:${value}`, heading, optionIndex: index, isHeading: false });
  });
  return { entries, optionEntries };
}

/**
 * Keeps sticky group headings, the pinned scope and the active descendant in a bounded option list.
 * @group choice
 * @status internal
 * @use Inside SearchableSelect.
 * @avoid Standalone selection fields use SearchableSelect.
 */
export function SearchableSelectList({
  options,
  activeIndex,
  windowed,
  query,
  listRef,
  renderOption,
  children,
  ...listProps
}: ComponentPropsWithoutRef<typeof ComboboxList> & {
  options: readonly SearchableSelectOption[];
  activeIndex: number;
  windowed: boolean;
  query: string;
  listRef: RefObject<HTMLDivElement | null>;
  renderOption: (
    option: SearchableSelectOption,
    index: number,
    entryIndex?: number,
    measure?: (element: HTMLElement | null) => void,
  ) => ReactNode;
}) {
  const { entries, optionEntries } = indexOptions(options);
  const activeEntry = optionEntries[activeIndex];
  const activeValue = options[activeIndex]?.value;
  // A pinned scope is always the first option, including after filtering.
  const pinnedEntry = options[0]?.pinned ? optionEntries[0] : undefined;
  const { items, totalSize, measureElement, scrollToIndex } = useCollectionWindow<
    HTMLDivElement,
    HTMLElement
  >({
    count: entries.length,
    enabled: windowed,
    getScrollElement: () => listRef.current,
    getItemKey: (i) => entries[i]!.key,
    estimateSize: (i) =>
      entries[i]!.isHeading ? 24 : options[entries[i]!.optionIndex]!.description ? 48 : 32,
    scrollPaddingStart:
      (pinnedEntry === undefined ? 0 : 32) + (options[activeIndex]?.group ? 24 : 0),
    rangeExtractor: (range) => {
      const indices = new Set(defaultRangeExtractor(range));
      if (activeEntry !== undefined) indices.add(activeEntry);
      if (pinnedEntry !== undefined) indices.add(pinnedEntry);
      for (const i of indices) {
        const heading = entries[i]!.heading;
        if (heading >= 0) indices.add(heading);
      }
      return [...indices].sort((a, b) => a - b);
    },
  });
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keep the scroll viewport aligned with the active result after keyboard navigation and filtering.
  useLayoutEffect(() => {
    if (windowed && activeEntry !== undefined) scrollToIndex(activeEntry, { align: "auto" });
  }, [windowed, activeEntry, activeValue, query, scrollToIndex]);

  const visible = windowed ? items : entries.map((_, index) => ({ index, start: 0, end: 0 }));
  const blocks: { heading: number; key: string; before: number; rows: ReactNode[] }[] = [];
  let end = 0;
  for (const item of visible) {
    const entry = entries[item.index]!;
    const gap = item.start - end;
    end = item.end;
    let block = blocks[blocks.length - 1];
    if (!block || block.heading !== entry.heading) {
      block = {
        heading: entry.heading,
        key: entry.heading >= 0 ? entry.key : `ungrouped:${entry.heading}`,
        before: gap,
        rows: [],
      };
      blocks.push(block);
    } else if (gap > 0) {
      block.rows.push(<div key={`gap:${entry.key}`} aria-hidden style={{ blockSize: gap }} />);
    }
    block.rows.push(
      entry.isHeading ? (
        <div
          key={entry.key}
          id={`${listProps.id}-group-${entry.heading}`}
          ref={windowed ? measureElement : undefined}
          data-index={windowed ? item.index : undefined}
          role="presentation"
          className={styles.groupHeading}
          data-after-group={windowed && options[entry.optionIndex - 1]?.group ? "" : undefined}
        >
          {options[entry.optionIndex]!.group}
        </div>
      ) : (
        renderOption(
          options[entry.optionIndex]!,
          entry.optionIndex,
          windowed ? item.index : undefined,
          windowed ? measureElement : undefined,
        )
      ),
    );
  }
  return (
    <ComboboxList {...listProps} ref={listRef}>
      {blocks.map((block) => (
        <Fragment key={block.key}>
          {block.before > 0 ? <div aria-hidden style={{ blockSize: block.before }} /> : null}
          {block.heading >= 0 ? (
            <div
              role="group"
              aria-labelledby={`${listProps.id}-group-${block.heading}`}
              className={windowed ? undefined : styles.group}
            >
              {block.rows}
            </div>
          ) : (
            block.rows
          )}
        </Fragment>
      ))}
      {windowed && totalSize > end ? (
        <div aria-hidden style={{ blockSize: totalSize - end }} />
      ) : null}
      {children}
    </ComboboxList>
  );
}
