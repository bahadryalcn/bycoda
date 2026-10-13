import { describe, expect, it } from "vitest";
import {
  conflictReplacement,
  findConflictBlocks,
  hasConflictMarkers,
  resolveConflictMarkers,
  type ConflictSide,
} from "./conflictMarkers";

const TEXT = [
  "top",
  "<<<<<<< HEAD",
  "mine 1",
  "mine 2",
  "=======",
  "theirs 1",
  ">>>>>>> feature",
  "middle",
  "<<<<<<< HEAD",
  "=======",
  "added",
  ">>>>>>> feature",
  "bottom",
  "",
].join("\n");

describe("resolveConflictMarkers", () => {
  it("keeps the current side", () => {
    expect(resolveConflictMarkers(TEXT, "ours")).toBe("top\nmine 1\nmine 2\nmiddle\nbottom\n");
  });

  it("keeps the incoming side", () => {
    expect(resolveConflictMarkers(TEXT, "theirs")).toBe("top\ntheirs 1\nmiddle\nadded\nbottom\n");
  });

  it("keeps both sides, current first", () => {
    expect(resolveConflictMarkers(TEXT, "both")).toBe(
      "top\nmine 1\nmine 2\ntheirs 1\nmiddle\nadded\nbottom\n",
    );
  });

  it("drops the diff3 base section", () => {
    const diff3 = "<<<<<<< HEAD\nmine\n||||||| base\nold\n=======\ntheirs\n>>>>>>> x\n";
    expect(resolveConflictMarkers(diff3, "both")).toBe("mine\ntheirs\n");
  });

  it("preserves CRLF line endings", () => {
    const crlf = "a\r\n<<<<<<< HEAD\r\nmine\r\n=======\r\ntheirs\r\n>>>>>>> x\r\nb\r\n";
    expect(resolveConflictMarkers(crlf, "theirs")).toBe("a\r\ntheirs\r\nb\r\n");
  });

  it("leaves an unterminated block and plain text untouched", () => {
    const broken = "a\n<<<<<<< HEAD\nmine\n=======\ntheirs\n";
    expect(resolveConflictMarkers(broken, "ours")).toBe(broken);
    expect(resolveConflictMarkers("a\n=======\nb\n", "ours")).toBe("a\n=======\nb\n");
  });
});

describe("hasConflictMarkers", () => {
  it("detects an opening marker", () => {
    expect(hasConflictMarkers(TEXT)).toBe(true);
    expect(hasConflictMarkers(resolveConflictMarkers(TEXT, "both"))).toBe(false);
    expect(hasConflictMarkers("<<<<<<<< eight\n")).toBe(false);
  });
});

const DIFF3 = "a\n<<<<<<< HEAD\nmine\n||||||| base\nold\n=======\ntheirs\n>>>>>>> feature\nb\n";

/** Resolve one block by splicing, the way the editor does. */
function resolveBlock(text: string, index: number, side: ConflictSide) {
  const block = findConflictBlocks(text)[index];
  return text.slice(0, block.from) + conflictReplacement(text, block, side) + text.slice(block.to);
}

