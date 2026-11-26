import { stableCodeDisclosureIdentity } from "./stableCodeDisclosureIdentity";
import { flushSync } from "react-dom";
import { deferDuringResize } from "../../../shared/lib/resizeGesture";
import { defaultRangeExtractor, useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import {
  Fragment,
  memo,
  useCallback,
  type ContextType,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Key,
  type ReactNode,
  type RefObject,
} from "react";
import {
  closestScroll,
  type RowScrollOwner,
  selectedVirtualRange,
  TranscriptVirtualizationContext,
  useTranscriptRevealTarget,
  useTranscriptActiveBlocksVersion,
} from "./transcriptVirtualization";

export type TranscriptVirtualElement = {
  ref: (node: HTMLDivElement | null) => void;
  "data-index": number;
  "data-transcript-virtual-owner": string;
  "data-transcript-virtual-block-id": string | undefined;
};
export type TranscriptVirtualRow = {
  id: string;
  blockIds: readonly string[];
  pinned?: boolean;
  estimate?: number;
  render: () => ReactNode;
  renderElement?: (props: TranscriptVirtualElement) => ReactNode;
};
export const TRANSCRIPT_VIRTUAL_THRESHOLD = 80;

/** Variable-height rows use real measurements after mounting; estimates only locate unseen rows.
 * Selection/focus, original pending controls, live output and exact reveal targets remain mounted. */
export function TranscriptVirtualRows({
  rows,
  listId,
}: {
  rows: readonly TranscriptVirtualRow[];
  listId: string;
}) {
  const owner = useContext(TranscriptVirtualizationContext);
  return owner ? (
    <MeasuredTranscriptRows rows={rows} listId={listId} />
  ) : (
    <>
      {rows.map((row) => (
        <Fragment key={row.id}>{row.render()}</Fragment>
      ))}
    </>
  );
}
function MeasuredTranscriptRows({
  rows,
  listId,
}: {
  rows: readonly TranscriptVirtualRow[];
  listId: string;
}) {
  const owner = useContext(TranscriptVirtualizationContext);
  const target = useTranscriptRevealTarget();
  const activeVersion = useTranscriptActiveBlocksVersion();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [virtualized, setVirtualized] = useState(rows.length > TRANSCRIPT_VIRTUAL_THRESHOLD);
  // The row count of the last commit: a list crossing the threshold keeps its old rows for one frame.
  const [oldCount, setOldCount] = useState(rows.length);
  const transition = useRef<{ node: HTMLElement; top: number } | null>(null);
  const [scroll, setScroll] = useState<HTMLElement | null>(null);
  // Plain rows need their scroll container only if the transcript anchors on one of them.
  const plainScroll = useRef<HTMLElement | null>(null);
  // oxlint-disable-next-line bycoda/compiler-owns-memo -- this uncompiled list passes it to memoized rows; a new identity per render re-renders every settled row
  const resolvePlainScroll = useCallback(() => {
    if (!plainScroll.current && root.current) plainScroll.current = closestScroll(root.current);
    return plainScroll.current;
  }, []);
  const [margin, setMargin] = useState(0);
  const [width, setWidth] = useState(0);
  // Newest measured width, ahead of `width` while a live resize holds the commit back.
  const liveWidth = useRef(0);
  const [focus, setFocus] = useState<string | null>(null);
  const [selection, setSelection] = useState<readonly number[] | null>(null);
  const anchor = useRef<{ changed: () => void; release: () => void } | null>(null);
  const sizes = useMemo(
    () =>
      owner ? owner.measurementsFor(listId) : new Map<string, { width: number; height: number }>(),
    [owner, listId],
  );
  // oxlint-disable-next-line bycoda/compiler-owns-memo -- The compiler skips the virtualizer, and the list must retain the same fold map for its mounted owner and ID.
  const folds = useMemo(
    () => (owner ? owner.codeFoldsFor(listId) : new Map<string, Record<string, boolean>>()),
    [owner, listId],
  );
  const anchorId = scroll ? owner?.anchorId(scroll) : undefined;
  const pins = useMemo(
    () => pinnedRowIndexes(rows, owner, target, anchorId, activeVersion),
    // activeVersion: `owner.activeBlocks` changes without a new owner.
    [rows, target, anchorId, owner, activeVersion],
  );
  const virtual = useRowVirtualizer({
    rows,
    enabled: virtualized,
    scroll,
    margin,
    width,
    sizes,
    pins,
    focus,
    selection,
    root,
    ownerId: id,
    liveWidth,
    anchor,
  });

  const needsMeasurement = virtualized || rows.length > TRANSCRIPT_VIRTUAL_THRESHOLD;
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    // Ordinary lists use native layout. Take their geometry on the commit that
    // crosses the threshold so the virtualizer starts with the measured row sizes.
    plainScroll.current = null;
    if (!needsMeasurement) return;
    // A committed width clears every measured row size (`virtual.measure()` below), so a live
    // resize commits it once at the end instead of letting scrollHeight fall back to estimates
    // on each frame.
    const commit = () => {
      const next = element.getBoundingClientRect().width;
      setWidth((previous) => (Math.abs(previous - next) < 0.5 ? previous : next));
    };
    const commitWidth = deferDuringResize(commit);
    // Observers pass their entries as the first argument; only the mount call is immediate.
    const measure = (immediate?: unknown) => {
      const parent = closestScroll(element);
      plainScroll.current = parent;
      setScroll((previous) => (previous === parent ? previous : parent));
      const rect = element.getBoundingClientRect();
      liveWidth.current = rect.width;
      if (immediate === true) commit();
      else commitWidth();
      if (parent) {
        const next = rect.top - parent.getBoundingClientRect().top + parent.scrollTop;
        setMargin((previous) => (Math.abs(previous - next) < 0.5 ? previous : next));
      }
    };
    measure(true);
    if (!virtualized) return;
    // The owner shares one observer per node among all lists and coalesces the re-measures.
    const unwatch = owner?.layout.watch(element, scroll, measure);
    return () => {
      commitWidth.cancel();
      unwatch?.();
    };
  }, [owner, scroll, virtualized, needsMeasurement]);
  useLayoutEffect(() => {
    if (!scroll || !owner || !virtualized) return;
    const acquired = owner.acquire(scroll, owningTurn(root.current));
    anchor.current = acquired;
    return () => {
      acquired.release();
      anchor.current = null;
    };
  }, [owner, scroll, virtualized]);
  useLayoutEffect(() => {
    if (!virtualized) return;
    const selected = (synchronous = false) => {
      const next = root.current ? selectedVirtualRange(root.current, id, rows.length) : null;
      const update = () =>
        setSelection((previous) => (sameRange(previous, next) ? previous : next));
      if (synchronous && next) flushSync(update);
      else update();
    };
    const changed = () => selected();
    const copying = () => {
      const element = root.current;
      const selection = element?.ownerDocument.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const wholeList =
        !!element &&
        !!range &&
        range.startContainer === element &&
        range.startOffset === 0 &&
        range.endContainer === element &&
        range.endOffset === element.childNodes.length;
      selected(true);
      // Inserting rows at the old end boundary leaves native Range.endOffset
      // before those rows. Preserve Select All through synchronous materialization.
      if (wholeList && element && range && selection) {
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    };
    document.addEventListener("selectionchange", changed);
    document.addEventListener("copy", copying, true);
    return () => {
      document.removeEventListener("selectionchange", changed);
      document.removeEventListener("copy", copying, true);
    };
  }, [id, rows.length, virtualized]);
  useLayoutEffect(() => {
    owner?.retainRows(listId, new Set(rows.map((row) => row.id)));
  }, [rows, owner, listId]);
  // Holding ties the list's sizes and folds to its mount: unmounting drops them, and a strict-mode
  // replay re-holds the same maps so rows that wrote into them still reach the owner.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Register the list's caches with the transcript owner for the lifetime of its mounted rows.
  useLayoutEffect(() => {
    if (owner) return owner.holdList(listId, sizes, folds);
  }, [owner, listId, sizes, folds]);

  useLayoutEffect(() => {
    if (!virtualized && rows.length > TRANSCRIPT_VIRTUAL_THRESHOLD) {
      const parent = plainScroll.current;
      const node = parent && owner ? owner.firstVisibleRow(parent) : null;
      if (node) transition.current = { node, top: node.getBoundingClientRect().top };
      // The plain list never measured its rows: keep their real heights so the
      // virtualized list does not place every row at its estimate.
      if (root.current) seedRowSizes(root.current, id, rows, sizes);
      setVirtualized(true);
    } else if (transition.current) {
      const saved = transition.current;
      transition.current = null;
      if (scroll && saved.node.isConnected) {
        shiftScrollTop(scroll, saved.node.getBoundingClientRect().top - saved.top);
        owner?.resetAnchors();
        owner?.adjusted?.(scroll);
      }
    }
    setOldCount(rows.length);
    anchor.current?.changed();
  }, [virtualized, rows, scroll, owner, id, sizes]);

  const items: { index: number; key: Key; start: number; end: number }[] = virtualized
    ? virtual.items
    : rows
        .slice(0, Math.min(rows.length, Math.max(TRANSCRIPT_VIRTUAL_THRESHOLD, oldCount)))
        .map((row, index) => ({ index, key: row.id, start: 0, end: 0 }));
  const { placed, previousEnd } = placeRows(items, margin);
  return (
    <div
      ref={root}
      data-transcript-virtual-list={listId}
      className="min-w-0"
      style={{ overflowAnchor: "none" }}
      onFocusCapture={(event) => {
        let element = event.target as HTMLElement;
        while (element && element !== event.currentTarget) {
          if (element.dataset.transcriptVirtualOwner === id) {
            setFocus(rowIdAt(rows, Number(element.dataset.index)));
            return;
          }
          element = element.parentElement!;
        }
      }}
      onBlurCapture={(event) => {
        if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget as Node))
          setFocus(null);
      }}
    >
      {placed.map(({ item, gap }) => {
        return (
          <Fragment key={item.key}>
            {gap > 0 ? (
              <div aria-hidden="true" data-transcript-virtual-spacer style={{ height: gap }} />
            ) : null}
            <MeasuredRow
              row={rows[item.index]}
              index={item.index}
              ownerId={id}
              folds={folds}
              measure={virtualized ? virtual.measureElement : noMeasure}
              scroll={scroll ?? resolvePlainScroll}
            />
          </Fragment>
        );
      })}
      {virtualized && virtual.totalSize > previousEnd ? (
        <div
          aria-hidden="true"
          data-transcript-virtual-spacer
          style={{ height: virtual.totalSize - previousEnd }}
        />
      ) : null}
    </div>
  );
}
/** The row's DOM node and its ref callback; kept in a hook so the node ref never reaches render. */
function useRowNode(
  owner: ContextType<typeof TranscriptVirtualizationContext>,
  measure: (node: HTMLDivElement | null) => void,
  scroll: RowScrollOwner,
) {
  const element = useRef<HTMLDivElement | null>(null);
  const setNode = useCallback(
    (node: HTMLDivElement | null) => {
      element.current = node;
      if (node) owner?.rowScroll.set(node, scroll);
      measure(node);
    },
    [measure, owner, scroll],
  );
  return { element, setNode };
}

