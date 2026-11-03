import { describe, expect, it } from "vitest";
import { graphemeLength, truncateCodeUnits, truncateGraphemes } from "./truncate";

describe("truncateGraphemes", () => {
  it("returns short text unchanged", () => {
    expect(truncateGraphemes("hello", 5)).toBe("hello");
    expect(truncateGraphemes("", 3)).toBe("");
  });

  it("never splits an emoji or a flag", () => {
    const text = "abc🚀🇹🇷def";
    expect(truncateGraphemes(text, 5)).toBe("abc🚀…");
    expect(truncateGraphemes(text, 6)).toBe("abc🚀🇹🇷…");
    expect(graphemeLength(text)).toBe(8);
    // A JSON round trip would throw on a lone surrogate; the result must stay well-formed.
    expect(() => JSON.parse(JSON.stringify(truncateGraphemes(text, 5)))).not.toThrow();
    expect(/[\uD800-\uDFFF]$/.test(truncateGraphemes(text, 5))).toBe(false);
  });

  it("keeps combining marks with their base character", () => {
    const text = "éäb"; // é ä b as combining sequences
    expect(truncateGraphemes(text, 2)).toBe("é…");
    expect(graphemeLength(text)).toBe(3);
  });

  it("counts the suffix toward the budget", () => {
    expect(truncateGraphemes("abcdefgh", 4, "...")).toBe("a...");
    expect(truncateGraphemes("abcdefgh", 4)).toBe("abc…");
    expect(truncateGraphemes("abcdefgh", 0)).toBe("");
  });
});

describe("truncateCodeUnits", () => {
  it("drops a dangling high surrogate", () => {
    expect(truncateCodeUnits("ab🚀", 3)).toBe("ab");
    expect(truncateCodeUnits("ab🚀", 4)).toBe("ab🚀");
    expect(truncateCodeUnits("abc", 10)).toBe("abc");
  });
});