describe("findConflictBlocks", () => {
  it("returns ranges and labels for several blocks", () => {
    const blocks = findConflictBlocks(TEXT);
    expect(blocks).toHaveLength(2);
    const [first, second] = blocks;
    expect(TEXT.slice(first.from, first.to)).toBe(
      "<<<<<<< HEAD\nmine 1\nmine 2\n=======\ntheirs 1\n>>>>>>> feature\n",
    );
    expect(TEXT.slice(first.ours.from, first.ours.to)).toBe("mine 1\nmine 2\n");
    expect(TEXT.slice(first.theirs.from, first.theirs.to)).toBe("theirs 1\n");
    expect(first.base).toBeNull();
    expect([first.startLine, first.endLine]).toEqual([2, 7]);
    expect(first.markerLines).toEqual({ ours: 2, base: null, split: 5, theirs: 7 });
    expect([first.ours.startLine, first.ours.endLine]).toEqual([3, 4]);
    expect([first.theirs.startLine, first.theirs.endLine]).toEqual([6, 6]);
    expect([first.oursLabel, first.theirsLabel]).toEqual(["HEAD", "feature"]);
    expect([second.startLine, second.endLine]).toEqual([9, 12]);
    // An empty side is an empty range, not a missing one.
    expect(second.ours.from).toBe(second.ours.to);
    expect(second.ours.endLine).toBe(second.ours.startLine - 1);
  });

  it("reads the diff3 base section and its label", () => {
    const [block] = findConflictBlocks(DIFF3);
    expect(block.base).not.toBeNull();
    expect(DIFF3.slice(block.base!.from, block.base!.to)).toBe("old\n");
    expect(DIFF3.slice(block.ours.from, block.ours.to)).toBe("mine\n");
    expect(block.baseLabel).toBe("base");
    expect(block.markerLines.base).toBe(4);
    expect(resolveBlock(DIFF3, 0, "both")).toBe("a\nmine\ntheirs\nb\n");
    expect(resolveBlock(DIFF3, 0, "ours")).toBe("a\nmine\nb\n");
  });

  it("resolves one block and leaves the others", () => {
    expect(resolveBlock(TEXT, 1, "theirs")).toBe(
      [
        "top",
        "<<<<<<< HEAD",
        "mine 1",
        "mine 2",
        "=======",
        "theirs 1",
        ">>>>>>> feature",
        "middle",
        "added",
        "bottom",
        "",
      ].join("\n"),
    );
    expect(resolveBlock(TEXT, 0, "both")).toContain("mine 2\ntheirs 1\nmiddle\n<<<<<<< HEAD");
  });

  it("keeps CRLF exactly, in ranges and replacements", () => {
    const crlf = "a\r\n<<<<<<< HEAD\r\nmine\r\n=======\r\ntheirs\r\n>>>>>>> x\r\nb\r\n";
    const [block] = findConflictBlocks(crlf);
    expect(crlf.slice(block.ours.from, block.ours.to)).toBe("mine\r\n");
    expect(block.oursLabel).toBe("HEAD");
    expect(block.theirsLabel).toBe("x");
    expect(resolveBlock(crlf, 0, "both")).toBe("a\r\nmine\r\ntheirs\r\nb\r\n");
    expect(resolveBlock(crlf, 0, "ours")).toBe("a\r\nmine\r\nb\r\n");
  });

  it("composes with the editor's LF document and the CRLF restore on save", () => {
    const disk = "a\r\n<<<<<<< HEAD\r\nmine\r\n=======\r\ntheirs\r\n>>>>>>> x\r\nb\r\n";
    const doc = disk.replace(/\r\n/g, "\n");
    const resolved = resolveBlock(doc, 0, "both");
    expect(resolved.replace(/\n/g, "\r\n")).toBe(resolveBlock(disk, 0, "both"));
  });

  it("treats marker-looking lines inside the incoming side as content", () => {
    const text =
      "<<<<<<< a\nmine\n=======\nt1\n=======\n<<<<<<< nested\n||||||| no\n>>>>>>> b\nafter\n";
    const [block] = findConflictBlocks(text);
    expect(text.slice(block.theirs.from, block.theirs.to)).toBe(
      "t1\n=======\n<<<<<<< nested\n||||||| no\n",
    );
    expect(resolveConflictMarkers(text, "theirs")).toBe(
      "t1\n=======\n<<<<<<< nested\n||||||| no\nafter\n",
    );
  });

  it("does not read a base marker after the split", () => {
    const text = "<<<<<<< a\nm\n=======\n||||||| x\n>>>>>>> b\n";
    const [block] = findConflictBlocks(text);
    expect(block.base).toBeNull();
    expect(text.slice(block.theirs.from, block.theirs.to)).toBe("||||||| x\n");
  });

  it("needs a space or line end after the marker, and exactly seven characters", () => {
    expect(findConflictBlocks("<<<<<<<x\na\n=======\nb\n>>>>>>> y\n")).toEqual([]);
    expect(findConflictBlocks("<<<<<<< a\nm\n=======\nt\n>>>>>>>y\n")).toEqual([]);
    expect(findConflictBlocks("<<<<<<<\nm\n=======\nt\n>>>>>>>\n")).toHaveLength(1);
    expect(findConflictBlocks("<<<<<<<<  a\nm\n=======\nt\n>>>>>>> y\n")).toEqual([]);
  });

  it("leaves unterminated or malformed blocks alone", () => {
    for (const text of [
      "<<<<<<< a\nm\n",
      "<<<<<<< a\nm\n=======\nt\n",
      "<<<<<<< a\nm\n>>>>>>> b\n",
      "=======\n>>>>>>> b\n",
      "",
    ]) {
      expect(findConflictBlocks(text)).toEqual([]);
      expect(resolveConflictMarkers(text, "both")).toBe(text);
    }
  });

  it("lets an open block take a later opener as content", () => {
    const text = "<<<<<<< outer\nx\n<<<<<<< a\nm\n=======\nt\n>>>>>>> b\n";
    const blocks = findConflictBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].startLine).toBe(1);
    expect(blocks[0].oursLabel).toBe("outer");
    expect(text.slice(blocks[0].ours.from, blocks[0].ours.to)).toBe("x\n<<<<<<< a\nm\n");
  });

  it("handles blocks at the very start and end of the file", () => {
    const text =
      "<<<<<<< a\nm\n=======\nt\n>>>>>>> b\nmid\n<<<<<<< c\nm2\n=======\nt2\n>>>>>>> d\n";
    const blocks = findConflictBlocks(text);
    expect(blocks[0].from).toBe(0);
    expect(blocks[1].to).toBe(text.length);
    expect(resolveConflictMarkers(text, "both")).toBe("m\nt\nmid\nm2\nt2\n");
  });

  it("keeps a missing final newline missing", () => {
    const text = "a\n<<<<<<< x\nm\n=======\nt\n>>>>>>> y";
    const [block] = findConflictBlocks(text);
    expect(block.endsWithNewline).toBe(false);
    expect(block.to).toBe(text.length);
    expect(resolveConflictMarkers(text, "theirs")).toBe("a\nt");
    expect(resolveConflictMarkers(text, "both")).toBe("a\nm\nt");
  });

  it("removes a block whose chosen side is empty", () => {
    const text = "a\n<<<<<<< x\n=======\nt\n>>>>>>> y\nb\n";
    expect(resolveConflictMarkers(text, "ours")).toBe("a\nb\n");
    expect(resolveConflictMarkers("<<<<<<< x\n=======\n>>>>>>> y\n", "both")).toBe("");
  });
});
