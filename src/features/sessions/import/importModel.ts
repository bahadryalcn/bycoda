import type { ImportCandidate, ImportProvider } from "../../../platform/tauri/sessionImport";
import { isEqualOrInside, pathKey, slash } from "../../../shared/lib/paths";

/** Opens the import dialog from anywhere (rail menu, Settings). */
export const OPEN_SESSION_IMPORT_EVENT = "bycoda:open-session-import";
/** Canonical import owners notify the existing recents/history refresh owner. */
export const SESSION_HISTORY_IMPORTED_EVENT = "bycoda:session-history-imported";

export type SessionImportContext = { cwd: string; provider: ImportProvider };

export function requestSessionImport(context: SessionImportContext): void {
  window.dispatchEvent(new CustomEvent(OPEN_SESSION_IMPORT_EVENT, { detail: context }));
}

/** Identity of a provider conversation, as the store records it. */
export function candidateKey(candidate: ImportCandidate): string {
  return `${candidate.provider}:${candidate.providerSessionId}`;
}

/**
 * The Bycoda session an import creates. Derived from the provider id, so the
 * store itself refuses a second copy even when two imports race.
 */
export function importedSessionId(candidate: ImportCandidate): string {
  return `imp-${candidate.provider}-${candidate.providerSessionId}`;
}

/** Already in Bycoda: bound to this provider conversation, or imported earlier. */
export function isAlreadyImported(
  candidate: ImportCandidate,
  storedKeys: ReadonlySet<string>,
): boolean {
  return storedKeys.has(candidateKey(candidate)) || storedKeys.has(importedSessionId(candidate));
}

export type ImportFilters = {
  providers: ReadonlySet<ImportProvider>;
  text: string;
  /** Only conversations whose folder is this folder or inside it. */
  root: string | null;
  /** Non-interactive runs and subagent threads. Hidden unless asked for. */
  showAutomation: boolean;
};

export function filterCandidates(
  candidates: readonly ImportCandidate[],
  filters: ImportFilters,
): ImportCandidate[] {
  const needle = filters.text.trim().toLocaleLowerCase();
  return candidates.filter((candidate) => {
    if (!filters.providers.has(candidate.provider)) return false;
    if (!filters.showAutomation && candidate.kind !== "interactive") return false;
    if (filters.root && !isEqualOrInside(candidate.cwd, filters.root)) {
      return false;
    }
    if (!needle) return true;
    return (
      candidate.firstPrompt.toLocaleLowerCase().includes(needle) ||
      slash(candidate.cwd).toLocaleLowerCase().includes(needle)
    );
  });
}

export type FolderGroup = {
  /** Case-insensitive identity of the folder. */
  key: string;
  path: string;
  /** False once the folder was deleted or renamed. */
  exists: boolean;
  /** Newest first. */
  items: ImportCandidate[];
  lastAt: number;
};

/** Conversations grouped by the folder they ran in, most recently active folder first. */
export function groupByFolder(candidates: readonly ImportCandidate[]): FolderGroup[] {
  const groups = new Map<string, FolderGroup>();
  for (const candidate of [...candidates].sort((a, b) => b.lastAt - a.lastAt)) {
    const key = pathKey(candidate.cwd);
    const group = groups.get(key);
    if (group) {
      group.items.push(candidate);
      group.exists ||= candidate.cwdExists;
    } else {
      groups.set(key, {
        key,
        path: slash(candidate.cwd),
        exists: candidate.cwdExists,
        items: [candidate],
        lastAt: candidate.lastAt,
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.lastAt - a.lastAt);
}

/**
 * The drive most conversations ran on, for the quick "only under" filter.
 * `null` when everything is on one drive, where the filter would do nothing.
 */
export function dominantRoot(candidates: readonly ImportCandidate[]): string | null {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const drive = /^([A-Za-z]):/.exec(candidate.cwd)?.[1];
    if (!drive) continue;
    const root = `${drive.toUpperCase()}:/`;
    counts.set(root, (counts.get(root) ?? 0) + 1);
  }
  if (counts.size < 2) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export type ImportCounts = {
  /** Selected and not yet in Bycoda: what the button will import. */
  toImport: number;
  /** Selected but already imported: skipped. */
  alreadyImported: number;
  folders: number;
  bytes: number;
};

export function countSelection(
  candidates: readonly ImportCandidate[],
  selected: ReadonlySet<string>,
  storedKeys: ReadonlySet<string>,
): ImportCounts {
  const counts: ImportCounts = {
    toImport: 0,
    alreadyImported: 0,
    folders: 0,
    bytes: 0,
  };
  const folders = new Set<string>();
  for (const candidate of candidates) {
    if (!selected.has(candidateKey(candidate))) continue;
    if (isAlreadyImported(candidate, storedKeys)) {
      counts.alreadyImported += 1;
      continue;
    }
    counts.toImport += 1;
    counts.bytes += candidate.sizeBytes;
    folders.add(pathKey(candidate.cwd));
  }
  counts.folders = folders.size;
  return counts;
}
