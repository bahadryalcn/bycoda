import { listDir, listProjectFiles, statFiles, type ProjectFile } from "../../../platform/tauri/fs";
import { dirBelongsToRoot, subscribeDirsChanged } from "./fileTree";
import { prepareFuzzyQuery, scorePath, type FuzzyHit } from "../../../shared/lib/fuzzy";
import { resolveWorkspacePath, slash } from "../../../shared/lib/paths";
import { looksLikeProject } from "../../projects/model/recents";
import { REMOTE_PATH_PREFIX } from "../../../shared/lib/remotePaths";
import { normalizeEditorPath, type FileOpenOptions } from "../../search/model/search";

const MAX_RECENTS = 30;
const MAX_RESULTS = 80;
const REFRESH_MS = 150;
const CACHE_LIMIT = 8;

type Listener = () => void;

// Tabs in separate worktrees should not evict each other's file index.
const cache = new Map<string, ProjectFile[]>();
const inflight = new Map<string, Promise<ProjectFile[]>>();
let lastCwd: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshing = false;
let refreshAgain = false;
const listeners = new Set<Listener>();
const recentsByCwd = new Map<string, string[]>();
const remoteIndexes = new Map<
  string,
  {
    files?: ProjectFile[];
    loadedAt: number;
    pending?: Promise<ProjectFile[]>;
  }
>();
const REMOTE_INDEX_TTL_MS = 30_000;
const MAX_REMOTE_INDEXES = 12;

function normCwd(cwd: string): string {
  return slash(cwd).replace(/\/+$/, "") || "/";
}

function notifyProjectFilesChanged() {
  for (const listener of listeners) listener();
}

export function subscribeProjectFiles(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function peekProjectFiles(cwd: string): ProjectFile[] | null {
  if (cwd.startsWith(REMOTE_PATH_PREFIX)) return remoteIndexes.get(cwd)?.files ?? null;
  return cache.get(cwd) ?? null;
}

export function invalidateProjectFiles(cwd?: string) {
  if (!cwd) remoteIndexes.clear();
  else if (cwd.startsWith(REMOTE_PATH_PREFIX)) {
    remoteIndexes.delete(cwd);
    notifyProjectFilesChanged();
    return;
  }
  if (cwd) {
    if (!cache.has(cwd) && !inflight.has(cwd)) return;
    cache.delete(cwd);
    inflight.delete(cwd);
  } else {
    cache.clear();
    inflight.clear();
    lastCwd = null;
    if (refreshTimer != null) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  }
  notifyProjectFilesChanged();
}

function scheduleIndexRefresh() {
  if (!lastCwd) return;
  if (typeof document !== "undefined" && document.hidden) return;
  if (refreshTimer != null) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void runIndexRefresh();
  }, REFRESH_MS);
}

async function runIndexRefresh() {
  if (refreshing) {
    refreshAgain = true;
    return;
  }
  const cwd = lastCwd;
  if (!cwd) return;
  refreshing = true;
  try {
    await loadProjectFiles(cwd, true);
  } catch {
    /* next focus / dir change will retry */
  } finally {
    refreshing = false;
    if (refreshAgain) {
      refreshAgain = false;
      scheduleIndexRefresh();
    }
  }
}

export function rememberOpenedFile(cwd: string, path: string) {
  if (!path) return;
  const key = normCwd(cwd);
  const prev = recentsByCwd.get(key) ?? [];
  recentsByCwd.set(key, [path, ...prev.filter((item) => item !== path)].slice(0, MAX_RECENTS));
}

export function recentOpenedFiles(cwd: string): string[] {
  return recentsByCwd.get(normCwd(cwd)) ?? [];
}

export function prefetchProjectFiles(cwd: string) {
  if (!looksLikeProject(cwd)) return;
  void loadProjectFiles(cwd);
}

