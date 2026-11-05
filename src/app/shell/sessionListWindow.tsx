import {
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
import { defaultRangeExtractor } from "@tanstack/react-virtual";
import {
  COLLECTION_WINDOW_THRESHOLD,
  useCollectionVirtualizer,
} from "../../shared/hooks/useCollectionVirtualizer";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import type { SessionListEntry } from "../../features/sessions/model/sessionFolders";
import type { FolderMoveTarget } from "../../features/sessions/model/sessionFolders";

export type FolderEntry = Extract<SessionListEntry, { kind: "folder" }>;

export function folderMoveTargetAt(
  x: number,
  y: number,
  list: HTMLElement | null,
): FolderMoveTarget | null {
  const el = document.elementFromPoint(x, y);
  if (!el || !list?.contains(el) || el.closest("[data-reminder-sessions]")) return null;
  if (el.closest('[data-session-section="reminders"]')) return null;
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
      entry: Extract<SessionListEntry, { kind: "pinned" | "reminders" }>;
    }
  | {
      kind: "session";
      key: string;
      session: SessionSummary;
      section: "folder" | "pinned" | "reminders" | "ungrouped";
      depth: number;
      folderId?: string;
      groupSection?: "pinned" | "reminders";
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
  const [scrollMargin, setScrollMargin] = useState(0);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  useLayoutEffect(() => {
    const root = scrollRef.current;
    const list = listRef.current;
    if (!root || !list) return;
    const measure = () =>
      setScrollMargin(
        list.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop,
      );
    measure();
    const observer = new ResizeObserver(measure);
    for (let node: HTMLElement | null = list; node && node !== root; node = node.parentElement) {
      observer.observe(node);
      for (
        let sibling = node.previousElementSibling;
        sibling;
        sibling = sibling.previousElementSibling
      ) {
        if (sibling instanceof HTMLElement) observer.observe(sibling);
      }
    }
    return () => observer.disconnect();
  }, [scrollRef, rows.length]);
  const activeIndex = rows.findIndex((row) =>
    activeRowKey != null
      ? row.key === activeRowKey
      : row.kind === "session" && row.session.id === activeKey,
  );
  const focusedIndex = rows.findIndex((row) => row.key === focusedKey);
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
  const virtualizer = useCollectionVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => rows[index].key,
    estimateSize: (index) => (rows[index].kind === "session" ? 56 : 42),
    gap: 2,
    paddingStart: 6,
    paddingEnd: 40,
    scrollMargin,
    rangeExtractor,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const enabled = rows.length > COLLECTION_WINDOW_THRESHOLD;
  const fallbackOffset = Math.max(0, (scrollRef.current?.scrollTop ?? 0) - scrollMargin - 6);
  let fallbackStart = 0;
  let fallbackStartIndex = 0;
  while (fallbackStartIndex < rows.length && fallbackStart < fallbackOffset) {
    fallbackStart += (rows[fallbackStartIndex].kind === "session" ? 56 : 42) + 2;
    fallbackStartIndex += 1;
  }
  const fallbackIndices = [
    ...new Set([
      ...Array.from(
        { length: Math.min(16, rows.length - fallbackStartIndex) },
        (_, index) => fallbackStartIndex + index,
      ),
      ...(activeIndex >= 0 ? [activeIndex] : []),
      ...(focusedIndex >= 0 ? [focusedIndex] : []),
    ]),
  ].sort((a, b) => a - b);
  const renderedRows = enabled
    ? virtualRows.length
      ? virtualRows
      : fallbackIndices.map((index) => ({
          index,
          start:
            scrollMargin +
            6 +
            rows
              .slice(0, index)
              .reduce((total, row) => total + (row.kind === "session" ? 56 : 42) + 2, 0),
        }))
    : rows.map((_, index) => ({ index, start: 0 }));
  const estimatedTotal =
    rows.reduce((total, row) => total + (row.kind === "session" ? 56 : 42), 0) +
    Math.max(0, rows.length - 1) * 2 +
    46;
  const measuredTotal = virtualizer.getTotalSize();
  return (
    <ul
      ref={listRef}
      data-session-list
      className="flex flex-col gap-0.5 p-1.5 pb-10"
      style={
        enabled ? { height: measuredTotal || estimatedTotal, position: "relative" } : undefined
      }
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
