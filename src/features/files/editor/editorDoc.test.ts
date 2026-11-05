import { EditorState } from "@codemirror/state";
import { Chunk } from "@codemirror/merge";
import { describe, expect, it, vi } from "vitest";
import {
  detectLineEnding,
  editorDocChanges,
  normalizeLineBreaks,
  restoreLineEnding,
  restoreMixedLineEndings,
} from "./editorDoc";

describe("editorDocChanges", () => {
  it("returns no changes when the documents match", () => {
    expect(editorDocChanges("alpha\nbeta\n", "alpha\nbeta\n")).toEqual([]);
  });

  it("rewrites only the edited span so later matches keep their offsets", () => {
    const from = "const hello = 1;\nconst hello = 2;\n";
    const to = "const hello = 1;\nconst hallo = 2;\n";
    expect(editorDocChanges(from, to)).toEqual([{ from: 24, to: 25, insert: "a" }]);
  });

  it("maps a trailing-newline format as a small tail insert", () => {
    const from = "const hello = 1;";
    const to = "const hello = 1;\n";
    const changes = editorDocChanges(from, to);
    expect(changes).toEqual([{ from: 16, to: 16, insert: "\n" }]);
  });

  it("treats CRLF disk content as identical to the LF document", () => {
    expect(editorDocChanges("alpha\nbeta\n", "alpha\r\nbeta\r\n")).toEqual([]);
  });

  it("never doubles lines when the target uses CRLF", () => {
    const from = "alpha\nbeta\ngamma\n";
    const to = "alpha\r\nBETA\r\ngamma\r\n";
    const state = EditorState.create({ doc: from });
    const next = state.update({ changes: editorDocChanges(from, to) }).state;
    // Pre-fix this produced "alpha\n\nBETA\n\ngamma\n\n": the lone "\r"
    // inserts were converted into line breaks by CodeMirror.
    expect(next.doc.toString()).toBe("alpha\nBETA\ngamma\n");
  });

  it("keeps a later search selection on the same match after an earlier edit", () => {
    const from = "const hello = 1;\nconst hello = 2;\n";
    const to = "const hallo = 1;\nconst hello = 2;\n";
    const second = from.indexOf("hello", from.indexOf("hello") + 1);
    const state = EditorState.create({
      doc: from,
      selection: { anchor: second, head: second + 5 },
    });
    const next = state.update({ changes: editorDocChanges(from, to) }).state;
    expect(next.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe("hello");
    expect(next.doc.lineAt(next.selection.main.from).number).toBe(2);
  });
});

describe("line-ending round trip", () => {
  it.each(["alpha\nbeta\n", "alpha\r\nbeta\r\n", "alpha\rbeta\r"])(
    "load then save leaves %j byte-identical",
    (raw) => {
      // The FileEditor load/save contract: normalize into the LF document,
      // restore the file's own convention on write.
      const restored = restoreLineEnding(normalizeLineBreaks(raw), detectLineEnding(raw));
      expect(restored).toBe(raw);
    },
  );
});

describe("mixed line ending provenance", () => {
  it("preserves a short unchanged separator between nearby edits", () => {
    expect(restoreMixedLineEndings("new\nx\nother\n", "old\r\nx\rold\n")).toBe("new\r\nx\rother\n");
  });
  it("chooses the majority and breaks ties by first appearance", () => {
    expect(detectLineEnding("a\r\nb\nc\n")).toBe("\n");
    expect(detectLineEnding("a\rb\rc\n")).toBe("\r");
    expect(detectLineEnding("a\nb\r\n")).toBe("\n");
    expect(detectLineEnding("no breaks")).toBe("\n");
  });
  it("refuses an imprecise diff instead of rewriting unknown separators", () => {
    const build = vi.spyOn(Chunk, "build").mockReturnValueOnce([{ precise: false }] as never);
    try {
      expect(() => restoreMixedLineEndings("changed\nsecond\n", "first\r\nsecond\n")).toThrow(
        "Cannot safely preserve mixed line endings",
      );
    } finally {
      build.mockRestore();
    }
  });
  it("retains every separator in a large file with distant sparse edits", () => {
    const lines = Array.from({ length: 12_000 }, (_, i) => `line-${i}`);
    const raw = lines
      .map((line, i) => line + (i % 3 === 0 ? "\r\n" : i % 3 === 1 ? "\n" : "\r"))
      .join("");
    const edited = normalizeLineBreaks(raw)
      .replace("line-10\n", "LINE-10\n")
      .replace("line-11990\n", "LINE-11990\n");
    expect(restoreMixedLineEndings(edited, raw)).toBe(
      raw.replace("line-10\n", "LINE-10\n").replace("line-11990\r", "LINE-11990\r"),
    );
  });
  it("round trips and preserves separators around edits and undo", () => {
    const raw = "first\r\nsecond\nthird\rfourth\r\n";
    const original = normalizeLineBreaks(raw);
    expect(restoreMixedLineEndings(original, raw)).toBe(raw);
    expect(restoreMixedLineEndings("FIRST\nsecond\nnew\nthird\nfourth\n", raw)).toBe(
      "FIRST\r\nsecond\nnew\r\nthird\rfourth\r\n",
    );
    expect(restoreMixedLineEndings("first\nthird\nfourth\n", raw)).toBe(
      "first\r\nthird\rfourth\r\n",
    );
    expect(restoreMixedLineEndings(original, raw)).toBe(raw);
    expect(restoreMixedLineEndings("first\nsecond\nthird\nfourth", raw)).toBe(
      "first\r\nsecond\nthird\rfourth",
    );
  });
});
