import type { GitChangedFile } from "../../../platform/tauri/fs";
import type { WorkingTreeDiffEntry } from "./workingTreeDiff";

/** Whether two index rows say the same thing about a file. */
export function sameChangedRow(a: GitChangedFile, b: GitChangedFile): boolean {
  return (
    a.relative === b.relative &&
    a.path === b.path &&
    a.status === b.status &&
    a.additions === b.additions &&
    a.deletions === b.deletions &&
    a.staged === b.staged &&
    a.unstaged === b.unstaged
  );
}

export function sameChangedFiles(
  a: readonly GitChangedFile[],
  b: readonly GitChangedFile[],
): boolean {
  return a.length === b.length && a.every((file, i) => sameChangedRow(file, b[i]));
}

/**
 * Ids whose loaded diff must be fetched again whatever their row says: every
 * entry when `paths` is null (the change did not say what it touched), else the
 * entries of the named files.
 */
export function dirtyEntryIds(
  entries: readonly WorkingTreeDiffEntry[],
  paths: ReadonlySet<string> | null,
): string[] {
  return entries
    .filter((entry) => paths === null || paths.has(entry.file.path))
    .map((entry) => entry.id);
}

/**
 * The entries to fetch: never loaded, loaded for a different row, or dirty.
 * The index row is all the list offers (no mtime or hash), so a file whose
 * contents changed under an identical row is only found through `dirty`.
 */
export function entriesToReload(
  entries: readonly WorkingTreeDiffEntry[],
  loadedRows: ReadonlyMap<string, GitChangedFile>,
  dirty: ReadonlySet<string>,
): WorkingTreeDiffEntry[] {
  return entries.filter((entry) => {
    const loaded = loadedRows.get(entry.id);
    return !loaded || dirty.has(entry.id) || !sameChangedRow(loaded, entry.file);
  });
}

/**
 * The entries worth fetching now: those `entriesToReload` names, limited to the
 * ones a reader can see (`needed`: expanded and near the viewport) or that sit
 * in the first `eagerCount` of `entries` (the first screenful), minus `skip`
 * (in flight, or failed since the last refresh). The rest stay as they are
 * until they are needed, dirty or never loaded.
 */
export function entriesToLoad(
  entries: readonly WorkingTreeDiffEntry[],
  loadedRows: ReadonlyMap<string, GitChangedFile>,
  dirty: ReadonlySet<string>,
  needed: ReadonlySet<string>,
  eagerCount: number,
  skip: ReadonlySet<string>,
): WorkingTreeDiffEntry[] {
  const eager = new Set(entries.slice(0, eagerCount).map((entry) => entry.id));
  return entriesToReload(entries, loadedRows, dirty).filter(
    (entry) => !skip.has(entry.id) && (needed.has(entry.id) || eager.has(entry.id)),
  );
}

type LoadedText = {
  binary: boolean;
  tooLarge: boolean;
  original: string;
  current: string;
  error?: string;
};

/**
 * The loaded diff to show after a reload: the previous object when it holds the
 * same texts, so its parsed blocks keep their identity and nothing re-highlights.
 */
export function reuseLoadedDiff<T extends LoadedText>(previous: T | undefined, next: T): T {
  if (
    previous &&
    !previous.error &&
    !next.error &&
    previous.binary === next.binary &&
    previous.tooLarge === next.tooLarge &&
    previous.original === next.original &&
    previous.current === next.current
  ) {
    return previous;
  }
  return next;
}