// oxlint-disable-next-line bycoda/compiler-owns-memo -- component-level bailout must also protect stable rows in uncompiled React
const MeasuredRow = memo(function MeasuredRow({
  row,
  index,
  ownerId,
  folds,
  measure,
  scroll,
}: {
  row: TranscriptVirtualRow;
  index: number;
  ownerId: string;
  folds: Map<string, Record<string, boolean>>;
  measure: (node: HTMLDivElement | null) => void;
  scroll: RowScrollOwner;
}) {
  const owner = useContext(TranscriptVirtualizationContext);
  const rowId = row.id;
  const { element, setNode } = useRowNode(owner, measure, scroll);
  useLayoutEffect(() => {
    const node = element.current;
    const saved = folds.get(rowId);
    const restored = new Set<string>();
    const restore = () => {
      if (!node || !saved) return;
      stableCodeDisclosureIdentity(ownCodeShells(node)).forEach((identity, shell) => {
        if (restored.has(identity) || typeof saved[identity] !== "boolean") return;
        restored.add(identity);
        if (saved[identity] !== (shell.dataset.collapsed === "true"))
          shell.querySelector<HTMLButtonElement>(".markdown-code-toggle")?.click();
      });
    };
    restore();
    const observer =
      node && saved && typeof MutationObserver !== "undefined"
        ? new MutationObserver(restore)
        : null;
    if (node) observer?.observe(node, { childList: true, subtree: true });
    return () => {
      observer?.disconnect();
      const shells = node ? ownCodeShells(node) : [];
      // A row whose code blocks are gone (edited away) has no fold state left to keep.
      if (shells.length)
        folds.set(
          rowId,
          Object.fromEntries(
            [...stableCodeDisclosureIdentity(shells)].map(([shell, identity]) => [
              identity,
              shell.dataset.collapsed === "true",
            ]),
          ),
        );
      else if (node) folds.delete(rowId);
    };
  }, [folds, rowId, element]);
  const attributes: TranscriptVirtualElement = {
    ref: setNode,
    "data-index": index,
    "data-transcript-virtual-owner": ownerId,
    "data-transcript-virtual-block-id": row.blockIds[0],
  };
  return row.renderElement ? (
    row.renderElement(attributes)
  ) : (
    <div {...attributes} className="flow-root min-w-0">
      {row.render()}
    </div>
  );
});

