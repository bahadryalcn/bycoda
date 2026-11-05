import { describe, expect, it } from "vitest";
import {
  formatAttachmentSize,
  formatBytes,
  formatCompactCount,
  formatDuration,
  formatElapsed,
  formatFileSize,
  formatGitGraphRelativeTime,
  formatImportBytes,
  formatImportDate,
  formatArchiveDate,
  formatChatDate,
  formatRecentRelative,
  formatGitGraphAbsoluteTime,
  formatRelativeTime,
  formatTokens,
  formatUsageTokens,
} from "./format";
import { LANGUAGES } from "./languages";
import { getLanguagePreference, setLanguagePreference } from "./core";

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);

describe("legacy date labels", () => {
  it.each(LANGUAGES)("preserves import dates in $value", async ({ value }) => {
    const previous = getLanguagePreference();
    try {
      await setLanguagePreference(value);
      expect(formatElapsed(65_000)).toBe("1m 5s");
      expect(formatElapsed(3_600_000)).toBe("60m");
      expect(formatElapsed(null)).toBeNull();
      expect(formatImportDate(0)).toBe("unknown date");
      expect(formatImportDate(NOW)).toBe(
        new Date(NOW).toLocaleDateString(value, {
          year: "numeric",
          month: "short",
          day: "numeric",
        }),
      );
    } finally {
      await setLanguagePreference(previous);
    }
  });

  it("keeps runtime locale fallback, invalid values and calendar-year selection", () => {
    for (const at of [NOW, Date.UTC(2024, 0, 2, 12)]) {
      expect(formatArchiveDate(at)).toBe(
        new Intl.DateTimeFormat(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        }).format(new Date(at)),
      );
      expect(formatChatDate(at, NOW)).toBe(
        new Date(at).toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          ...(new Date(at).getFullYear() === new Date(NOW).getFullYear()
            ? {}
            : { year: "numeric" }),
        }),
      );
    }
    for (const at of [Number.NaN, 0, -1, Infinity]) expect(formatArchiveDate(at)).toBe("");
    expect(formatRecentRelative(NOW - 8 * 86_400_000, NOW)).toBe(
      new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
        new Date(NOW - 8 * 86_400_000),
      ),
    );
    expect(formatGitGraphAbsoluteTime(NOW / 1000, "tr", "UTC")).toBe(
      new Date(NOW).toLocaleString("tr", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }),
    );
  });
});

describe("legacy compact labels", () => {
  it("preserves byte and count rounding at unit boundaries", () => {
    expect([formatImportBytes(1536), formatAttachmentSize(1536), formatFileSize(1536)]).toEqual([
      "2 KB",
      "2 KB",
      "1.5 KB",
    ]);
    expect([formatTokens(1500), formatUsageTokens(1500)]).toEqual(["1.5K", "1.5K"]);
    expect([formatTokens(10_000), formatUsageTokens(10_000)]).toEqual(["10K", "10.0K"]);
    expect(formatAttachmentSize(0)).toBeNull();
  });
  it("keeps git graph ages in seconds", () => {
    expect(formatGitGraphRelativeTime(0, 59_000)).toBe("now");
    expect(formatGitGraphRelativeTime(0, 60_000)).toBe("1m");
    expect(formatGitGraphRelativeTime(0, 3_600_000)).toBe("1h");
    expect(formatGitGraphRelativeTime(0, 86_400_000)).toBe("1d");
  });
  it("preserves elapsed rounding and minute labels", () => {
    expect(formatElapsed(null)).toBeNull();
    expect(formatElapsed(0)).toBe("1s");
    expect(formatElapsed(59_500)).toBe("1m");
    expect(formatElapsed(3_661_000)).toBe("61m 1s");
  });

  it.each(LANGUAGES)("matches runtime compact formatting in $value", ({ value }) => {
    for (const count of [-1, 0, 999, 999.5, 1_234, 1_000_000, Number.NaN, Infinity]) {
      expect(formatCompactCount(count, value)).toBe(
        new Intl.NumberFormat(value, {
          notation: "compact",
          maximumFractionDigits: count >= 1000 ? 1 : 0,
        }).format(Math.max(0, Math.round(count))),
      );
    }
  });
});

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
