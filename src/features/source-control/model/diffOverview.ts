import type { RulerKind, RulerMark } from "../../files/editor/overviewRuler";
import type { SplitRow } from "./splitRows";
import type { DiffViewRow, RowLayout, SizedRow } from "./unifiedDiffWindow";

/**
 * Overview-ruler marks for one file's rows, in pixels from the top of its
 * body. Rows have fixed heights, so the layout offsets are exact. Runs of
 * adjacent rows of one kind come out as a single mark.
 */
function runMarks<Row extends SizedRow>(
  rows: readonly Row[],
  layout: RowLayout,
  kindOf: (row: Row) => RulerKind | null,
): RulerMark[] {
  const marks: RulerMark[] = [];
  let open: RulerMark | null = null;
  for (let index = 0; index < rows.length; index += 1) {
    const kind = kindOf(rows[index]);
    if (!kind) {
      open = null;
      continue;
    }
    const top = layout.offsets[index];
    const bottom = layout.offsets[index + 1];
    if (open && open.kind === kind) {
      open.bottom = bottom;
      open.pos = (open.top + bottom) / 2;
    } else {
      open = { kind, top, bottom, pos: (top + bottom) / 2 };
      marks.push(open);
    }
  }
  return marks;
}

export function unifiedRowMarks(rows: readonly DiffViewRow[], layout: RowLayout): RulerMark[] {
  return runMarks(rows, layout, (row) =>
    row.type === "line" && (row.line.kind === "add" || row.line.kind === "del")
      ? row.line.kind
      : null,
  );
}

/** A row with lines on both sides is a modification; one side, add or delete. */
export function splitRowMarks(rows: readonly SplitRow[], layout: RowLayout): RulerMark[] {
  return runMarks(rows, layout, (row) => {
    if (row.type !== "pair" || row.left === row.right) return null;
    if (row.left && row.right) return "mod";
    return row.right ? "add" : "del";
  });
}
