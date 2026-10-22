import { Chunk } from "@codemirror/merge";
import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { inlineChunkMarks, splitChunkMarks } from "./editorOverview";

const doc = (value: string) => Text.of(value.split("\n"));

/** Lines are 10px tall; `widgetAtLine` adds a 25px block above that line. */
const block = (text: Text, widgetAtLine?: number) => (pos: number) => {
  const number = text.lineAt(pos).number;
  const extra = widgetAtLine !== undefined && number >= widgetAtLine ? 25 : 0;
  const top = (number - 1) * 10 + extra;
  return { top, bottom: top + 10 };
};

describe("inlineChunkMarks", () => {
  it("uses the editor's line blocks for added and modified hunks", () => {
    const original = doc("a\nb\nc\nd\ne\n");
    const current = doc("a\nB\nc\nd\nx\ny\n");
    const chunks = Chunk.build(original, current);
    expect(inlineChunkMarks(current, chunks, block(current))).toEqual([
      { kind: "mod", top: 10, bottom: 20, pos: 2 },
      { kind: "mod", top: 40, bottom: 60, pos: 8 },
    ]);
  });

  it("puts a deletion at the line it sits above, blocks included", () => {
    const original = doc("a\nb\nc\nd\n");
    const current = doc("a\nb\nd\n");
    const chunks = Chunk.build(original, current);
    const marks = inlineChunkMarks(current, chunks, block(current, 3));
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ kind: "del", top: 45, bottom: 55 });
  });
});

describe("splitChunkMarks", () => {
  it("spans whichever side has lines, in shared pixels", () => {
    const original = doc("a\nb\nc\nd\n");
    const added = doc("a\nb\nc\nd\ne\n");
    const marks = splitChunkMarks(
      Chunk.build(original, added),
      original,
      added,
      block(original),
      block(added),
    );
    expect(marks).toEqual([{ kind: "add", top: 40, bottom: 50, pos: 45 }]);

    const removed = doc("a\nc\nd\n");
    const del = splitChunkMarks(
      Chunk.build(original, removed),
      original,
      removed,
      block(original),
      block(removed),
    );
    expect(del[0]).toMatchObject({ kind: "del", top: 10, bottom: 20 });
  });
});