export function loadProjectFiles(cwd: string, refresh = false): Promise<ProjectFile[]> {
  if (!looksLikeProject(cwd)) return Promise.resolve([]);
  if (cwd.startsWith(REMOTE_PATH_PREFIX)) return loadRemoteProjectFiles(cwd, refresh);
  lastCwd = cwd;
  const cached = cache.get(cwd);
  if (!refresh && cached) {
    // Bound retained listings by least-recently-used worktree.
    cache.delete(cwd);
    cache.set(cwd, cached);
    return Promise.resolve(cached);
  }
  const pending = inflight.get(cwd);
  if (!refresh && pending) return pending;

  const promise = listProjectFiles(cwd)
    .then((files) => {
      // A refresh or invalidation supersedes only this checkout's scan.
      if (inflight.get(cwd) !== promise) return files;
      cache.delete(cwd);
      cache.set(cwd, files);
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
      notifyProjectFilesChanged();
      return files;
    })
    .finally(() => {
      if (inflight.get(cwd) === promise) inflight.delete(cwd);
    });
  inflight.set(cwd, promise);
  return promise;
}

function loadRemoteProjectFiles(cwd: string, refresh: boolean): Promise<ProjectFile[]> {
  let entry = remoteIndexes.get(cwd);
  if (entry?.pending) return entry.pending;
  if (!refresh && entry?.files && Date.now() - entry.loadedAt < REMOTE_INDEX_TTL_MS)
    return Promise.resolve(entry.files);
  if (!entry) {
    entry = { loadedAt: 0 };
    remoteIndexes.set(cwd, entry);
    for (const [key, value] of remoteIndexes) {
      if (remoteIndexes.size <= MAX_REMOTE_INDEXES) break;
      if (key !== cwd && !value.pending) remoteIndexes.delete(key);
    }
  }
  const current = entry;
  const pending = listProjectFiles(cwd)
    .then((files) => {
      if (remoteIndexes.get(cwd) === current) {
        current.files = files;
        current.loadedAt = Date.now();
        notifyProjectFilesChanged();
      }
      return files;
    })
    .finally(() => {
      if (current.pending === pending) current.pending = undefined;
    });
  current.pending = pending;
  return pending;
}

// Character postings are built once per immutable index. Filtering never drops a possible fuzzy hit.
const searchIndexes = new WeakMap<ProjectFile[], Map<string, ProjectFile[]>>();
function candidatesFor(files: ProjectFile[], tokens: string[]): ProjectFile[] {
  let index = searchIndexes.get(files);
  if (!index) {
    index = new Map();
    for (const file of files)
      for (const char of new Set((file.relative + file.name).toLowerCase().split(""))) {
        const posting = index.get(char);
        if (posting) posting.push(file);
        else index.set(char, [file]);
      }
    searchIndexes.set(files, index);
  }
  let best = files;
  for (const char of new Set(tokens.join("").split(""))) {
    const posting = index.get(char);
    if (!posting) return [];
    if (posting.length < best.length) best = posting;
  }
  return best;
}
export type RankedFile = ProjectFile & FuzzyHit;

export function rankProjectFiles(
  files: ProjectFile[],
  query: string,
  recents: string[],
  limit = MAX_RESULTS,
): RankedFile[] {
  const recentRank = new Map(recents.map((path, index) => [path, index]));

  if (!query.trim()) {
    const byPath = new Map(files.map((file) => [file.path, file]));
    const out: RankedFile[] = [];
    const seen = new Set<string>();
    for (const path of recents) {
      if (seen.has(path)) continue;
      seen.add(path);
      const file = byPath.get(path);
      if (!file) continue;
      out.push({ ...file, score: 0, positions: [] });
      if (out.length >= limit) break;
    }
    return out;
  }

  // Bounded selection under the picker's total order: only the best `limit`
  // hits are kept (best first), and result objects are built just for those.
  type Candidate = { file: ProjectFile; score: number; positions: number[] };
  const best: Candidate[] = [];
  const prepared = prepareFuzzyQuery(query);
  for (const file of candidatesFor(files, prepared.tokens)) {
    const hit = scorePath(prepared, file.relative, file.name);
    if (!hit) continue;
    const recency = recentRank.get(file.path);
    const score = hit.score + (recency == null ? 0 : (MAX_RECENTS - recency) * 8);
    if (best.length >= limit && score < best[best.length - 1].score) continue;
    const candidate: Candidate = { file, score, positions: hit.positions };
    // Insert after every candidate that does not rank below it, which keeps
    // ties in index order like a stable sort would.
    let at = best.length;
    while (at > 0 && compareRanked(best[at - 1], candidate) > 0) at -= 1;
    if (at >= limit) continue;
    best.splice(at, 0, candidate);
    if (best.length > limit) best.pop();
  }
  return best.map((item) => ({
    ...item.file,
    score: item.score,
    positions: item.positions,
  }));
}

