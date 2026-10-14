// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  APPEARANCE_DEFAULTS,
  APPEARANCE_PREFERENCES_EVENT,
  applyAppearancePreferences,
  loadAppearancePreferences,
  saveAppearancePreferences,
} from "./appearancePreferences";

describe("appearance preferences", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.cssText = "";
    document.documentElement.className = "";
  });
  it("loads safe defaults from missing, malformed or invalid preferences", () => {
    expect(loadAppearancePreferences()).toEqual(APPEARANCE_DEFAULTS);
    localStorage.setItem("bycoda.appearancePreferences.v1", "broken");
    expect(loadAppearancePreferences()).toEqual(APPEARANCE_DEFAULTS);
    localStorage.setItem(
      "bycoda.appearancePreferences.v1",
      JSON.stringify({
        interfaceFont: "untrusted font",
        codeSize: 99,
        contrast: -1,
        chatWidth: "invalid",
        wordWrap: "true",
      }),
    );
    expect(loadAppearancePreferences()).toEqual({
      ...APPEARANCE_DEFAULTS,
      codeSize: 18,
      contrast: 75,
    });
  });
  it("persists, applies and notifies open views", () => {
    const listener = vi.fn();
    window.addEventListener(APPEARANCE_PREFERENCES_EVENT, listener);
    const preferences = {
      ...APPEARANCE_DEFAULTS,
      interfaceFont: "Verdana",
      codeFont: "Consolas",
      codeSize: 16,
      chatWidth: "wide" as const,
      wordWrap: true,
    };
    saveAppearancePreferences(preferences);
    expect(loadAppearancePreferences()).toEqual(preferences);
    expect(document.documentElement.style.getPropertyValue("--font-mono")).toBe(
      '"Consolas", monospace',
    );
    expect(document.documentElement.style.getPropertyValue("--appearance-chat-width")).toBe(
      "76rem",
    );
    expect(document.documentElement.classList.contains("appearance-word-wrap")).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(APPEARANCE_PREFERENCES_EVENT, listener);
  });
  it("restores CSS font fallbacks and wrapping when reset", () => {
    applyAppearancePreferences({
      ...APPEARANCE_DEFAULTS,
      interfaceFont: "Arial",
      codeFont: "Menlo",
      wordWrap: true,
    });
    saveAppearancePreferences({ ...APPEARANCE_DEFAULTS });
    expect(document.documentElement.style.getPropertyValue("--font-sans")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--font-mono")).toBe("");
    expect(document.documentElement.classList.contains("appearance-word-wrap")).toBe(false);
    expect(loadAppearancePreferences()).toEqual(APPEARANCE_DEFAULTS);
  });
});
