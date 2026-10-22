import type { ChangeSet, Text } from "@codemirror/state";

const UNCOMMITTED = /^0+$/;

/** Whether blame reports this sha for lines no commit has recorded yet. */
export function isUncommittedSha(sha: string): boolean {
  return UNCOMMITTED.test(sha);
}

/**
 * One slot per document line, `null` where no commit can be named: lines git
 * calls uncommitted, and lines past the end of what it blamed.
 */
export function blameByLine<T extends { line: number; sha: string }>(
  blame: readonly T[],
  lineCount: number,
): (T | null)[] {
  const lines: (T | null)[] = new Array(lineCount).fill(null);
  for (const entry of blame) {
    if (entry.line >= 1 && entry.line <= lineCount && !isUncommittedSha(entry.sha)) {
      lines[entry.line - 1] = entry;
    }
  }
  return lines;
}

type Stretch = {
  oldFirst: number;
  oldLast: number;
  newFirst: number;
  newLast: number;
};

/**
 * Carry per-line blame across an edit. `entries` describes `oldDoc`; the result
 * describes `newDoc`, which is `oldDoc` with `changes` applied.
 *
 * Lines the change never touched keep their entry, shifted to their new
 * number. Inside a touched stretch a line keeps its entry only if its text is
 * still the same as one at the same end of the old stretch (a line inserted
 * above, or a line deleted below, leaves its neighbours alone); everything
 * else becomes `null`, because the commit no longer describes it.
 */
export function mapBlameLines<T>(
  entries: readonly (T | null)[],
  oldDoc: Text,
  changes: ChangeSet,
  newDoc: Text,
): (T | null)[] {
  const old =
    entries.length === oldDoc.lines
      ? entries
      : Array.from({ length: oldDoc.lines }, (_, i) => entries[i] ?? null);

  const stretches: Stretch[] = [];
  changes.iterChanges((fromA, toA, fromB, toB) => {
    const next: Stretch = {
      oldFirst: oldDoc.lineAt(fromA).number,
      oldLast: oldDoc.lineAt(toA).number,
      newFirst: newDoc.lineAt(fromB).number,
      newLast: newDoc.lineAt(toB).number,
    };
    const last = stretches[stretches.length - 1];
    // Edits that share a line are one stretch.
    if (last && next.oldFirst <= last.oldLast) {
      last.oldLast = Math.max(last.oldLast, next.oldLast);
      last.newLast = next.newLast;
    } else stretches.push(next);
  });

  const out: (T | null)[] = [];
  let at = 0; // next old line (0-based) not yet copied
  for (const stretch of stretches) {
    for (; at < stretch.oldFirst - 1; at += 1) out.push(old[at]);
    const oldCount = stretch.oldLast - stretch.oldFirst + 1;
    const newCount = stretch.newLast - stretch.newFirst + 1;
    const limit = Math.min(oldCount, newCount);
    const same = (i: number, j: number) =>
      oldDoc.line(stretch.oldFirst + i).text === newDoc.line(stretch.newFirst + j).text;
    let head = 0;
    while (head < limit && same(head, head)) head += 1;
    let tail = 0;
    while (tail < limit - head && same(oldCount - 1 - tail, newCount - 1 - tail)) {
      tail += 1;
    }
    for (let i = 0; i < head; i += 1) out.push(old[at + i]);
    for (let i = head; i < newCount - tail; i += 1) out.push(null);
    for (let i = oldCount - tail; i < oldCount; i += 1) out.push(old[at + i]);
    at += oldCount;
  }
  for (; at < old.length; at += 1) out.push(old[at]);

  // A stretch that disagreed with the document would shift every line below it.
  if (out.length > newDoc.lines) out.length = newDoc.lines;
  while (out.length < newDoc.lines) out.push(null);
  return out;
}
