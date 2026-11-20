import { useEffect, useRef, useState } from "react";
import { peekDir, subscribeDirListings } from "../model/fileTree";
import { parentPath } from "../../../shared/lib/paths";

export type Creating = { id: number; parent: string; isDir: boolean };
export type Clip = {
  mode: "copy" | "cut";
  entries: { path: string; isDir: boolean }[];
  systemFiles: Promise<string[] | null>;
};
export type MenuTarget = { path: string; isDir: boolean; isRoot: boolean };
export type MenuState = { x: number; y: number; target: MenuTarget };
export type RefreshFailure = {
  cwd: string;
  touched: string[];
  forget: string[];
  message: string;
};

/**
 * The row that carries the tree's single Tab stop (roving tabindex): the active path, or its nearest
 * rendered ancestor when a collapsed folder hides it. Null (root or no active path) leaves the stop to
 * the first root row.
 */
export function treeTabStop(
  cwd: string,
  active: string | null,
  expanded: ReadonlySet<string>,
): string | null {
  if (!active || active === cwd) return null;
  const chain: string[] = [];
  for (let current = active; current !== cwd;) {
    const parent = parentPath(current);
    if (!parent || parent === current) return null;
    chain.unshift(current);
    current = parent;
  }
  return chain.find((path, index) => index < chain.length - 1 && !expanded.has(path)) ?? active;
}

export function isDirAt(cwd: string, path: string): boolean {
  if (path === cwd) return true;
  return (
    peekDir(parentPath(path))?.find((entry) => entry.path === path)?.isDir ?? peekDir(path) != null
  );
}

/** True when the parent's listing is loaded and no longer contains `path`. */
export function isMissingFromListing(path: string): boolean {
  const listing = peekDir(parentPath(path));
  return !!listing && !listing.some((entry) => entry.path === path);
}

/** Drops paths removed from their loaded parent listing; keeps the same set when nothing changed. */
export function dropMissingPaths(paths: Set<string>): Set<string> {
  const kept = [...paths].filter((path) => !isMissingFromListing(path));
  return kept.length === paths.size ? paths : new Set(kept);
}

/** Multi-selection state and anchor, reconciled with directory listings as they change. */
export function useTreeSelection(selectedPath: string | null) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(selectedPath ? [selectedPath] : []),
  );
  const anchor = useRef<string | null>(selectedPath);
  useEffect(
    () =>
      subscribeDirListings(() => {
        setSelected(dropMissingPaths);
        if (anchor.current && isMissingFromListing(anchor.current)) anchor.current = null;
      }),
    [],
  );
  const setAnchor = (path: string | null) => void (anchor.current = path);
  return [selected, setSelected, anchor, setAnchor] as const;
}
