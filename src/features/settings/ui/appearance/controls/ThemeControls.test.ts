// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { AccentRing } from "./AccentRing";
import { StateLadder } from "./StateLadder";
import { ToneSliders } from "./ToneSliders";
import { themeSuggestionFailureDetail } from "./themeSuggestionRequest";
import { loadInteractionTint, saveInteractionTint } from "../../../model/interactionTint";
import type { AppearanceSettings } from "../../useAppearanceSettings";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("theme generation failure detail", () => {
  it("keeps the Host's reason as one short line and drops empty ones", () => {
    expect(
      themeSuggestionFailureDetail(
        new Error("Selected model does not support text actions.\n  Choose a supported model."),
      ),
    ).toBe("Selected model does not support text actions. Choose a supported model.");
    expect(themeSuggestionFailureDetail("  Local host unavailable ")).toBe(
      "Local host unavailable",
    );
    expect(themeSuggestionFailureDetail(new Error("x".repeat(400)))).toHaveLength(160);
    expect(themeSuggestionFailureDetail(new Error(""))).toBe("");
    expect(themeSuggestionFailureDetail(undefined)).toBe("");
    expect(themeSuggestionFailureDetail({ code: 7 })).toBe("");
  });
});

it("labels tone sliders and disables depth in light mode", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const appearance = {
    themeHue: 216,
    themeSaturation: 20,
    themeDarkLightness: 8,
    onTint: vi.fn(),
    onDarkLightness: vi.fn(),
  } as unknown as AppearanceSettings;
  try {
    await act(async () => root.render(createElement(ToneSliders, { appearance })));
    expect(host.textContent).toContain("216°");
    expect(host.querySelector("#setting-hue")).not.toBeNull();
    expect(host.querySelector("#setting-saturation")).not.toBeNull();
    expect(host.querySelector("#setting-dark-lightness")).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("toggles accent readability and keeps its search anchor", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onPreferences = vi.fn();
  const appearance = {
    accentColor: null,
    onAccentColor: vi.fn(),
    preferences: { accentReadability: "auto" },
    onPreferences,
  } as unknown as AppearanceSettings;
  try {
    await act(async () => root.render(createElement(AccentRing, { appearance })));
    const button = host.querySelector<HTMLButtonElement>("#setting-accent-readability")!;
    expect(button.getAttribute("aria-pressed")).toBe("false");
    await act(async () => button.click());
    expect(onPreferences).toHaveBeenCalledWith({ accentReadability: "strong" });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("saves interaction source, clamps strength and opens the custom picker", async () => {
  localStorage.clear();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(StateLadder)));
    expect(host.querySelector("#setting-interaction-tint")).not.toBeNull();
    expect(host.querySelector("#setting-interaction-strength")).not.toBeNull();
    expect(host.querySelector(".settings-reset")).toBeNull();
    const custom = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent?.trim() === "Custom",
    )!;
    await act(async () => custom.click());
    expect(loadInteractionTint().source).toBe("custom");
    expect(host.querySelector(".settings-reset")).not.toBeNull();
    const color = document.querySelector<HTMLInputElement>('input[aria-label="Hex color"]')!;
    expect(color).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(color, "#123456");
      color.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(loadInteractionTint().customColor).toBe("#123456");
    await act(async () => {
      saveInteractionTint({ source: "custom", customColor: "#123456", strength: 300 });
    });
    expect(loadInteractionTint()).toEqual({
      source: "custom",
      customColor: "#123456",
      strength: 200,
    });
    await act(async () => {
      saveInteractionTint({ source: "theme", customColor: null, strength: 1 });
    });
    expect(loadInteractionTint().strength).toBe(50);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
