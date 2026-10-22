export type StageReplacement = { from: number; to: number; insert: string };

/** Apply reviewed, non-overlapping index-text replacements without touching the
 * worktree. Desktop chunk staging and mobile line selection share this owner. */
export function applyStageReplacements(original: string, replacements: readonly StageReplacement[]): string {
  let cursor = 0;
  const parts: string[] = [];
  for (const change of replacements) {
    if (!Number.isSafeInteger(change.from) || !Number.isSafeInteger(change.to) || change.from < cursor || change.to < change.from || change.to > original.length)
      throw new Error("Invalid selective staging range");
    parts.push(original.slice(cursor, change.from), change.insert);
    cursor = change.to;
  }
  parts.push(original.slice(cursor));
  return parts.join("");
}
