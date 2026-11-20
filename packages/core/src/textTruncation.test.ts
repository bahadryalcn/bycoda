import { describe, expect, it } from "vitest";
import { limitSection } from "./jsonText.ts";
import { sanitizeThreadTitle } from "./sessionTitle.ts";

const LONE_SURROGATE_AT_END = /[\uD800-\uDBFF]$|[\uDC00-\uDFFF]$/;

describe("title and prompt truncation by grapheme", () => {
  it("never leaves a lone surrogate when a long title is cut inside an emoji", () => {
    // 46 letters + five rockets: 51 graphemes, 56 code units.
    // Old slice(0, 47) kept 46 letters plus one high surrogate of the second rocket.
    const title = sanitizeThreadTitle(`${"a".repeat(46)}${"🚀".repeat(5)}`);
    expect(title).toBe(`${"a".repeat(46)}🚀...`);
    expect(LONE_SURROGATE_AT_END.test(title)).toBe(false);
  });

  it("keeps a title that is within 50 graphemes even when it has more code units", () => {
    // 46 letters + one flag (2 code points, 4 units) + 2 letters: 49 graphemes, 52 units.
    const normalized = `${"x".repeat(46)}🇹🇷yy`;
    expect(sanitizeThreadTitle(normalized)).toBe(normalized);
  });

  it("cuts a title of astral CJK characters on character boundaries", () => {
    const title = sanitizeThreadTitle("𠀀".repeat(60));
    expect(title).toBe(`${"𠀀".repeat(47)}...`);
    expect(LONE_SURROGATE_AT_END.test(title)).toBe(false);
  });

  it("truncates a prompt section by graphemes and keeps the marker", () => {
    expect(limitSection("🚀🚀🚀", 2)).toBe("🚀🚀\n\n[truncated]");
    expect(limitSection("🚀🚀", 2)).toBe("🚀🚀");
  });
});