function compareRanked(
  a: { file: ProjectFile; score: number },
  b: { file: ProjectFile; score: number },
): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.file.relative.length !== b.file.relative.length) {
    return a.file.relative.length - b.file.relative.length;
  }
  return a.file.relative.localeCompare(b.file.relative);
}

/** Resolve a transcript or markdown file link to an existing project file. */
export async function resolveOpenablePath(cwd: string, href: string): Promise<string | undefined> {
  const direct = resolveWorkspacePath(href, cwd);
  if (!direct) return undefined;

  // An existing file or folder wins over a same-named file in the index.
  const exists = await fileExists(direct);
  if (exists === true) return direct;

  let files: ProjectFile[];
  try {
    files = await loadProjectFiles(cwd);
  } catch {
    // The index only disambiguates shortened paths. Let the editor read the
    // direct path and show its own error if that file is unavailable too.
    return direct;
  }
  if (files.length === 0) return direct;

  const relHint = relativePathHint(href, cwd, direct);
  const indexed = indexedFile(files, cwd, direct, relHint);
  if (indexed) return indexed;
  if (exists === undefined) return direct;

  // Nothing is at the direct path. The file may be newer than the index, or
  // generated into an ignored folder, which the index leaves out.
  const fresh = await loadProjectFiles(cwd, true).catch(() => files);
  return (
    indexedFile(fresh, cwd, direct, relHint) ??
    (await findInIgnoredFolders(cwd, searchHint(relHint))) ??
    direct
  );
}

function indexedFile(
  files: ProjectFile[],
  cwd: string,
  direct: string,
  relHint: string,
): string | undefined {
  const byPath = new Map(files.map((file) => [normalizeEditorPath(file.path), file]));
  const normalizedDirect = normalizeEditorPath(direct);
  const exact = byPath.get(normalizedDirect);
  if (exact) return exact.path;

  const exactRelative = files.find(
    (file) => file.relative === relHint || normalizeEditorPath(file.relative) === relHint,
  );
  if (exactRelative) return exactRelative.path;

  const suffixMatches = files.filter(
    (file) =>
      file.relative === relHint ||
      file.relative.endsWith(`/${relHint}`) ||
      relHint.endsWith(`/${file.relative}`),
  );
  if (suffixMatches.length === 1) return suffixMatches[0].path;

  const baseName = relHint.split("/").filter(Boolean).pop() ?? relHint;
  const byName = files.filter((file) => file.name === baseName);
  if (byName.length === 0) return undefined;
  if (byName.length === 1) return byName[0].path;

  return pickOpenableFile(byName, cwd, relHint).path;
}

