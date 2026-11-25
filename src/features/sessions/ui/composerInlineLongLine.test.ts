import { describe, expect, it } from "vitest";
import {
  INLINE_LINE_LIMIT,
  INLINE_LINE_REARM,
  hasLongLine,
  keepsNativeField,
} from "./composerInlineLongLine";

describe("hasLongLine", () => {
  it("measures the longest line, not the draft", () => {
    expect(hasLongLine("a".repeat(INLINE_LINE_LIMIT - 1), INLINE_LINE_LIMIT)).toBe(false);
    expect(hasLongLine("a".repeat(INLINE_LINE_LIMIT), INLINE_LINE_LIMIT)).toBe(true);
    const lines = Array.from({ length: 200 }, () => "a".repeat(INLINE_LINE_LIMIT / 4)).join("\n");
    expect(lines.length).toBeGreaterThan(INLINE_LINE_LIMIT * 40);
    expect(hasLongLine(lines, INLINE_LINE_LIMIT)).toBe(false);
  });

  it.each(["\n", "\r\n", "\r"])("splits lines on %j like the editor does", (separator) => {
    const half = "a".repeat(INLINE_LINE_LIMIT - 1);
    expect(hasLongLine(half + separator + half, INLINE_LINE_LIMIT)).toBe(false);
    expect(hasLongLine(half + separator + half + "a", INLINE_LINE_LIMIT)).toBe(true);
  });
});

describe("keepsNativeField", () => {
  it("leaves at the limit and returns only well below it", () => {
    const between = "a".repeat((INLINE_LINE_LIMIT + INLINE_LINE_REARM) / 2);
    expect(keepsNativeField(between, false)).toBe(false);
    expect(keepsNativeField(between, true)).toBe(true);
    expect(keepsNativeField("a".repeat(INLINE_LINE_LIMIT), false)).toBe(true);
    expect(keepsNativeField("a".repeat(INLINE_LINE_REARM - 1), true)).toBe(false);
  });
});
