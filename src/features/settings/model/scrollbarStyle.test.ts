// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SCROLLBAR_STYLE_DEFAULT,
  SCROLLBAR_STYLE_KEY,
  applyScrollbarStyle,
  initScrollbarStyle,
  loadScrollbarStyle,
  normalizeScrollbarStyle,
  resetScrollbarStyle,
  saveScrollbarStyle,
  subscribeScrollbarStyle,
} from "./scrollbarStyle";

const root = document.documentElement;
const read = (name: string) => root.style.getPropertyValue(name);

beforeEach(() => {
  localStorage.clear();
  for (const name of ["--ui-scrollbar-color", "--ui-scrollbar-size", "--ui-scrollbar-strength"])
    root.style.removeProperty(name);
  delete root.dataset.scrollbarVisibility;
  initScrollbarStyle();
});

describe("scrollbar style", () => {
  it("normalizes malformed values and bounds strength", () => {
    expect(normalizeScrollbarStyle(null)).toEqual(SCROLLBAR_STYLE_DEFAULT);
    expect(
      normalizeScrollbarStyle({
        color: "custom",
        customColor: "#AABBCC",
        size: "large",
        visibility: "always",
        strength: 900,
      }),
    ).toEqual({
      color: "custom",
      customColor: "#aabbcc",
      size: "large",
      visibility: "always",
      strength: 200,
    });
    expect(
      normalizeScrollbarStyle({ color: "red", size: "huge", visibility: "never", strength: 1 }),
    ).toEqual({ ...SCROLLBAR_STYLE_DEFAULT, strength: 50 });
  });

  it.each([
    ["extra-thin", 3],
    ["thin", 6],
    ["medium", 10],
    ["large", 14],
    ["xlarge", 18],
  ] as const)("persists and applies %s at %ipx", (size, pixels) => {
    expect(saveScrollbarStyle({ ...SCROLLBAR_STYLE_DEFAULT, size })).toBe(true);
    expect(loadScrollbarStyle().size).toBe(size);
    expect(read("--ui-scrollbar-size")).toBe(size === "thin" ? "" : `${pixels}px`);
  });

  it("keeps the width of legacy wide preferences", () => {
    localStorage.setItem(SCROLLBAR_STYLE_KEY, JSON.stringify({ size: "wide" }));
    expect(loadScrollbarStyle().size).toBe("large");
    applyScrollbarStyle(loadScrollbarStyle());
    expect(read("--ui-scrollbar-size")).toBe("14px");
  });

  it("applies color, size, strength and visibility, and clears overrides at the default", () => {
    applyScrollbarStyle({
      color: "neutral",
      customColor: null,
      size: "medium",
      visibility: "always",
      strength: 150,
    });
    expect(read("--ui-scrollbar-color")).toBe("var(--color-content)");
    expect(read("--ui-scrollbar-size")).toBe("10px");
    expect(read("--ui-scrollbar-strength")).toBe("1.5");
    expect(root.dataset.scrollbarVisibility).toBe("always");
    applyScrollbarStyle({ ...SCROLLBAR_STYLE_DEFAULT, color: "custom", customColor: "#123456" });
    expect(read("--ui-scrollbar-color")).toBe("#123456");
    // A custom choice without a color keeps the Appearance-following default.
    applyScrollbarStyle({ ...SCROLLBAR_STYLE_DEFAULT, color: "custom" });
    expect(read("--ui-scrollbar-color")).toBe("");
    applyScrollbarStyle(SCROLLBAR_STYLE_DEFAULT);
    expect(read("--ui-scrollbar-size")).toBe("");
    expect(read("--ui-scrollbar-strength")).toBe("");
    expect(root.dataset.scrollbarVisibility).toBe("hover");
  });

  it("saves, notifies, applies and resets", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeScrollbarStyle(listener);
    expect(saveScrollbarStyle({ ...SCROLLBAR_STYLE_DEFAULT, size: "large", color: "theme" })).toBe(
      true,
    );
    expect(JSON.parse(localStorage.getItem(SCROLLBAR_STYLE_KEY)!)).toMatchObject({
      size: "large",
      color: "theme",
    });
    expect(read("--ui-scrollbar-size")).toBe("14px");
    expect(listener).toHaveBeenCalledTimes(1);
    resetScrollbarStyle();
    expect(loadScrollbarStyle()).toEqual(SCROLLBAR_STYLE_DEFAULT);
    expect(read("--ui-scrollbar-color")).toBe("");
    unsubscribe();
  });

  it("falls back to the default for an unreadable record", () => {
    localStorage.setItem(SCROLLBAR_STYLE_KEY, "{not json");
    expect(loadScrollbarStyle()).toEqual(SCROLLBAR_STYLE_DEFAULT);
  });

  it("drives every scrollbar rule from the tokens it sets", () => {
    const css = readFileSync("src/styles/index.css", "utf8");
    expect(css).toMatch(
      /--ui-scrollbar-color: var\(--user-accent-color, var\(--color-content\)\);/,
    );
    expect(css).toMatch(/--ui-scrollbar-thumb:[^;]*var\(--ui-scrollbar-color\)/);
    expect(css).toMatch(/--ui-scrollbar-thumb:[^;]*var\(--ui-scrollbar-strength\)/);
    expect(css).toMatch(/::-webkit-scrollbar \{\s*width: var\(--ui-scrollbar-size\);/);
    expect(css).toContain('[data-scrollbar-visibility="always"] ::-webkit-scrollbar-thumb');
  });
});
