import type { ProjectFile } from "../../../platform/tauri/fs";
import { prepareFuzzyQuery, scorePath, type FuzzyHit } from "../../../shared/lib/fuzzy";

export const MAX_RECENTS = 30;
const MAX_RESULTS = 80;

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

/** Mention menus also offer shallow folders and files when the query is empty. */
export function rankMentionCandidates(
  usable: ProjectFile[],
  query: string,
  recents: string[],
  limit = 30,
): RankedFile[] {
  const needle = query.replace(/\/+$/, "").trim();
  if (needle) return rankProjectFiles(usable, needle, recents, limit);

  const byPath = new Map(usable.map((file) => [file.path, file]));
  const out: RankedFile[] = [];
  const seen = new Set<string>();
  for (const path of recents) {
    const file = byPath.get(path);
    if (!file || seen.has(path)) continue;
    seen.add(path);
    out.push({ ...file, score: 0, positions: [] });
    if (out.length >= limit) return out;
  }

  const rest = [...usable].sort((a, b) => {
    const depth = pathDepth(a.relative) - pathDepth(b.relative);
    if (depth !== 0) return depth;
    const dir = Number(Boolean(b.isDir)) - Number(Boolean(a.isDir));
    if (dir !== 0) return dir;
    return a.relative.localeCompare(b.relative);
  });
  for (const file of rest) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    out.push({ ...file, score: 0, positions: [] });
    if (out.length >= limit) break;
  }
  return out;
}

function pathDepth(relative: string): number {
  let depth = 0;
  for (const ch of relative) if (ch === "/") depth += 1;
  return depth;
}
