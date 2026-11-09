// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WORKING_INDICATOR_DEFAULT,
  WORKING_INDICATOR_KEY,
  applyWorkingIndicator,
  initWorkingIndicator,
  loadWorkingIndicator,
  normalizeWorkingIndicator,
  resetWorkingIndicator,
  saveWorkingIndicator,
  subscribeWorkingIndicator,
} from "./workingIndicator";

const root = document.documentElement;

beforeEach(() => {
  localStorage.clear();
  root.style.removeProperty("--ui-working-row-color");
  root.style.removeProperty("--ui-working-row-strength");
  delete root.dataset.workingIndicator;
  initWorkingIndicator();
});

describe("working indicator", () => {
  it("normalizes malformed values and bounds strength", () => {
    expect(normalizeWorkingIndicator(null)).toEqual(WORKING_INDICATOR_DEFAULT);
    expect(
      normalizeWorkingIndicator({
        color: "custom",
        customColor: "#AABBCC",
        style: "steady",
        strength: 900,
      }),
    ).toEqual({ color: "custom", customColor: "#aabbcc", style: "steady", strength: 250 });
    expect(
      normalizeWorkingIndicator({ color: "red", customColor: "red", style: "spin", strength: 1 }),
    ).toEqual({ color: "auto", customColor: null, style: "pulse", strength: 50 });
  });

  it("applies color, strength and style, and clears overrides at the default", () => {
    applyWorkingIndicator({ color: "theme", customColor: null, style: "steady", strength: 150 });
    expect(root.style.getPropertyValue("--ui-working-row-color")).toBe(
      "hsl(var(--theme-hue) max(var(--theme-saturation), 40%) 60%)",
    );
    expect(root.style.getPropertyValue("--ui-working-row-strength")).toBe("1.5");
    expect(root.dataset.workingIndicator).toBe("steady");
    applyWorkingIndicator({ color: "custom", customColor: "#123456", style: "off", strength: 100 });
    expect(root.style.getPropertyValue("--ui-working-row-color")).toBe("#123456");
    expect(root.dataset.workingIndicator).toBe("off");
    // A custom choice without a color falls back to the Appearance-following default.
    applyWorkingIndicator({ color: "custom", customColor: null, style: "pulse", strength: 100 });
    expect(root.style.getPropertyValue("--ui-working-row-color")).toBe("");
    applyWorkingIndicator(WORKING_INDICATOR_DEFAULT);
    expect(root.style.getPropertyValue("--ui-working-row-color")).toBe("");
    expect(root.style.getPropertyValue("--ui-working-row-strength")).toBe("");
    expect(root.dataset.workingIndicator).toBe("pulse");
  });

  it("saves, notifies, applies and resets", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWorkingIndicator(listener);
    expect(
      saveWorkingIndicator({ color: "theme", customColor: null, style: "off", strength: 200 }),
    ).toBe(true);
    expect(JSON.parse(localStorage.getItem(WORKING_INDICATOR_KEY)!)).toMatchObject({
      color: "theme",
      style: "off",
    });
    expect(loadWorkingIndicator().strength).toBe(200);
    expect(root.dataset.workingIndicator).toBe("off");
    expect(listener).toHaveBeenCalledTimes(1);
    resetWorkingIndicator();
    expect(loadWorkingIndicator()).toEqual(WORKING_INDICATOR_DEFAULT);
    expect(root.style.getPropertyValue("--ui-working-row-color")).toBe("");
    unsubscribe();
  });

  it("follows the Appearance accent by default, else the working blue", () => {
    const css = readFileSync("src/styles/index.css", "utf8");
    expect(css).toMatch(
      /--ui-working-row-color: var\(--user-accent-color, var\(--color-active\)\);/,
    );
  });

  it("falls back to the default for an unreadable record", () => {
    localStorage.setItem(WORKING_INDICATOR_KEY, "{not json");
    expect(loadWorkingIndicator()).toEqual(WORKING_INDICATOR_DEFAULT);
  });
});
