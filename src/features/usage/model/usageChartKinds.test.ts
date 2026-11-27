// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { loadUsageChartKind, saveUsageChartKind } from "./usageChartKinds";

afterEach(() => localStorage.clear());

it("defaults each panel to its first chart type", () => {
  expect(loadUsageChartKind("trend")).toBe("line");
  expect(loadUsageChartKind("share")).toBe("donut");
  expect(loadUsageChartKind("hourly")).toBe("bar");
  expect(loadUsageChartKind("quotaHistory")).toBe("points");
});

it("remembers the choice per panel", () => {
  saveUsageChartKind("trend", "stacked-bar");
  expect(loadUsageChartKind("trend")).toBe("stacked-bar");
  expect(loadUsageChartKind("hourly")).toBe("bar");
});

it("falls back to the default for an unknown stored kind", () => {
  localStorage.setItem("bycoda.usage.chartKind.share", "pie3d");
  expect(loadUsageChartKind("share")).toBe("donut");
});

it("keeps a choice for this window when storage refuses it", () => {
  const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(saveUsageChartKind("hourly", "line")).toBe(false);
    expect(loadUsageChartKind("hourly")).toBe("line");
  } finally {
    setItem.mockRestore();
    warn.mockRestore();
  }
  expect(saveUsageChartKind("hourly", "bar")).toBe(true);
  expect(loadUsageChartKind("hourly")).toBe("bar");
});
