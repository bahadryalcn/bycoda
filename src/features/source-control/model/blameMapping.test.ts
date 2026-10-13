import { ChangeSet, EditorState, type ChangeSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { blameByLine, mapBlameLines } from "./blameMapping";

/** One entry per line: the line's own text, so a result is easy to read. */
function entriesFor(text: string): (string | null)[] {
  return text.split("\n");
}

function map(text: string, spec: ChangeSpec, entries = entriesFor(text)) {
  const state = EditorState.create({ doc: text });
  const tr = state.update({ changes: spec });
  return {
    mapped: mapBlameLines(entries, state.doc, tr.changes, tr.state.doc),
    next: tr.state.doc.toString(),
  };
}

describe("mapBlameLines", () => {
  const text = "one\ntwo\nthree\nfour";

  it("shifts lines down when lines are inserted above", () => {
    const { mapped, next } = map(text, { from: 0, insert: "new a\nnew b\n" });
    expect(next).toBe("new a\nnew b\none\ntwo\nthree\nfour");
    expect(mapped).toEqual([null, null, "one", "two", "three", "four"]);
  });

  it("keeps the line when a new line is inserted just above it", () => {
    const { mapped } = map(text, { from: 4, insert: "x\n" });
    expect(mapped).toEqual(["one", null, "two", "three", "four"]);
  });

  it("keeps the line a new line was pushed below", () => {
    const { mapped } = map(text, { from: 3, insert: "\nx" });
    expect(mapped).toEqual(["one", null, "two", "three", "four"]);
  });

  it("drops deleted lines and keeps the rest", () => {
    const { mapped, next } = map(text, { from: 4, to: 14 });
    expect(next).toBe("one\nfour");
    expect(mapped).toEqual(["one", "four"]);
  });

  it("unblames a line edited inside, and only that line", () => {
    const { mapped } = map(text, { from: 5, to: 6, insert: "W" });
    expect(mapped).toEqual(["one", null, "three", "four"]);
  });

  it("unblames the split halves of a line", () => {
    const { mapped } = map(text, { from: 9, insert: "\n" });
    expect(mapped).toEqual(["one", "two", null, null, "four"]);
  });

  it("unblames the joined line when a break is removed", () => {
    const { mapped, next } = map(text, { from: 3, to: 4 });
    expect(next).toBe("onetwo\nthree\nfour");
    expect(mapped).toEqual([null, "three", "four"]);
  });

  it("merges several edits on one line", () => {
    const { mapped } = map(text, [
      { from: 4, insert: "a" },
      { from: 7, insert: "b" },
    ]);
    expect(mapped).toEqual(["one", null, "three", "four"]);
  });

  it("handles separate edits on different lines", () => {
    const { mapped } = map(text, [
      { from: 0, insert: "top\n" },
      { from: 14, to: 18, insert: "FOUR" },
    ]);
    expect(mapped).toEqual([null, "one", "two", "three", null]);
  });

  it("drops everything when the whole document is replaced", () => {
    const { mapped, next } = map(text, {
      from: 0,
      to: text.length,
      insert: "alpha\nbeta",
    });
    expect(next).toBe("alpha\nbeta");
    expect(mapped).toEqual([null, null]);
  });

  it("keeps lines a replacement leaves as they were", () => {
    const { mapped } = map(text, {
      from: 0,
      to: text.length,
      insert: "one\nTWO\nthree\nfour",
    });
    expect(mapped).toEqual(["one", null, "three", "four"]);
  });

  it("leaves one empty line when the document is cleared", () => {
    const { mapped } = map(text, { from: 0, to: text.length, insert: "" });
    expect(mapped).toEqual([null]);
  });

  it("appends at the end of the file", () => {
    const { mapped } = map(text, { from: text.length, insert: "\nfive" });
    expect(mapped).toEqual(["one", "two", "three", "four", null]);
  });

  it("does not move anything for an unchanged document", () => {
    const state = EditorState.create({ doc: text });
    const same = mapBlameLines(
      entriesFor(text),
      state.doc,
      ChangeSet.empty(text.length),
      state.doc,
    );
    expect(same).toEqual(entriesFor(text));
  });

  it("copes with an entry list of the wrong length", () => {
    const { mapped } = map(text, { from: 0, insert: "x\n" }, ["one", "two"]);
    expect(mapped).toEqual([null, "one", "two", null, null]);
  });

  it("composes across keystrokes the way the editor feeds it", () => {
    let state = EditorState.create({ doc: text });
    let entries = entriesFor(text);
    for (const spec of [
      { from: 4, insert: "t" },
      { from: 0, insert: "zero\n" },
      { from: 5, to: 9, insert: "" },
    ] satisfies ChangeSpec[]) {
      const tr = state.update({ changes: spec });
      entries = mapBlameLines(entries, state.doc, tr.changes, tr.state.doc);
      state = tr.state;
    }
    expect(state.doc.toString()).toBe("zero\nttwo\nthree\nfour");
    expect(entries).toEqual([null, null, "three", "four"]);
  });
});

describe("blameByLine", () => {
  it("places entries by line and leaves uncommitted and missing lines empty", () => {
    const blame = [
      { line: 1, sha: "abc123" },
      { line: 2, sha: "0000000000000000000000000000000000000000" },
      { line: 3, sha: "def456" },
    ];
    expect(blameByLine(blame, 4)).toEqual([blame[0], null, blame[2], null]);
    expect(blameByLine(blame, 2)).toEqual([blame[0], null]);
  });
});
