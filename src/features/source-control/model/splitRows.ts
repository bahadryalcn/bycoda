import type { UnifiedLine } from "./unifiedDiff";
import {
  UNIFIED_FOLD_PX,
  UNIFIED_HUNK_PX,
  UNIFIED_LINE_PX,
  type DiffViewRow,
} from "./unifiedDiffWindow";

/**
 * One row of the side-by-side layout. `left` is the before side and `right`
 * the after side; a missing side is an empty cell. A context line is both
 * sides at once (the same object), so its line numbers come from `oldNumber`
 * on the left and `newNumber` on the right.
 */
export type SplitRow =
  | {
      type: "pair";
      left: UnifiedLine | null;
      right: UnifiedLine | null;
      /** Hunk position to stage from this row, when it can be staged. */
      stagePos?: number;
      height: number;
    }
  | { type: "hunk"; line: UnifiedLine; height: number }
  | { type: "fold"; id: string; hidden: number; height: number };

/**
 * Lay the inline rows out in two columns, without diffing anything again.
 *
 * Every run of changed lines between unchanged ones is one block: its removed
 * lines go on the left, its added lines on the right, and they pair up in
 * order. The shorter side is padded with empty cells, so a pure addition has
 * an empty left and a pure deletion an empty right. Hunk separators and fold
 * bars span both columns, and every row keeps the height its inline
 * counterpart has, so the windowing maths for the inline rows still applies.
 */
export function buildSplitRows(rows: readonly DiffViewRow[]): SplitRow[] {
  const out: SplitRow[] = [];
  let removed: Extract<DiffViewRow, { type: "line" }>[] = [];
  let added: Extract<DiffViewRow, { type: "line" }>[] = [];

  const flush = () => {
    const count = Math.max(removed.length, added.length);
    for (let index = 0; index < count; index += 1) {
      const left = removed[index];
      const right = added[index];
      out.push({
        type: "pair",
        left: left?.line ?? null,
        right: right?.line ?? null,
        stagePos: stagePosition(left, right),
        height: UNIFIED_LINE_PX,
      });
    }
    removed = [];
    added = [];
  };

  for (const row of rows) {
    if (row.type === "fold") {
      flush();
      out.push({
        type: "fold",
        id: row.id,
        hidden: row.hidden,
        height: UNIFIED_FOLD_PX,
      });
    } else if (row.line.kind === "del") {
      removed.push(row);
    } else if (row.line.kind === "add") {
      added.push(row);
    } else if (row.line.kind === "hunk") {
      flush();
      out.push({ type: "hunk", line: row.line, height: UNIFIED_HUNK_PX });
    } else {
      flush();
      out.push({
        type: "pair",
        left: row.line,
        right: row.line,
        height: UNIFIED_LINE_PX,
      });
    }
  }
  flush();
  return out;
}

function stagePosition(
  left: Extract<DiffViewRow, { type: "line" }> | undefined,
  right: Extract<DiffViewRow, { type: "line" }> | undefined,
): number | undefined {
  for (const row of [right, left]) {
    if (row?.stage && row.line.pos != null) return row.line.pos;
  }
  return undefined;
}
