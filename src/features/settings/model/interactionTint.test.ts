// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { relativeLuminance } from "./accentContrast";
import {
  applyInteractionTint,
  initInteractionTint,
  INTERACTION_TINT_DEFAULT,
  interactionStepPercent,
  INTERACTION_TINT_KEY,
  loadInteractionTint,
  normalizeInteractionTint,
  resetInteractionTint,
  saveInteractionTint,
  subscribeInteractionTint,
} from "./interactionTint";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.style.removeProperty("--ui-interaction-tint");
  document.documentElement.style.removeProperty("--ui-interaction-strength");
  initInteractionTint();
});

describe("interaction tint", () => {
  it("normalizes malformed values and bounds strength", () => {
    expect(normalizeInteractionTint(null)).toEqual(INTERACTION_TINT_DEFAULT);
    expect(
      normalizeInteractionTint({ source: "custom", customColor: "#AABBCC", strength: 300 }),
    ).toEqual({ source: "custom", customColor: "#aabbcc", strength: 200 });
    expect(normalizeInteractionTint({ source: "bad", customColor: "red", strength: 1 })).toEqual({
      source: "neutral",
      customColor: null,
      strength: 50,
    });
  });

  it("applies sources and strength and clears neutral overrides", () => {
    const style = document.documentElement.style;
    applyInteractionTint({ source: "theme", customColor: null, strength: 150 });
    expect(style.getPropertyValue("--ui-interaction-tint")).toBe(
      "hsl(var(--theme-hue) max(var(--theme-saturation), 40%) 60%)",
    );
    expect(style.getPropertyValue("--ui-interaction-strength")).toBe("1.5");
    applyInteractionTint({ source: "accent", customColor: null, strength: 50 });
    expect(style.getPropertyValue("--ui-interaction-tint")).toBe(
      "var(--user-accent-color, var(--color-content))",
    );
    applyInteractionTint({ source: "custom", customColor: "#123456", strength: 100 });
    expect(style.getPropertyValue("--ui-interaction-tint")).toBe("#123456");
    applyInteractionTint(INTERACTION_TINT_DEFAULT);
    expect(style.getPropertyValue("--ui-interaction-tint")).toBe("");
    expect(style.getPropertyValue("--ui-interaction-strength")).toBe("");
  });

  it("caps extreme custom luminance", () => {
    applyInteractionTint({ source: "custom", customColor: "#ffffff", strength: 200 });
    expect(
      relativeLuminance(document.documentElement.style.getPropertyValue("--ui-interaction-tint")),
    ).toBeLessThanOrEqual(0.8);
  });

  it("saves, loads, observes sibling storage and resets", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeInteractionTint(listener);
    const value = { source: "custom" as const, customColor: "#123456", strength: 125 };
    expect(saveInteractionTint(value)).toBe(true);
    expect(loadInteractionTint()).toEqual(value);
    localStorage.setItem(INTERACTION_TINT_KEY, JSON.stringify({ ...value, source: "accent" }));
    window.dispatchEvent(
      new StorageEvent("storage", { key: INTERACTION_TINT_KEY, storageArea: localStorage }),
    );
    expect(document.documentElement.style.getPropertyValue("--ui-interaction-tint")).toBe(
      "var(--user-accent-color, var(--color-content))",
    );
    expect(listener).toHaveBeenCalledTimes(2);
    expect(resetInteractionTint()).toBe(true);
    expect(loadInteractionTint()).toEqual(INTERACTION_TINT_DEFAULT);
    expect(document.documentElement.style.getPropertyValue("--ui-interaction-tint")).toBe("");
    unsubscribe();
  });
});

describe("interaction step percentages", () => {
  it("keeps hover below selected below pressed in both schemes at every strength", () => {
    for (const light of [false, true]) {
      for (const strength of [50, 100, 200]) {
        const { hover, selected, pressed } = interactionStepPercent(light, strength);
        expect(hover).toBeLessThan(selected);
        expect(selected).toBeLessThan(pressed);
      }
    }
  });
  it("scales the displayed steps with strength", () => {
    expect(interactionStepPercent(false, 100)).toEqual({ hover: 12, selected: 20, pressed: 28 });
    expect(interactionStepPercent(true, 100)).toEqual({ hover: 4, selected: 10, pressed: 16 });
    expect(interactionStepPercent(false, 200)).toEqual({ hover: 24, selected: 40, pressed: 56 });
  });
});
