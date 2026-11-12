import { afterEach, expect, it, vi } from "vitest";
import { formatNumber, setLanguagePreference } from "./core";
import {
  formatChatDate,
  formatCompactCount,
  formatDays,
  formatGitGraphAbsoluteTime,
  formatImportDate,
} from "./format";

afterEach(async () => {
  vi.restoreAllMocks();
  await setLanguagePreference("en");
});

it("preserves native number outputs across locales and option orders", async () => {
  for (const locale of ["en", "tr", "de", "fr", "ja", "zh-CN"] as const) {
    await setLanguagePreference(locale);
    for (const options of [
      undefined,
      { maximumFractionDigits: 2 },
      { style: "percent" },
      { style: "currency", currency: "EUR" },
      { notation: "compact" },
    ] as const) {
      for (const value of [-1234567.891, -0, 0, 0.001, 1234.56, NaN, Infinity]) {
        expect(formatNumber(value, options)).toBe(
          new Intl.NumberFormat(locale, options).format(value),
        );
      }
    }
  }
});

it("constructs once per locale and deterministic options key", async () => {
  await setLanguagePreference("pt");
  const spy = vi.spyOn(Intl, "NumberFormat");
  for (let i = 0; i < 20; i++) {
    formatNumber(i, { minimumFractionDigits: 3, maximumFractionDigits: 4 });
    formatNumber(i, { maximumFractionDigits: 4, minimumFractionDigits: 3 });
  }
  expect(spy).toHaveBeenCalledTimes(1);
  await setLanguagePreference("es");
  expect(formatNumber(1.25, { minimumFractionDigits: 3, maximumFractionDigits: 4 })).toBe("1,250");
  expect(spy).toHaveBeenCalledTimes(2);
});

it("reuses unit and compact number formatters", () => {
  const spy = vi.spyOn(Intl, "NumberFormat");
  for (let i = 0; i < 20; i++) {
    formatDays(i, "pt");
    formatCompactCount(1400 + i, "pt");
  }
  expect(spy).toHaveBeenCalledTimes(2);
});

it("bounds the number cache to 64 option combinations", async () => {
  await setLanguagePreference("ja");
  const spy = vi.spyOn(Intl, "NumberFormat");
  const options = (i: number): Intl.NumberFormatOptions => ({
    signDisplay: "exceptZero",
    minimumIntegerDigits: (i % 21) + 1,
    maximumFractionDigits: Math.floor(i / 21),
  });
  for (let i = 0; i < 65; i++) formatNumber(i, options(i));
  expect(spy).toHaveBeenCalledTimes(65);
  formatNumber(0, options(0));
  expect(spy).toHaveBeenCalledTimes(66);
});

it("keeps native date output and invalid-date labels", async () => {
  const now = Date.UTC(2026, 10, 12);
  for (const locale of ["en", "tr", "de", "ja"] as const) {
    await setLanguagePreference(locale);
    for (const value of [now, now - 400 * 86400000, Infinity, NaN]) {
      const date = new Date(value);
      expect(formatImportDate(value)).toBe(
        !value
          ? "unknown date"
          : date.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" }),
      );
      expect(formatChatDate(value, now)).toBe(
        date.toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          ...(date.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }),
        }),
      );
      expect(formatGitGraphAbsoluteTime(value / 1000, locale, "UTC")).toBe(
        date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }),
      );
    }
  }
});
