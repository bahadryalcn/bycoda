import { expect, it } from "vitest";
import {
  SPLIT_MAX_LINES,
  SPLIT_MIN_WIDTH,
  diffLineCount,
  parseSplitDiff,
  resolveDiffLayout,
} from "./toolDiffSplit";

const patch = [
  "--- a/f.ts",
  "+++ b/f.ts",
  "@@ -10,4 +10,5 @@",
  " keep",
  "-old one",
  "-old two",
  "+new one",
  "+new two",
  "+new three",
  " tail",
].join("\n");

it("aligns removed and added runs side by side with real line numbers", () => {
  const rows = parseSplitDiff(patch);
  expect(
    rows.filter((row) => row.kind === "meta").map((row) => row.kind === "meta" && row.text),
  ).toEqual(["--- a/f.ts", "+++ b/f.ts", "@@ -10,4 +10,5 @@"]);
  const pairs = rows.flatMap((row) => (row.kind === "pair" ? [row] : []));
  expect(
    pairs.map((row) => [row.left?.number, row.left?.text, row.right?.number, row.right?.text]),
  ).toEqual([
    [10, "keep", 10, "keep"],
    [11, "old one", 11, "new one"],
    [12, "old two", 12, "new two"],
    [undefined, undefined, 13, "new three"],
    [13, "tail", 14, "tail"],
  ]);
});

it("numbers a patch without hunk headers from one", () => {
  const rows = parseSplitDiff("-a\n+b\n c");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({
    left: { number: 1, text: "a" },
    right: { number: 1, text: "b" },
  });
});

it("does not read a removed line that starts with dashes as a file header inside a hunk", () => {
  const rows = parseSplitDiff("@@ -1,2 +1,1 @@\n--- not a header\n-x\n+y");
  expect(rows[1]).toMatchObject({ left: { text: "-- not a header" } });
});

it("falls back to unified when narrow or very large, never by itself otherwise", () => {
  const size = { width: SPLIT_MIN_WIDTH, lines: 10 };
  expect(resolveDiffLayout("unified", size).layout).toBe("unified");
  expect(resolveDiffLayout("split", size)).toEqual({
    layout: "split",
    splitAvailable: true,
  });
  expect(resolveDiffLayout("split", { ...size, width: SPLIT_MIN_WIDTH - 1 })).toEqual({
    layout: "unified",
    splitAvailable: false,
  });
  expect(resolveDiffLayout("split", { ...size, lines: SPLIT_MAX_LINES + 1 }).layout).toBe(
    "unified",
  );
  expect(resolveDiffLayout("split", { width: 0, lines: 10 }).layout).toBe("unified");
});

it("counts lines", () => {
  expect(diffLineCount("a")).toBe(1);
  expect(diffLineCount("a\nb\nc")).toBe(3);
});