function sameRange(a: readonly number[] | null, b: readonly number[] | null): boolean {
  return a?.[0] === b?.[0] && a?.[1] === b?.[1];
}

function owningTurn(node: HTMLElement | null): HTMLElement | null {
  return node?.closest<HTMLElement>("[data-transcript-turn]") ?? null;
}

function rowIdAt(rows: readonly TranscriptVirtualRow[], index: number): string | null {
  return rows[index]?.id ?? null;
}

/** Rows that stay mounted wherever the viewport is: pinned, active, revealed or anchored. */
function pinnedRowIndexes(
  rows: readonly TranscriptVirtualRow[],
  owner: ContextType<typeof TranscriptVirtualizationContext>,
  target: string | null,
  anchorId: string | undefined,
  _activeVersion: number,
): number[] {
  return rows.flatMap((row, index) =>
    row.pinned ||
    row.blockIds.some((id) => owner?.activeBlocks.has(id)) ||
    (target && row.blockIds.includes(target)) ||
    (anchorId && row.blockIds.includes(anchorId))
      ? [index]
      : [],
  );
}

/** Each item with the empty space between it and the item before it. */
function placeRows<T extends { start: number; end: number }>(
  items: readonly T[],
  margin: number,
): { placed: { item: T; gap: number }[]; previousEnd: number } {
  let previousEnd = 0;
  const placed = items.map((item) => {
    const start = Math.max(0, item.start - margin);
    const gap = Math.max(0, start - previousEnd);
    previousEnd = Math.max(previousEnd, item.end - margin);
    return { item, gap };
  });
  return { placed, previousEnd };
}

