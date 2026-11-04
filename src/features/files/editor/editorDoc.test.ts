import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  detectLineEnding,
  detectLineEndings,
  editorDocChanges,
  normalizeLineBreaks,
  restoreLineEnding,
  restoreLineEndings,
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
      expect(restoreLineEndings(normalizeLineBreaks(raw), raw)).toBe(raw);
    },
  );

  it("round-trips a pure-LF file without touching its bytes", () => {
    const raw = "#!/bin/sh\necho one\necho two\n";
    expect(detectLineEndings(raw)).toEqual({ eol: "\n", mixed: false });
    expect(restoreLineEndings(normalizeLineBreaks(raw), raw)).toBe(raw);
    expect(restoreLineEnding(normalizeLineBreaks(raw), detectLineEnding(raw))).toBe(raw);
  });
});

describe("detectLineEndings", () => {
  it("does not turn an LF file with one bare CR into a CR-only file", () => {
    const raw = "alpha\nbeta\rgamma\ndelta\n";
    // Pre-fix this reported "\r" and the next save rewrote every break.
    expect(detectLineEndings(raw)).toEqual({ eol: "\n", mixed: true });
    expect(detectLineEnding(raw)).toBe("\n");
  });

  it("keeps an LF script with one CRLF line on LF", () => {
    const raw = "#!/bin/sh\r\necho one\necho two\necho three\n";
    expect(detectLineEndings(raw)).toEqual({ eol: "\n", mixed: true });
  });

  it("reports CRLF for a CRLF file and CR for a CR-only file", () => {
    expect(detectLineEndings("alpha\r\nbeta\r\n")).toEqual({ eol: "\r\n", mixed: false });
    expect(detectLineEndings("alpha\rbeta\rgamma")).toEqual({ eol: "\r", mixed: false });
    expect(detectLineEndings("no breaks at all")).toEqual({ eol: "\n", mixed: false });
  });

  it("needs a strict majority: a tie or a plurality falls back to LF", () => {
    expect(detectLineEndings("a\r\nb\nc")).toEqual({ eol: "\n", mixed: true });
    expect(detectLineEndings("a\r\nb\r\nc\nd\re")).toEqual({ eol: "\n", mixed: true });
    expect(detectLineEndings("a\r\nb\r\nc\r\nd\ne\rf")).toEqual({ eol: "\r\n", mixed: true });
    expect(detectLineEndings("a\rb\rc\rd\ne")).toEqual({ eol: "\r", mixed: true });
  });
});

describe("restoreLineEndings", () => {
  it("leaves the breaks of unchanged lines in a mixed file alone", () => {
    const raw = "one\r\ntwo\nthree\r\nfour\n";
    const doc = normalizeLineBreaks(raw);
    expect(restoreLineEndings(doc, raw)).toBe(raw);
    expect(restoreLineEndings(doc.replace("two", "TWO"), raw)).toBe("one\r\nTWO\nthree\r\nfour\n");
    expect(restoreLineEndings(doc.replace("three", "3"), raw)).toBe("one\r\ntwo\n3\r\nfour\n");
  });

  it("gives new lines in a mixed file the majority convention", () => {
    const raw = "one\r\ntwo\r\nthree\nfour\r\n";
    const doc = normalizeLineBreaks(raw);
    expect(restoreLineEndings(doc.replace("two\n", "two\nnew\n"), raw)).toBe(
      "one\r\ntwo\r\nnew\r\nthree\nfour\r\n",
    );
    expect(restoreLineEndings(`${doc}five\nsix\n`, raw)).toBe(`${raw}five\r\nsix\r\n`);
  });

  it("keeps the breaks after a removed line aligned with the file", () => {
    const raw = "one\r\ntwo\rthree\nfour\r\nfive\n";
    const doc = normalizeLineBreaks(raw);
    expect(restoreLineEndings(doc.replace("two\n", ""), raw)).toBe("one\r\nthree\nfour\r\nfive\n");
  });
});
