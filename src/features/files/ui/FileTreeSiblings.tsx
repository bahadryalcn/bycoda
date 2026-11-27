import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { FsEntry } from "../../../platform/tauri/fs";
import "./fileTreePage.css";

const placeholders = new WeakMap<HTMLElement, readonly FsEntry[]>();
const mountedSelector = "[data-explorer-root], [role='treeitem']";

/** The workspace root carries its path in data-path, file and folder rows in title. */
export const rowPath = (row: HTMLElement) => row.dataset.path ?? row.title;

export function mountedTreeRow(root: HTMLElement | null, path: string) {
  return root?.querySelector<HTMLElement>(
    `[data-explorer-root][data-path="${CSS.escape(path)}"], [role="treeitem"][title="${CSS.escape(path)}"]`,
  );
}

/** DOM order includes open descendants. A spacer represents a run of closed sibling rows. */
export function visibleTreePaths(root: HTMLElement | null) {
  const paths: string[] = [];
  for (const row of root?.querySelectorAll<HTMLElement>(
    `${mountedSelector}, [data-explorer-page-spacer]`,
  ) ?? []) {
    const entries = placeholders.get(row);
    if (entries) {
      for (const entry of entries) paths.push(entry.path);
    } else paths.push(rowPath(row));
  }
  return paths;
}

const PAGE_SIZE = 32;

/** Page markers and rows are siblings. A path keeps its React identity even when a refreshed
 * listing moves its inline editor or expanded subtree across a page boundary. */
export function FileTreeSiblings({
  entries,
  eager,
  isPinned,
  renderRow,
  offset,
}: {
  entries: readonly FsEntry[];
  eager: number;
  isPinned: (path: string) => boolean;
  renderRow: (entry: FsEntry, index: number) => ReactNode;
  offset: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState<ReadonlySet<number>>(() => new Set());
  const pageCount = Math.ceil(Math.max(0, entries.length - eager) / PAGE_SIZE);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Observe page markers in the scroll container to mount rows as they enter view.
  useEffect(() => {
    const group = ref.current;
    if (!group || !pageCount || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (changes) => {
        setNear((previous) => {
          let updated: Set<number> | undefined;
          for (const change of changes) {
            const key = Number((change.target as HTMLElement).dataset.explorerPage);
            if ((updated ?? previous).has(key) === change.isIntersecting) continue;
            updated ??= new Set(previous);
            if (change.isIntersecting) updated.add(key);
            else updated.delete(key);
          }
          return updated ?? previous;
        });
      },
      {
        root: group.closest(".overflow-y-auto"),
        rootMargin: "480px 0px",
      },
    );
    for (const marker of group.querySelectorAll(":scope > [data-explorer-page]"))
      observer.observe(marker);
    return () => observer.disconnect();
  }, [eager, pageCount]);
  const rows = entries.slice(0, eager).map((entry, i) => renderRow(entry, offset + i));
  for (let i = eager; i < entries.length; i += PAGE_SIZE) {
    const page = entries.slice(i, i + PAGE_SIZE);
    const mounted =
      near.has(i) ||
      page.some(({ path }) => isPinned(path)) ||
      typeof IntersectionObserver === "undefined";
    rows.push(
      <div
        key={`page-${i}`}
        data-explorer-page={i}
        data-explorer-page-spacer={mounted ? undefined : ""}
        aria-hidden="true"
        style={{ "--explorer-page-count": page.length } as CSSProperties}
        ref={(node) => {
          if (node && !mounted) placeholders.set(node, page);
        }}
      />,
    );
    if (mounted) {
      for (let j = 0; j < page.length; j++) rows.push(renderRow(page[j], offset + i + j));
    }
  }
  return <div ref={ref}>{rows}</div>;
}
