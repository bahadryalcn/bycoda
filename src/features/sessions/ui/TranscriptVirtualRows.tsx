import { stableCodeDisclosureIdentity } from "./stableCodeDisclosureIdentity";
import { flushSync } from "react-dom";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import {
  Fragment,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  closestScroll,
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
const ESTIMATED_ROW_HEIGHT = 96;

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
  const oldCount = useRef(rows.length);
  const transition = useRef<{ node: HTMLElement; top: number } | null>(null);
  const [scroll, setScroll] = useState<HTMLElement | null>(null);
  const [margin, setMargin] = useState(0);
  const [width, setWidth] = useState(0);
  const [focus, setFocus] = useState<string | null>(null);
  const [selection, setSelection] = useState<readonly number[] | null>(null);
  const anchor = useRef<{ changed: () => void; release: () => void } | null>(null);
  const sizes = useMemo(() => {
    let cache = owner?.measurements.get(listId);
    if (!cache) {
      cache = new Map<string, { width: number; height: number }>();
      owner?.measurements.set(listId, cache);
    }
    return cache;
  }, [owner, listId]);
  const anchorId = scroll ? owner?.anchorId(scroll) : undefined;
  const pins = useMemo(
    () =>
      rows.flatMap((row, index) =>
        row.pinned ||
        row.blockIds.some((id) => owner?.activeBlocks.has(id)) ||
        (target && row.blockIds.includes(target)) ||
        (anchorId && row.blockIds.includes(anchorId))
          ? [index]
          : [],
      ),
    [rows, target, anchorId, owner, activeVersion],
  );
  const virtual = useVirtualizer<HTMLElement, HTMLDivElement>({
    count: rows.length,
    enabled: virtualized,
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
        ? selectedVirtualRange(root.current, id, rows.length)
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
      if (row && height >= 0) sizes.set(row.id, { width, height });
      anchor.current?.changed();
      return height;
    },
  });
  // Shared visible-row anchoring owns corrections once, including nested lists.
  virtual.shouldAdjustScrollPositionOnItemSizeChange = () => false;

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      const parent = closestScroll(element);
      setScroll((previous) => (previous === parent ? previous : parent));
      const rect = element.getBoundingClientRect();
      setWidth((previous) => (Math.abs(previous - rect.width) < 0.5 ? previous : rect.width));
      if (parent) {
        const next = rect.top - parent.getBoundingClientRect().top + parent.scrollTop;
        setMargin((previous) => (Math.abs(previous - next) < 0.5 ? previous : next));
      }
    };
    measure();
    if (!virtualized) return;
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    const mutations =
      typeof MutationObserver === "undefined" ? null : new MutationObserver(measure);
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      resize?.observe(node);
      mutations?.observe(node, { attributes: true, attributeFilter: ["class", "style"] });
      const parent: HTMLElement | null = node.parentElement;
      if (parent)
        for (const sibling of parent.children as HTMLCollectionOf<Element>)
          if (sibling !== node) resize?.observe(sibling);
      if (node === scroll || node.classList.contains("agent-transcript")) break;
    }
    return () => {
      resize?.disconnect();
      mutations?.disconnect();
    };
  }, [scroll, virtualized]);
  useLayoutEffect(() => {
    virtual.measure();
  }, [virtual, width]);
  useLayoutEffect(() => {
    if (!scroll || !owner || !virtualized) return;
    const acquired = owner.acquire(
      scroll,
      root.current?.closest<HTMLElement>("[data-transcript-turn]") ?? null,
    );
    anchor.current = acquired;
    return () => {
      acquired.release();
      anchor.current = null;
    };
  }, [owner, scroll, virtualized]);
  useLayoutEffect(() => {
    const selected = (synchronous = false) => {
      const next = root.current ? selectedVirtualRange(root.current, id, rows.length) : null;
      const update = () =>
        setSelection((previous) =>
          previous?.[0] === next?.[0] && previous?.[1] === next?.[1] ? previous : next,
        );
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
  }, [id, rows.length]);
  useLayoutEffect(() => {
    const retained = new Set(rows.map((row) => row.id));
    for (const key of sizes.keys()) if (!retained.has(key)) sizes.delete(key);
  }, [rows, sizes]);

  useLayoutEffect(() => {
    if (!virtualized && rows.length > TRANSCRIPT_VIRTUAL_THRESHOLD) {
      const node = scroll && owner?.firstVisibleRow(scroll);
      if (node) transition.current = { node, top: node.getBoundingClientRect().top };
      setVirtualized(true);
    } else if (transition.current) {
      const saved = transition.current;
      transition.current = null;
      if (scroll && saved.node.isConnected) {
        scroll.scrollTop += saved.node.getBoundingClientRect().top - saved.top;
        owner?.resetAnchors();
        owner?.adjusted?.(scroll);
      }
    }
    oldCount.current = rows.length;
    anchor.current?.changed();
  }, [virtualized, rows, scroll, owner]);

  const items = virtualized
    ? virtual.getVirtualItems()
    : rows
        .slice(0, Math.min(rows.length, Math.max(TRANSCRIPT_VIRTUAL_THRESHOLD, oldCount.current)))
        .map((row, index) => ({ index, key: row.id, start: 0, end: 0 }));
  let previousEnd = 0;
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
            setFocus(rows[Number(element.dataset.index)]?.id ?? null);
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
      {items.map((item) => {
        const start = Math.max(0, item.start - margin);
        const gap = Math.max(0, start - previousEnd);
        previousEnd = Math.max(previousEnd, item.end - margin);
        return (
          <Fragment key={item.key}>
            {gap > 0 ? (
              <div aria-hidden="true" data-transcript-virtual-spacer style={{ height: gap }} />
            ) : null}
            <MeasuredRow
              row={rows[item.index]}
              index={item.index}
              ownerId={id}
              listId={listId}
              measure={virtualized ? virtual.measureElement : noMeasure}
              scroll={scroll}
            />
          </Fragment>
        );
      })}
      {virtualized && virtual.getTotalSize() > previousEnd ? (
        <div
          aria-hidden="true"
          data-transcript-virtual-spacer
          style={{ height: virtual.getTotalSize() - previousEnd }}
        />
      ) : null}
    </div>
  );
}
function MeasuredRow({
  row,
  index,
  ownerId,
  listId,
  measure,
  scroll,
}: {
  row: TranscriptVirtualRow;
  index: number;
  ownerId: string;
  listId: string;
  measure: (node: HTMLDivElement | null) => void;
  scroll: HTMLElement | null;
}) {
  const owner = useContext(TranscriptVirtualizationContext);
  const element = useRef<HTMLDivElement | null>(null);
  const key = JSON.stringify([listId, row.id]);
  const setNode = useCallback(
    (node: HTMLDivElement | null) => {
      element.current = node;
      if (node && scroll) owner?.rowScroll.set(node, scroll);
      measure(node);
    },
    [measure, owner, scroll],
  );
  useLayoutEffect(() => {
    const node = element.current;
    const saved = owner?.codeFolds.get(key);
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
      if (shells.length)
        owner?.codeFolds.set(
          key,
          Object.fromEntries([...stableCodeDisclosureIdentity(shells)].map(([shell, identity]) => [identity, shell.dataset.collapsed === "true"])),
        );
    };
  }, [owner, key]);
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
}

const noMeasure = (_node: HTMLDivElement | null) => {};

function ownCodeShells(node: HTMLElement): HTMLElement[] {
  return [...node.querySelectorAll<HTMLElement>(".markdown-code-shell")].filter(
    (shell) => shell.closest("[data-transcript-virtual-owner]") === node,
  );
}