/** Unknown leaves fuzzy lookup available without forcing an expensive rescan. */
async function fileExists(path: string): Promise<boolean | undefined> {
  try {
    const [stat] = await statFiles([path]);
    return stat ? stat.isDir === true || stat.mtimeMs != null : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A path outside `cwd` (a remote path, or a drive path) can't be matched as a
 * suffix of a folder entry, so only its file name is searched for.
 */
function searchHint(relHint: string): string {
  if (!relHint.includes("://") && !/^[A-Za-z]:\//.test(relHint)) return relHint;
  return relHint.split("/").filter(Boolean).pop() ?? "";
}

const IGNORED_SEARCH_MAX_FOLDERS = 40;
const IGNORED_SEARCH_MAX_DEPTH = 4;
/** Ignored folders too large to walk, and never where output is written. */
const IGNORED_SEARCH_SKIPPED = new Set([
  ".git",
  "node_modules",
  ".pnpm-store",
  ".venv",
  "venv",
  "target",
]);

/**
 * Looks for `relHint` in the project's top-level ignored folders, breadth
 * first and within a small budget of listings.
 */
async function findInIgnoredFolders(cwd: string, relHint: string): Promise<string | undefined> {
  if (!relHint || relHint.includes("://") || /^[A-Za-z]:\//.test(relHint)) return undefined;
  const suffix = `/${relHint}`;
  const pending = [{ path: cwd, depth: 0, ignored: false }];
  for (let listed = 0; pending.length > 0 && listed < IGNORED_SEARCH_MAX_FOLDERS; listed += 1) {
    const folder = pending.shift()!;
    const entries = await listDir(folder.path).catch(() => []);
    for (const entry of entries) {
      if (!folder.ignored && !entry.ignored) continue;
      if (!entry.isDir) {
        if (slash(entry.path).endsWith(suffix)) return entry.path;
      } else if (
        !IGNORED_SEARCH_SKIPPED.has(entry.name) &&
        folder.depth < IGNORED_SEARCH_MAX_DEPTH
      ) {
        pending.push({
          path: entry.path,
          depth: folder.depth + 1,
          ignored: true,
        });
      }
    }
  }
  return undefined;
}

/** Resolve shortened references while preserving paths selected from file UI. */
export async function resolveFileOpenRequest(
  cwd: string,
  path: string,
  options?: FileOpenOptions,
): Promise<string> {
  if (options?.exact) return path;
  return (await resolveOpenablePath(cwd, path)) ?? path;
}

function relativePathHint(href: string, cwd: string, direct: string): string {
  let value = href.trim().replace(/\\/g, "/");
  value = value.replace(/(?::\d+(?::\d+)?|#L\d+(?:-L\d+)?)$/, "");
  if (value.startsWith("file://")) {
    try {
      value = decodeURIComponent(value.slice("file://".length));
    } catch {
      value = value.slice("file://".length);
    }
    value = value.replace(/\\/g, "/");
  }
  value = value.replace(/^\.\//, "").replace(/^\/+/, "");

  const base = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedDirect = normalizeEditorPath(direct);
  if (base && base !== "~" && normalizedDirect.startsWith(`${base}/`)) {
    return normalizedDirect.slice(base.length + 1);
  }
  return value;
}

function pickOpenableFile(candidates: ProjectFile[], cwd: string, relHint: string): ProjectFile {
  const recents = recentOpenedFiles(cwd);
  for (const recent of recents) {
    const normalizedRecent = normalizeEditorPath(recent);
    const hit = candidates.find((file) => normalizeEditorPath(file.path) === normalizedRecent);
    if (hit) return hit;
  }

  const suffixMatches = candidates.filter(
    (file) => file.relative === relHint || file.relative.endsWith(`/${relHint}`),
  );
  if (suffixMatches.length > 0) {
    return suffixMatches.sort((a, b) => a.relative.length - b.relative.length)[0];
  }

  return candidates.sort((a, b) => a.relative.length - b.relative.length)[0];
}

subscribeDirsChanged((_roots, paths) => {
  for (const [cwd, entry] of remoteIndexes) {
    if (!paths || paths.some((path) => dirBelongsToRoot(path, cwd))) entry.loadedAt = 0;
  }
  if (!paths || (lastCwd && paths.some((path) => dirBelongsToRoot(path, lastCwd!))))
    scheduleIndexRefresh();
});

if (typeof document !== "undefined") {
  const resume = () => {
    if (document.hidden) return;
    // Changes made outside Bycoda have no checkout-scoped notification.
    // Revalidate the active index and discard inactive snapshots on return.
    for (const cwd of new Set([...cache.keys(), ...inflight.keys()])) {
      if (cwd !== lastCwd) invalidateProjectFiles(cwd);
    }
    scheduleIndexRefresh();
  };
  window.addEventListener("focus", resume);
  document.addEventListener("visibilitychange", resume);
}
