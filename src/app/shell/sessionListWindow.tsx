import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefCallback,
  type ReactNode,
  type RefObject,
  type FocusEvent,
} from "react";
import { defaultRangeExtractor, measureElement } from "@tanstack/react-virtual";
import { useCollectionVirtualizer } from "../../shared/hooks/useCollectionVirtualizer";
import { observeResize } from "../../shared/lib/observeResize";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import type { SessionListEntry } from "../../features/sessions/model/sessionFolders";
import type { FolderMoveTarget } from "../../features/sessions/model/sessionFolders";

export type FolderEntry = Extract<SessionListEntry, { kind: "folder" }>;

// Session cards include live status and actions; window them after roughly two viewports.
const SESSION_WINDOW_THRESHOLD = 20;
const INITIAL_WINDOW_ROWS = 16;

export function folderMoveTargetAt(
  x: number,
  y: number,
  list: HTMLElement | null,
): FolderMoveTarget | null {
  const el = document.elementFromPoint(x, y);
  if (!el || !list?.contains(el) || el.closest("[data-reminder-sessions], [data-settled-sessions]"))
    return null;
  if (el.closest('[data-session-section="reminders"], [data-session-section="settled"]'))
    return null;
  const folder = el.closest("[data-session-folder]") as HTMLElement | null;
  const ownerFolderId = (el.closest("[data-session-folder-owner]") as HTMLElement | null)?.dataset
    .sessionFolderOwner;
  if (ownerFolderId) return { kind: "into", id: ownerFolderId };
  if (el.closest('[data-session-section="pinned"]')) return { kind: "pinned" };
  const id = folder?.dataset.sessionFolder;
  if (folder && id) {
    const row = el.closest("[data-folder-row]");
    if (row && folder.contains(row) && row.closest("[data-session-folder]") === folder) {
      const rect = row.getBoundingClientRect();
      const at = rect.height > 0 ? (y - rect.top) / rect.height : 0.5;
      if (at < 0.3) return { kind: "beside", id, place: "before" };
      if (at > 0.7 && folder.dataset.folderCollapsed === "true")
        return { kind: "beside", id, place: "after" };
    }
    return { kind: "into", id };
  }
  return el.closest("[data-pinned-sessions]") ? { kind: "pinned" } : { kind: "root" };
}
export type SessionListRow =
  | { kind: "folder"; key: string; entry: FolderEntry; depth: number }
  | {
      kind: "group";
      key: string;
      entry: Extract<SessionListEntry, { kind: "pinned" | "reminders" | "settled" }>;
    }
  | {
      kind: "session";
      key: string;
      session: SessionSummary;
      /** `copy` is a session of the same project on another machine, merged in by the sidebar. */
      section: "folder" | "pinned" | "reminders" | "settled" | "ungrouped" | "copy";
      depth: number;
      folderId?: string;
      groupSection?: "pinned" | "reminders" | "settled";
    };
export type SessionListVirtualProps = {
  ref?: RefCallback<HTMLLIElement>;
  style?: CSSProperties;
  className?: string;
  "data-index"?: number;
  onFocusCapture?: () => void;
  onBlurCapture?: (event: FocusEvent<HTMLLIElement>) => void;
};

export function flattenSessionList(
  entries: readonly SessionListEntry[],
  expandCollapsed: boolean,
): SessionListRow[] {
  const rows: SessionListRow[] = [];
  const visitFolder = (entry: FolderEntry, depth: number, groupSection?: "pinned") => {
    rows.push({ kind: "folder", key: `folder:${entry.folder.id}`, entry, depth });
    if (entry.folder.collapsed && !expandCollapsed) return;
    entry.folders.forEach((child) => visitFolder(child, depth + 1, groupSection));
    entry.sessions.forEach((session) =>
      rows.push({
        kind: "session",
        key: `session:${session.id}`,
        session,
        section: "folder",
        depth: depth + 1,
        folderId: entry.folder.id,
        groupSection,
      }),
    );
  };
  entries.forEach((entry) => {
    if (entry.kind === "folder") {
      visitFolder(entry, 0);
      return;
    }
    if (entry.kind === "session") {
      rows.push({
        kind: "session",
        key: `session:${entry.session.id}`,
        session: entry.session,
        section: "ungrouped",
        depth: 0,
      });
      return;
    }
    rows.push({ kind: "group", key: `group:${entry.kind}`, entry });
    if (entry.collapsed && !expandCollapsed) return;
    if (entry.kind === "pinned")
      entry.folders.forEach((folder) => visitFolder(folder, 1, "pinned"));
    entry.sessions.forEach((session) =>
      rows.push({
        kind: "session",
        key: `session:${session.id}`,
        session,
        section: entry.kind,
        depth: 1,
        groupSection: entry.kind,
      }),
    );
  });
  return rows;
}