/** DOM write kept out of the component body: the scroller is a state value to the compiler. */
function shiftScrollTop(scroll: HTMLElement, delta: number): void {
  scroll.scrollTop += delta;
}

const noMeasure = (_node: HTMLDivElement | null) => {};

/** Records the mounted rows' heights at the list's current width, which the switch commits. */
function seedRowSizes(
  element: HTMLElement,
  ownerId: string,
  rows: readonly TranscriptVirtualRow[],
  sizes: Map<string, RowSize>,
): void {
  const width = element.getBoundingClientRect().width;
  for (const node of element.querySelectorAll<HTMLElement>("[data-transcript-virtual-owner]")) {
    if (node.dataset.transcriptVirtualOwner !== ownerId) continue;
    const row = rows[Number(node.dataset.index)];
    const height = node.getBoundingClientRect().height;
    if (row && height > 0) sizes.set(row.id, { width, height });
  }
}

function ownCodeShells(node: HTMLElement): HTMLElement[] {
  return [...node.querySelectorAll<HTMLElement>(".markdown-code-shell")].filter(
    (shell) => shell.closest("[data-transcript-virtual-owner]") === node,
  );
}

const ESTIMATED_ROW_HEIGHT = 96;

type RowSize = { width: number; height: number };
type Options = {
  rows: readonly { id: string; estimate?: number }[];
  enabled: boolean;
  scroll: HTMLElement | null;
  margin: number;
  /** Committed list width; a change drops every measured size. */
  width: number;
  /** Measured row sizes by row id, shared with the virtualization owner. */
  sizes: Map<string, RowSize>;
  /** Row indexes that must stay mounted. */
  pins: readonly number[];
  focus: string | null;
  selection: readonly number[] | null;
  root: RefObject<HTMLDivElement | null>;
  ownerId: string;
  /** Newest measured width, ahead of `width` while a live resize holds the commit back. */
  liveWidth: RefObject<number>;
  anchor: RefObject<{ changed: () => void } | null>;
};

