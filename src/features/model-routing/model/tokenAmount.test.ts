import { describe, expect, it } from "vitest";
import {
  TOKEN_LADDER,
  formatTokenAmount,
  parseTokenAmount,
  shortTokenLabel,
  stepTokenAmount,
} from "./tokenAmount";

describe("parseTokenAmount", () => {
  it("treats empty text as no limit", () => {
    expect(parseTokenAmount("", "en")).toEqual({ ok: true, value: null });
    expect(parseTokenAmount("    ", "tr")).toEqual({ ok: true, value: null });
  });

  it("treats zero as no limit, matching the cap copy", () => {
    expect(parseTokenAmount("0", "en")).toEqual({ ok: true, value: null });
  });

  it("ignores the locale grouping separator and spaces", () => {
    expect(parseTokenAmount("5.000.000", "tr")).toEqual({ ok: true, value: 5_000_000 });
    expect(parseTokenAmount("5,000,000", "en")).toEqual({ ok: true, value: 5_000_000 });
    expect(parseTokenAmount("5 000 000", "fr")).toEqual({ ok: true, value: 5_000_000 });
    expect(parseTokenAmount("5 000 000", "fr")).toEqual({ ok: true, value: 5_000_000 });
    expect(parseTokenAmount("5.000.000", "de")).toEqual({ ok: true, value: 5_000_000 });
  });

  it("accepts K and M suffixes with the locale decimal separator", () => {
    expect(parseTokenAmount("500K", "en")).toEqual({ ok: true, value: 500_000 });
    expect(parseTokenAmount("500k", "en")).toEqual({ ok: true, value: 500_000 });
    expect(parseTokenAmount("5m", "en")).toEqual({ ok: true, value: 5_000_000 });
    expect(parseTokenAmount("1,5M", "tr")).toEqual({ ok: true, value: 1_500_000 });
    expect(parseTokenAmount("1.5M", "en")).toEqual({ ok: true, value: 1_500_000 });
    expect(parseTokenAmount("1,5M", "de")).toEqual({ ok: true, value: 1_500_000 });
    expect(parseTokenAmount("1,5 M", "fr")).toEqual({ ok: true, value: 1_500_000 });
    expect(parseTokenAmount("0,5K", "tr")).toEqual({ ok: true, value: 500 });
  });

  it("rejects non-integer results as decimal", () => {
    expect(parseTokenAmount("1234,5", "tr")).toEqual({ ok: false, reason: "decimal" });
    expect(parseTokenAmount("0,5", "tr")).toEqual({ ok: false, reason: "decimal" });
    expect(parseTokenAmount("1.5", "en")).toEqual({ ok: false, reason: "decimal" });
    expect(parseTokenAmount("0.0000001M", "en")).toEqual({ ok: false, reason: "decimal" });
    expect(parseTokenAmount("1,0000001M", "fr")).toEqual({ ok: false, reason: "decimal" });
  });

  it("rejects negative values", () => {
    expect(parseTokenAmount("-5", "en")).toEqual({ ok: false, reason: "negative" });
    expect(parseTokenAmount("−5M", "tr")).toEqual({ ok: false, reason: "negative" });
  });

  it("rejects garbage", () => {
    expect(parseTokenAmount("abc", "en")).toEqual({ ok: false, reason: "invalid" });
    expect(parseTokenAmount("K", "en")).toEqual({ ok: false, reason: "invalid" });
    expect(parseTokenAmount("5MK", "en")).toEqual({ ok: false, reason: "invalid" });
    expect(parseTokenAmount("1.2.3", "en")).toEqual({ ok: false, reason: "invalid" });
    expect(parseTokenAmount("5x", "en")).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("formatting", () => {
  it("formats integers with locale grouping and no fraction digits", () => {
    expect(formatTokenAmount(5_000_000, "en")).toBe("5,000,000");
    expect(formatTokenAmount(5_000_000, "tr")).toBe("5.000.000");
    expect(formatTokenAmount(5_000_000, "de")).toBe("5.000.000");
  });

  it("builds compact preset labels", () => {
    expect(shortTokenLabel(100_000, "en")).toBe("100K");
    expect(shortTokenLabel(1_000_000, "en")).toBe("1M");
    expect(shortTokenLabel(1_500_000, "en")).toBe("1.5M");
    expect(shortTokenLabel(1_500_000, "tr")).toMatch(/^1,5/);
  });

  it("round-trips formatted text through the parser", () => {
    for (const locale of ["tr", "en", "fr", "de"]) {
      expect(parseTokenAmount(formatTokenAmount(25_000_000, locale), locale)).toEqual({
        ok: true,
        value: 25_000_000,
      });
    }
  });
});

describe("stepTokenAmount", () => {
  it("has the requested preset ladder", () => {
    expect(TOKEN_LADDER.slice(0, 4)).toEqual([100_000, 250_000, 500_000, 1_000_000]);
    expect(TOKEN_LADDER.slice(-1)).toEqual([500_000_000]);
    expect(TOKEN_LADDER).toHaveLength(28);
    expect(TOKEN_LADDER).toEqual([...TOKEN_LADDER].sort((a, b) => a - b));
  });

  it("steps between presets", () => {
    expect(stepTokenAmount(1_000_000, 1)).toBe(2_000_000);
    expect(stepTokenAmount(1_000_000, -1)).toBe(500_000);
    expect(stepTokenAmount(5_000_000, 1)).toBe(10_000_000);
    expect(stepTokenAmount(25_000_000, 1)).toBe(30_000_000);
  });

  it("snaps in-between values to the nearest preset in the direction", () => {
    expect(stepTokenAmount(7_300_000, 1)).toBe(10_000_000);
    expect(stepTokenAmount(7_300_000, -1)).toBe(5_000_000);
    expect(stepTokenAmount(300_000, 1)).toBe(500_000);
    expect(stepTokenAmount(300_000, -1)).toBe(250_000);
  });

  it("handles the edges", () => {
    expect(stepTokenAmount(100_000, -1)).toBeNull();
    expect(stepTokenAmount(50_000, -1)).toBeNull();
    expect(stepTokenAmount(null, -1)).toBeNull();
    expect(stepTokenAmount(null, 1)).toBe(100_000);
    expect(stepTokenAmount(500_000_000, 1)).toBe(500_000_000);
    expect(stepTokenAmount(600_000_000, 1)).toBe(600_000_000);
  });
});
