// @vitest-environment happy-dom
import { act, createElement, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { boundFormat } from "./boundFormat";
import { formatDate, formatNumber, setLanguagePreference, useFormat } from "./index";
import {
  formatBytes,
  formatChatDate,
  formatDays,
  formatDuration,
  formatGithubRelativeTime,
  formatRelativeTime,
} from "./format";

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);

afterEach(async () => {
  await setLanguagePreference("en");
});

describe("boundFormat", () => {
  it("returns what the module functions return for the current language", async () => {
    for (const language of ["en", "tr", "de"] as const) {
      await setLanguagePreference(language);
      const f = boundFormat();
      expect(f.locale).toBe(language);
      expect(f.formatNumber(1234567.891)).toBe(formatNumber(1234567.891));
      expect(f.formatDate(NOW, { month: "long" })).toBe(formatDate(NOW, { month: "long" }));
      expect(f.formatBytes(1536)).toBe(formatBytes(1536));
      expect(f.formatDuration(3_725_000)).toBe(formatDuration(3_725_000));
      expect(f.formatDays(3)).toBe(formatDays(3));
      expect(f.formatRelativeTime(NOW - 7_200_000, { now: NOW })).toBe(
        formatRelativeTime(NOW - 7_200_000, { now: NOW }),
      );
      const iso = new Date(NOW - 3_600_000).toISOString();
      expect(f.formatGithubRelativeTime(iso, NOW)).toBe(formatGithubRelativeTime(iso, NOW));
      expect(f.formatChatDate(NOW - 86_400_000 * 400, NOW)).toBe(
        formatChatDate(NOW - 86_400_000 * 400, NOW),
      );
    }
  });

  it("keeps one stable object per language and a new one after a language change", async () => {
    await setLanguagePreference("en");
    const english = boundFormat();
    expect(boundFormat()).toBe(english);
    await setLanguagePreference("tr");
    const turkish = boundFormat();
    expect(turkish).not.toBe(english);
    expect(boundFormat()).toBe(turkish);
    await setLanguagePreference("en");
    expect(boundFormat()).toBe(english);
  });

  it("follows the new language in formatted output", async () => {
    await setLanguagePreference("en");
    expect(boundFormat().formatRelativeTime(NOW - 7_200_000, { now: NOW })).toBe("2 hours ago");
    await setLanguagePreference("tr");
    expect(boundFormat().formatRelativeTime(NOW - 7_200_000, { now: NOW })).toBe("2 saat önce");
  });
});

describe("useFormat", () => {
  it("re-renders on a language change with a stable object in between", async () => {
    await setLanguagePreference("en");
    const container = document.createElement("div");
    const root = createRoot(container);
    const seen = new Set<unknown>();
    let renders = 0;
    function Label() {
      const f = useFormat();
      renders++;
      seen.add(f);
      // Mirrors the compiler's cached expression depending on the bound object.
      const text = useMemo(() => f.formatRelativeTime(NOW - 7_200_000, { now: NOW }), [f]);
      return createElement("div", null, text);
    }
    try {
      await act(async () => root.render(createElement(Label)));
      expect(container.textContent).toBe("2 hours ago");
      await act(async () => root.render(createElement(Label)));
      expect(seen.size).toBe(1);
      await act(async () => setLanguagePreference("tr"));
      expect(container.textContent).toBe("2 saat önce");
      expect(seen.size).toBe(2);
      expect(renders).toBeGreaterThan(2);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