/**
 * TanStack Virtual for one transcript list. The library is not compatible with
 * the React Compiler, so it lives here and hands the list plain data: the
 * component that renders the rows stays compiled.
 */
function useRowVirtualizer({
  rows,
  enabled,
  scroll,
  margin,
  width,
  sizes,
  pins,
  focus,
  selection,
  root,
  ownerId,
  liveWidth,
  anchor,
}: Options): {
  items: VirtualItem[];
  totalSize: number;
  measureElement: (node: HTMLDivElement | null) => void;
} {
  const virtual = useVirtualizer<HTMLElement, HTMLDivElement>({
    count: rows.length,
    enabled,
    getScrollElement: () => scroll,
    getItemKey: (index) => rows[index].id,
    estimateSize: (index) => {
      const measured = sizes.get(rows[index].id);
      return measured?.width === width
        ? measured.height
        : (rows[index].estimate ?? ESTIMATED_ROW_HEIGHT);
    },
    initialRect: { width: 1, height: 800 },
    overscan: 5,
    scrollMargin: margin,
    rangeExtractor: (range) => {
      const included = new Set([...defaultRangeExtractor(range), ...pins]);
      const focusedIndex = focus === null ? -1 : rows.findIndex((row) => row.id === focus);
      if (focusedIndex >= 0) included.add(focusedIndex);
      const selected = root.current
        ? selectedVirtualRange(root.current, ownerId, rows.length)
        : selection;
      if (selected)
        for (let index = selected[0]; index <= selected[1]; index++) included.add(index);
      return [...included]
        .filter((index) => index >= 0 && index < rows.length)
        .sort((a, b) => a - b);
    },
    measureElement: (element, entry) => {
      const index = Number(element.dataset.index);
      const height = entry?.borderBoxSize?.[0]?.blockSize ?? element.getBoundingClientRect().height;
      const row = rows[index];
      if (!height && !scroll?.clientHeight)
        return (row && sizes.get(row.id)?.height) ?? row?.estimate ?? ESTIMATED_ROW_HEIGHT;
      if (row && height >= 0) sizes.set(row.id, { width: liveWidth.current || width, height });
      anchor.current?.changed();
      return height;
    },
  });
  // Shared visible-row anchoring owns corrections once, including nested lists.
  virtual.shouldAdjustScrollPositionOnItemSizeChange = () => false;
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- the virtualizer caches row sizes outside React and must drop them when the list width changes
  useLayoutEffect(() => {
    virtual.measure();
  }, [virtual, width]);
  return {
    items: enabled ? virtual.getVirtualItems() : [],
    totalSize: enabled ? virtual.getTotalSize() : 0,
    measureElement: virtual.measureElement,
  };
}
