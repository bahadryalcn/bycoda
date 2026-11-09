// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  APPEARANCE_DEFAULTS,
  APPEARANCE_PREFERENCES_EVENT,
  applyAppearancePreferences,
  loadAppearancePreferences,
  saveAppearancePreferences,
  normalizeAppearancePreferences,
} from "./appearancePreferences";

describe("appearance preferences", () => {
  it("reuses normalized snapshots and sees direct storage changes", () => {
    localStorage.setItem(
      "bycoda.appearancePreferences.v1",
      JSON.stringify({ codeTheme: "dracula" }),
    );
    const parse = vi.spyOn(JSON, "parse");
    const first = loadAppearancePreferences();
    expect(loadAppearancePreferences()).toBe(first);
    expect(parse).toHaveBeenCalledTimes(1);
    localStorage.setItem(
      "bycoda.appearancePreferences.v1",
      JSON.stringify({ codeTheme: "github" }),
    );
    expect(loadAppearancePreferences().codeTheme).toBe("github");
    localStorage.removeItem("bycoda.appearancePreferences.v1");
    expect(loadAppearancePreferences().codeTheme).toBe(APPEARANCE_DEFAULTS.codeTheme);
    parse.mockRestore();
  });
  it("defaults old preferences to GitHub and persists the selected code theme", () => {
    expect(normalizeAppearancePreferences({}).codeTheme).toBe("github");
    expect(normalizeAppearancePreferences({ codeTheme: "unknown" as never }).codeTheme).toBe(
      "github",
    );
    saveAppearancePreferences({ ...APPEARANCE_DEFAULTS, codeTheme: "dracula" });
    expect(loadAppearancePreferences().codeTheme).toBe("dracula");
    expect(document.documentElement.dataset.codeTheme).toBe("dracula");
    saveAppearancePreferences({ ...APPEARANCE_DEFAULTS });
    expect(document.documentElement.dataset.codeTheme).toBe("github");
  });
  it("validates terminal typography separately from editor typography", () => {
    const value = normalizeAppearancePreferences({
      codeSize: 16,
      terminalSize: 99,
      terminalFont: "JetBrains Mono",
      terminalWeight: 600,
      terminalLineHeight: 1.35,
    });
    expect(value).toMatchObject({
      codeSize: 16,
      terminalSize: 40,
      terminalFont: "JetBrains Mono",
      terminalWeight: 600,
      terminalLineHeight: 1.35,
    });
    expect(
      normalizeAppearancePreferences({
        terminalSize: -1,
        terminalWeight: 999,
        terminalLineHeight: NaN,
      }),
    ).toMatchObject({
      terminalSize: 8,
      terminalWeight: 400,
      terminalLineHeight: 1,
    });
  });
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
      terminalSize: 18,
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
  it("upgrades saved preferences without density and persists a shared touch target preference", () => {
    localStorage.setItem("bycoda.appearancePreferences.v1", JSON.stringify({ codeSize: 15 }));
    expect(loadAppearancePreferences()).toEqual({
      ...APPEARANCE_DEFAULTS,
      codeSize: 15,
      terminalSize: 15,
    });
    saveAppearancePreferences({ ...loadAppearancePreferences(), controlDensity: "touch" });
    expect(loadAppearancePreferences().controlDensity).toBe("touch");
    expect(document.documentElement.dataset.controlDensity).toBe("touch");
    saveAppearancePreferences({ ...APPEARANCE_DEFAULTS });
    expect(document.documentElement.dataset.controlDensity).toBe("compact");
    expect(loadAppearancePreferences().codeSize).toBe(13);
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
  it("keeps records without typography fields on the code font and treats a saved terminal font as custom", () => {
    expect(normalizeAppearancePreferences({}).terminalFontSource).toBe("code");
    expect(normalizeAppearancePreferences({}).codeLigatures).toBe(true);
    expect(
      normalizeAppearancePreferences({ terminalFont: "Cascadia Code" }).terminalFontSource,
    ).toBe("custom");
    expect(
      normalizeAppearancePreferences({ terminalFont: "Cascadia Code", terminalFontSource: "code" })
        .terminalFontSource,
    ).toBe("code");
    expect(
      normalizeAppearancePreferences({ terminalFont: "", terminalFontSource: "custom" })
        .terminalFontSource,
    ).toBe("custom");
  });
  it("loads legacy font names and applies the chosen families, ligatures and terminal source", () => {
    const legacy = normalizeAppearancePreferences({
      interfaceFont: "Verdana",
      codeFont: "Menlo",
    });
    expect(legacy.interfaceFont).toBe("Verdana");
    expect(legacy.codeFont).toBe("Menlo");
    applyAppearancePreferences({
      ...legacy,
      interfaceFont: "Inter",
      codeFont: "JetBrains Mono",
      codeLigatures: false,
    });
    expect(document.documentElement.style.getPropertyValue("--font-sans")).toBe(
      '"Inter Variable", sans-serif',
    );
    expect(document.documentElement.style.getPropertyValue("--font-mono")).toBe(
      '"JetBrains Mono Variable", monospace',
    );
    expect(document.documentElement.dataset.codeLigatures).toBe("off");
    applyAppearancePreferences({ ...legacy, interfaceFont: "System", codeFont: "System" });
    expect(document.documentElement.style.getPropertyValue("--font-sans")).toBe("");
    expect(document.documentElement.dataset.codeLigatures).toBe("on");
  });
});