function observeListOffset(
  list: HTMLElement,
  root: HTMLElement,
  setOffset: (offset: number) => void,
) {
  const branches: HTMLElement[] = [];
  for (let node: HTMLElement | null = list; node && node !== root; node = node.parentElement)
    branches.push(node);
  let active = true;
  let queued = false;
  const measure = () => {
    if (queued || !active) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (active)
        setOffset(
          list.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop,
        );
    });
  };
  let preceding: Element[] = [];
  let stopSiblings: (() => void)[] = [];
  const trackSiblings = () => {
    const next: Element[] = [];
    for (const branch of branches)
      for (
        let sibling = branch.previousElementSibling;
        sibling;
        sibling = sibling.previousElementSibling
      )
        next.push(sibling);
    if (next.length === preceding.length && next.every((node, index) => node === preceding[index]))
      return;
    preceding = next;
    stopSiblings.forEach((stop) => stop());
    stopSiblings = next.map((node) => observeResize(node, measure));
    measure();
  };
  // Row churn lives inside the UL. Only changes among siblings of the UL or its ancestors
  // can change which elements precede it in the scroller.
  const mutations = new MutationObserver(trackSiblings);
  const stopParents = branches.map((branch) => {
    const parent = branch.parentElement!;
    mutations.observe(parent, { childList: true });
    let width: number | undefined;
    return observeResize(parent, (entry) => {
      if (width === entry.contentRect.width) return;
      width = entry.contentRect.width;
      measure();
    });
  });
  trackSiblings();
  if (!root.ownerDocument.defaultView?.ResizeObserver) measure();
  return () => {
    active = false;
    mutations.disconnect();
    stopSiblings.forEach((stop) => stop());
    stopParents.forEach((stop) => stop());
  };
}

export function SessionListWindow({
  rows,
  scrollRef,
  activeKey,
  activeRowKey,
  renderRow,
}: {
  rows: readonly SessionListRow[];
  scrollRef: RefObject<HTMLDivElement | null>;
  activeKey: string | null;
  activeRowKey?: string | null;
  renderRow: (row: SessionListRow, props: SessionListVirtualProps) => ReactNode;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const enabled = rows.length > SESSION_WINDOW_THRESHOLD;
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- The ancestor scroll ref is attached after its children's layout effects on the first commit.
  useEffect(() => {
    setScrollElement(scrollRef.current);
  }, [scrollRef]);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- track the window's offset in the existing sidebar scroller as its siblings resize
  useLayoutEffect(() => {
    const root = scrollElement;
    const list = listRef.current;
    if (!enabled || !root || !list) return;
    return observeListOffset(list, root, setScrollMargin);
  }, [enabled, scrollElement]);
  const activeIndex =
    enabled && (activeRowKey != null || activeKey != null)
      ? rows.findIndex((row) =>
          activeRowKey != null
            ? row.key === activeRowKey
            : row.kind === "session" && row.session.id === activeKey,
        )
      : -1;
  const focusedIndex =
    enabled && focusedKey != null ? rows.findIndex((row) => row.key === focusedKey) : -1;
  // oxlint-disable-next-line bycoda/compiler-owns-memo -- the restored scroll offset is a render-time DOM read; keep retained indexes stable between scroll events
  const rangeExtractor = useMemo(
    () => (range: Parameters<typeof defaultRangeExtractor>[0]) =>
      [
        ...new Set([
          ...defaultRangeExtractor(range),
          ...(activeIndex >= 0 ? [activeIndex] : []),
          ...(focusedIndex >= 0 ? [focusedIndex] : []),
        ]),
      ].sort((a, b) => a - b),
    [activeIndex, focusedIndex],
  );
  // oxlint-disable-next-line bycoda/compiler-owns-memo -- this uncompiled scroll window must retain TanStack's measurement keys until the rows change
  const getItemKey = useMemo(() => (index: number) => rows[index].key, [rows]);
  const virtualizer = useCollectionVirtualizer({
    enabled,
    count: rows.length,
    getScrollElement: () => scrollElement,
    getItemKey,
    estimateSize: (index) => (rows[index].kind === "session" ? 56 : 42),
    measureElement: (element, entry, instance) => {
      // Ref attachment runs during React's DOM writes. The observer delivers actual border boxes
      // together before paint, including when a previously measured row changes height.
      if (entry || !element.ownerDocument.defaultView?.ResizeObserver)
        return measureElement(element, entry, instance);
      const index = instance.indexFromElement(element);
      return (
        instance.itemSizeCache.get(instance.options.getItemKey(index)) ??
        instance.options.estimateSize(index)
      );
    },
    gap: 2,
    paddingStart: 6,
    paddingEnd: 40,
    scrollMargin,
    rangeExtractor,
  });
  let renderedRows: readonly { index: number; start: number }[] = enabled
    ? virtualizer.getVirtualItems()
    : rows.map((_, index) => ({ index, start: 0 }));
  if (enabled && !renderedRows.length) {
    // A restored or hidden sidebar can have a scroll offset before its viewport is measured.
    // The virtualizer already holds each row's estimated or measured start.
    const first = virtualizer.getVirtualItemForOffset(scrollRef.current?.scrollTop ?? 0);
    const startIndex = Math.min(first?.index ?? 0, rows.length - INITIAL_WINDOW_ROWS);
    renderedRows = rangeExtractor({
      startIndex,
      endIndex: startIndex + INITIAL_WINDOW_ROWS - 1,
      overscan: 0,
      count: rows.length,
    }).map((index) => virtualizer.measurementsCache[index]);
  }
  return (
    <ul
      ref={listRef}
      data-session-list
      className="flex flex-col gap-0.5 p-1.5 pb-10"
      style={enabled ? { height: virtualizer.getTotalSize(), position: "relative" } : undefined}
    >
      {renderedRows.map((item) => {
        const row = rows[item.index];
        return renderRow(row, {
          ref: enabled ? virtualizer.measureElement : undefined,
          "data-index": enabled ? item.index : undefined,
          className: enabled ? "absolute inset-x-0 top-0 list-none" : undefined,
          style: enabled ? { transform: `translateY(${item.start - scrollMargin}px)` } : undefined,
          onFocusCapture: () => setFocusedKey(row.key),
          onBlurCapture: (event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setFocusedKey(null);
          },
        });
      })}
    </ul>
  );
}
