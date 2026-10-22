import { describe, expect, it } from "vitest";
import { splitRowMarks, unifiedRowMarks } from "./diffOverview";
import { buildSplitRows } from "./splitRows";
import type { UnifiedLine } from "./unifiedDiff";
import {
  flattenVisibleRows,
  layoutRows,
  UNIFIED_LINE_PX,
  type DiffViewRow,
} from "./unifiedDiffWindow";

const H = UNIFIED_LINE_PX;

const line = (kind: UnifiedLine["kind"], n: number): UnifiedLine => ({
  kind,
  text: `l${n}`,
  oldNumber: kind === "add" ? null : n,
  newNumber: kind === "del" ? null : n,
});

const row = (kind: UnifiedLine["kind"], n: number): DiffViewRow => ({
  type: "line",
  line: line(kind, n),
  stage: false,
  height: H,
});

describe("unifiedRowMarks", () => {
  it("marks runs of added and removed rows at their real offsets", () => {
    const rows = [
      row("context", 1),
      row("del", 2),
      row("del", 3),
      row("add", 2),
      row("context", 4),
      row("add", 5),
    ];
    expect(unifiedRowMarks(rows, layoutRows(rows))).toEqual([
      { kind: "del", top: H, bottom: 3 * H, pos: 2 * H },
      { kind: "add", top: 3 * H, bottom: 4 * H, pos: 3.5 * H },
      { kind: "add", top: 5 * H, bottom: 6 * H, pos: 5.5 * H },
    ]);
  });

  it("counts a fold bar as height but not as a change", () => {
    const rows = flattenVisibleRows(
      [
        {
          kind: "fold",
          id: "f",
          lines: Array.from({ length: 30 }, (_, i) => line("context", i)),
        },
        { kind: "hunk", lines: [line("add", 31)] },
      ],
      () => undefined,
    );
    const layout = layoutRows(rows);
    const marks = unifiedRowMarks(rows, layout);
    expect(marks).toHaveLength(1);
    expect(marks[0].top).toBe(layout.totalHeight - H);
  });
});

describe("splitRowMarks", () => {
  it("tells modified, added and removed rows apart", () => {
    const rows = buildSplitRows([
      row("context", 1),
      row("del", 2),
      row("add", 2),
      row("context", 3),
      row("add", 4),
      row("context", 5),
      row("del", 6),
    ]);
    const marks = splitRowMarks(rows, layoutRows(rows));
    expect(marks.map((mark) => [mark.kind, mark.top])).toEqual([
      ["mod", H],
      ["add", 3 * H],
      ["del", 5 * H],
    ]);
  });
});
