import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, formatRelativeTime } from "./format";

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);

describe("formatRelativeTime", () => {
  it("reads as now within a minute and picks the largest fitting unit", () => {
    expect(formatRelativeTime(NOW - 20_000, { now: NOW, locale: "en" })).toBe("now");
    expect(formatRelativeTime(NOW - 3 * 60_000, { now: NOW, locale: "en" })).toBe("3 minutes ago");
    expect(formatRelativeTime(NOW - 2 * 3_600_000, { now: NOW, locale: "en" })).toBe("2 hours ago");
    expect(formatRelativeTime(NOW - 24 * 3_600_000, { now: NOW, locale: "en" })).toBe("yesterday");
    expect(formatRelativeTime(NOW + 3 * 86_400_000, { now: NOW, locale: "en" })).toBe("in 3 days");
    expect(formatRelativeTime(NOW - 400 * 86_400_000, { now: NOW, locale: "en" })).toBe(
      "last year",
    );
  });

  it("follows the requested locale and style", () => {
    expect(formatRelativeTime(NOW - 5 * 60_000, { now: NOW, locale: "tr" })).toBe("5 dakika önce");
    expect(
      formatRelativeTime(NOW - 5 * 60_000, { now: NOW, locale: "en", style: "narrow" }),
    ).toMatch(/5\s?m(in)?\.? ago/);
  });

  it("returns empty text for an invalid instant", () => {
    expect(formatRelativeTime(Number.NaN, { now: NOW })).toBe("");
  });
});

describe("formatBytes", () => {
  it("steps through units with one decimal below ten", () => {
    expect(formatBytes(512, { locale: "en" })).toBe("512 B");
    expect(formatBytes(1536, { locale: "en" })).toBe("1.5 KB");
    expect(formatBytes(12 * 1024 * 1024, { locale: "en" })).toBe("12 MB");
    expect(formatBytes(3.25 * 1024 ** 3, { locale: "en" })).toBe("3.3 GB");
    expect(formatBytes(1500, { locale: "en", base: 1000 })).toBe("1.5 KB");
  });

  it("rejects negative and non-finite input", () => {
    expect(formatBytes(-1)).toBe("");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("");
  });
});

describe("formatDuration", () => {
  it("formats compact labels", () => {
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(65_000)).toBe("1m 05s");
    expect(formatDuration(3_905_000)).toBe("1h 05m");
    expect(formatDuration(-5)).toBe("0s");
  });

  it("formats clock labels", () => {
    expect(formatDuration(42_000, { style: "clock" })).toBe("0:42");
    expect(formatDuration(3_909_000, { style: "clock" })).toBe("1:05:09");
  });
});
