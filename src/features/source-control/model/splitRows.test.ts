import { describe, expect, it } from "vitest";
import { buildSplitRows, type SplitRow } from "./splitRows";
import { buildUnifiedFile, type UnifiedLine } from "./unifiedDiff";
import {
  flattenVisibleRows,
  layoutRows,
  UNIFIED_FOLD_PX,
  UNIFIED_HUNK_PX,
  UNIFIED_LINE_PX,
  windowRows,
  type DiffViewRow,
} from "./unifiedDiffWindow";

function split(
  original: string,
  current: string,
  options: { context?: number; canStage?: boolean } = {},
) {
  const file = buildUnifiedFile(original, current, options.context);
  const rows = flattenVisibleRows(file.blocks, () => undefined, options.canStage ?? false);
  return { rows, split: buildSplitRows(rows) };
}

/** Compact view: `left|right` text per row, `-` for an empty cell. */
function shape(rows: readonly SplitRow[]): string[] {
  return rows.map((row) => {
    if (row.type === "fold") return `fold:${row.hidden}`;
    if (row.type === "hunk") return `hunk:${row.line.text}`;
    return `${row.left?.text ?? "-"}|${row.right?.text ?? "-"}`;
  });
}

const lines = (...text: string[]) => text.join("\n");

describe("buildSplitRows", () => {
  it("pairs a context line with itself and numbers both sides", () => {
    const { split: rows } = split(lines("a", "b", "c"), lines("a", "B", "c"));
    expect(shape(rows)).toEqual(["a|a", "b|B", "c|c"]);
    const first = rows[0];
    expect(first.type === "pair" && first.left === first.right).toBe(true);
    if (first.type === "pair") {
      expect(first.left?.oldNumber).toBe(1);
      expect(first.right?.newNumber).toBe(1);
    }
  });

  it("shows an unchanged file as one fold bar", () => {
    expect(shape(split(lines("a", "b"), lines("a", "b")).split)).toEqual(["fold:2"]);
  });

  it("leaves the left side empty for a pure addition", () => {
    const { split: rows } = split(lines("a", "b"), lines("a", "x", "y", "b"));
    expect(shape(rows)).toEqual(["a|a", "-|x", "-|y", "b|b"]);
  });

  it("leaves the right side empty for a pure deletion", () => {
    const { split: rows } = split(lines("a", "x", "y", "b"), lines("a", "b"));
    expect(shape(rows)).toEqual(["a|a", "x|-", "y|-", "b|b"]);
  });

  it("pairs a replacement of equal length line by line", () => {
    const { split: rows } = split(lines("a", "x", "y", "b"), lines("a", "p", "q", "b"));
    expect(shape(rows)).toEqual(["a|a", "x|p", "y|q", "b|b"]);
  });

  it("pads the right side when a replacement removes more than it adds", () => {
    const { split: rows } = split(lines("a", "x", "y", "z", "b"), lines("a", "p", "b"));
    expect(shape(rows)).toEqual(["a|a", "x|p", "y|-", "z|-", "b|b"]);
  });

  it("pads the left side when a replacement adds more than it removes", () => {
    const { split: rows } = split(lines("a", "x", "b"), lines("a", "p", "q", "r", "b"));
    expect(shape(rows)).toEqual(["a|a", "x|p", "-|q", "-|r", "b|b"]);
  });

  it("keeps separate blocks apart when context sits between them", () => {
    const { split: rows } = split(lines("x", "m", "y"), lines("p", "m", "q", "r"));
    expect(shape(rows)).toEqual(["x|p", "m|m", "y|q", "-|r"]);
  });

  it("pairs by order within a run even if an addition comes first", () => {
    const line = (kind: "add" | "del", text: string): DiffViewRow => ({
      type: "line",
      line: {
        kind,
        text,
        oldNumber: kind === "del" ? 1 : null,
        newNumber: kind === "add" ? 1 : null,
      },
      stage: false,
      height: UNIFIED_LINE_PX,
    });
    const rows = buildSplitRows([line("add", "n1"), line("del", "o1"), line("add", "n2")]);
    expect(shape(rows)).toEqual(["o1|n1", "-|n2"]);
  });

  it("passes fold bars through as full-width rows and ends blocks at them", () => {
    const original = Array.from({ length: 30 }, (_, i) => `l${i}`).join("\n");
    const current = original.replace("l0", "first").replace("l29", "last");
    const { split: rows } = split(original, current, { context: 1 });
    expect(shape(rows)).toEqual(["l0|first", "l1|l1", "fold:26", "l28|l28", "l29|last"]);
    const fold = rows.find((row) => row.type === "fold");
    expect(fold && fold.type === "fold" && fold.id).toBe("fold-0");
  });

  it("passes hunk separators through and ends the block before them", () => {
    const hunk = (text: string): UnifiedLine => ({
      kind: "hunk",
      text,
      oldNumber: null,
      newNumber: null,
    });
    const del = (text: string, n: number): UnifiedLine => ({
      kind: "del",
      text,
      oldNumber: n,
      newNumber: null,
    });
    const rows = flattenVisibleRows(
      [
        { kind: "hunk", lines: [hunk("@@ -1 +1 @@"), del("a", 1)] },
        { kind: "hunk", lines: [hunk("@@ -9 +9 @@"), del("b", 9)] },
      ],
      () => undefined,
    );
    expect(shape(buildSplitRows(rows))).toEqual([
      "hunk:@@ -1 +1 @@",
      "a|-",
      "hunk:@@ -9 +9 @@",
      "b|-",
    ]);
  });

  it("returns nothing for no rows, which is what placeholders have", () => {
    // Binary, too-large and empty-message files carry no blocks, so the view
    // shows its placeholder and never builds split rows for them.
    expect(buildSplitRows([])).toEqual([]);
  });

  it("handles empty files on either side", () => {
    expect(split("", "").split).toEqual([]);
    expect(shape(split("", lines("a", "b")).split)).toEqual(["-|a", "-|b"]);
    expect(shape(split(lines("a", "b"), "").split)).toEqual(["a|-", "b|-"]);
  });

  it("does not touch line text, including carriage returns", () => {
    const { split: rows } = split("a\r\nb\r\nc", "a\r\nB\r\nc");
    expect(shape(rows)).toEqual(["a\r|a\r", "b\r|B\r", "c|c"]);
    const changed = rows[1];
    expect(changed.type === "pair" && changed.left?.text).toBe("b\r");
    expect(changed.type === "pair" && changed.right?.text).toBe("B\r");
  });

  it("carries the hunk position for staging on rows with a changed side", () => {
    const original = lines("a", "x", "b");
    const current = lines("a", "p", "q", "b");
    const { split: rows } = split(original, current, { canStage: true });
    const staged = rows.filter((row) => row.type === "pair" && row.stagePos !== undefined);
    expect(staged).toHaveLength(2);
    expect(rows[0].type === "pair" && rows[0].stagePos).toBeUndefined();
    const inline = flattenVisibleRows(
      buildUnifiedFile(original, current).blocks,
      () => undefined,
      true,
    ).find((row) => row.type === "line" && row.stage);
    expect(inline).toBeDefined();
    expect(staged[0].type === "pair" && staged[0].stagePos).toBe(
      inline?.type === "line" ? inline.line.pos : -1,
    );
  });

  it("leaves stagePos unset when staging is off", () => {
    const { split: rows } = split("a", "b");
    expect(rows.every((row) => row.type !== "pair" || row.stagePos === undefined)).toBe(true);
  });

  it("keeps each row at its inline height, so the same windowing applies", () => {
    const original = Array.from({ length: 60 }, (_, i) => `l${i}`).join("\n");
    const current = original.replace("l30", "x\ny");
    const { rows, split: out } = split(original, current);
    for (const row of out) {
      expect(row.height).toBe(
        row.type === "fold"
          ? UNIFIED_FOLD_PX
          : row.type === "hunk"
            ? UNIFIED_HUNK_PX
            : UNIFIED_LINE_PX,
      );
    }
    // One removed line pairs with the first added one: one row shorter.
    const layout = layoutRows(out);
    expect(layout.totalHeight).toBe(layoutRows(rows).totalHeight - UNIFIED_LINE_PX);
    const window = windowRows(out, 0, 100, 0, layout);
    expect(window.start).toBe(0);
    expect(window.padTop).toBe(0);
    expect(window.padBottom).toBe(layout.totalHeight - layout.offsets[window.end]);
  });
});
