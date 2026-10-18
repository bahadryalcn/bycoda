import { describe, expect, it } from "vitest";
import { fuzzyMatch, prepareFuzzyQuery, scorePath } from "./fuzzy";

describe("fuzzy highlight offsets", () => {
  it("maps lowercase expansions back to original UTF-16 positions", () => {
    expect(fuzzyMatch("file", "İFile")?.positions).toEqual([1, 2, 3, 4]);
    expect(fuzzyMatch("file", "İİFile")?.positions).toEqual([2, 3, 4, 5]);
    expect(fuzzyMatch("file", "😀İFile")?.positions).toEqual([3, 4, 5, 6]);
  });

  it("matches expanded query characters without duplicate highlight positions", () => {
    expect(fuzzyMatch("İ", "İ")?.positions).toEqual([0]);
    expect(fuzzyMatch("i", "İ")?.positions).toEqual([0]);
    expect(fuzzyMatch("\u0307", "İ")?.positions).toEqual([0]);
    expect(fuzzyMatch("İf", "İFile")?.positions).toEqual([0, 1]);
  });

  it("preserves supplementary-character code units and context-sensitive matching", () => {
    expect(fuzzyMatch("𐐨f", "İ𐐀File")?.positions).toEqual([1, 2, 3]);
    expect(fuzzyMatch("ος", "İΟΣ")?.positions).toEqual([1, 2]);
  });

  it("maps each prepared query token and filename offset", () => {
    expect(fuzzyMatch(prepareFuzzyQuery("file name"), "İFile İName")?.positions).toEqual([
      1, 2, 3, 4, 7, 8, 9, 10,
    ]);
    expect(scorePath("file", "src/İFile", "İFile")?.positions).toEqual([5, 6, 7, 8]);
    expect(scorePath("file", "İFile/other", "other")?.positions).toEqual([1, 2, 3, 4]);
  });

  it("keeps ASCII scores, misses and empty-query behavior", () => {
    expect(fuzzyMatch("file", "File")).toEqual({ score: 58, positions: [0, 1, 2, 3] });
    expect(fuzzyMatch("file", "src/File")).toEqual({ score: 54, positions: [4, 5, 6, 7] });
    expect(fuzzyMatch("f", "myFile")).toEqual({ score: 10, positions: [2] });
    expect(fuzzyMatch("missing", "İFile")).toBeNull();
    expect(fuzzyMatch(" ", "İFile")).toEqual({ score: 0, positions: [] });
  });

  it("uses original boundaries for scoring after an expansion", () => {
    expect(fuzzyMatch("file", "İ/File")).toEqual({ score: 55, positions: [2, 3, 4, 5] });
  });
});
