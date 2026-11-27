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
  it("defaults, bounds and applies chat message appearance independently", () => {
    expect(normalizeAppearancePreferences({})).toMatchObject({
      userMessageOpacity: 42,
      transcriptSurface: "reply",
      transcriptSurfaceOpacity: 90,
      messageColor: "theme",
    });
    const base = loadAppearancePreferences();
    const saved = saveAppearancePreferences(
      {
        ...base,
        userMessageOpacity: -10,
        transcriptSurfaceOpacity: 115,
        messageColor: "neutral",
      },
      base,
    );
    expect(loadAppearancePreferences()).toMatchObject({
      userMessageOpacity: 0,
      transcriptSurfaceOpacity: 100,
      messageColor: "neutral",
    });
    applyAppearancePreferences(saved);
    const root = document.documentElement;
    expect(root.dataset.chatMessageColor).toBe("neutral");
    expect(root.hasAttribute("data-chat-user-surface-off")).toBe(true);
    expect(root.dataset.transcriptSurface).toBe("reply");
    expect(root.style.getPropertyValue("--appearance-transcript-surface-opacity")).toBe("100%");
    expect(root.hasAttribute("data-chat-assistant-surface-off")).toBe(false);
  });

  it("migrates a stored assistant opacity into the reading surface opacity", () => {
    const migrated = normalizeAppearancePreferences({ assistantMessageOpacity: 60 } as never);
    expect(migrated).toMatchObject({ transcriptSurface: "reply", transcriptSurfaceOpacity: 60 });
    expect(migrated).not.toHaveProperty("assistantMessageOpacity");
  });

  it("turns a stored zero assistant opacity into the off surface and the default opacity", () => {
    expect(normalizeAppearancePreferences({ assistantMessageOpacity: 0 } as never)).toMatchObject({
      transcriptSurface: "off",
      transcriptSurfaceOpacity: 90,
    });
  });

  it("keeps stored transcript fields over a leftover assistant opacity", () => {
    expect(
      normalizeAppearancePreferences({
        assistantMessageOpacity: 0,
        transcriptSurfaceOpacity: 30,
        transcriptSurface: "column",
      } as never),
    ).toMatchObject({ transcriptSurface: "column", transcriptSurfaceOpacity: 30 });
  });

  it("ignores a malformed legacy value and bounds or defaults every transcript field", () => {
    expect(normalizeAppearancePreferences({ assistantMessageOpacity: "x" } as never)).toMatchObject(
      { transcriptSurface: "reply", transcriptSurfaceOpacity: 90 },
    );
    expect(
      normalizeAppearancePreferences({
        transcriptSurface: "bogus",
        transcriptSurfaceBlur: 99,
        transcriptBodyInk: 10,
        transcriptChromeInk: 200,
        transcriptCards: "x",
        transcriptActions: "hover",
      } as never),
    ).toMatchObject({
      transcriptSurface: "reply",
      transcriptSurfaceBlur: 24,
      transcriptBodyInk: 80,
      transcriptChromeInk: 100,
      transcriptCards: "inset",
      transcriptActions: "hover",
    });
  });

  it("applies transcript surface, ink, cards, actions and the contrast scale", () => {
    applyAppearancePreferences({
      ...APPEARANCE_DEFAULTS,
      transcriptSurface: "off",
      transcriptCards: "outline",
      transcriptActions: "hover",
      transcriptSurfaceBlur: 8,
      transcriptBodyInk: 96,
      transcriptChromeInk: 70,
      contrast: 150,
    });
    const root = document.documentElement;
    expect(root.dataset.transcriptSurface).toBe("off");
    expect(root.dataset.transcriptCards).toBe("outline");
    expect(root.dataset.transcriptActions).toBe("hover");
    expect(root.style.getPropertyValue("--appearance-transcript-surface-blur")).toBe("8px");
    expect(root.style.getPropertyValue("--appearance-transcript-body-ink")).toBe("96%");
    expect(root.style.getPropertyValue("--appearance-transcript-chrome-ink")).toBe("70%");
    expect(root.style.getPropertyValue("--appearance-contrast-scale")).toBe("1.5");
  });
  it("defaults file references to colored with a tone per kind and rejects unknown tones", () => {
    expect(normalizeAppearancePreferences({})).toMatchObject({
      transcriptFileRefs: "colored",
      fileToneCode: "info",
      fileToneMarkup: "warning",
      fileToneDocs: "feature",
      fileToneData: "success",
      fileToneMedia: "orchestration",
      fileToneArchive: "neutral",
      fileToneFolder: "accent",
      fileToneOther: "neutral",
    });
    expect(
      normalizeAppearancePreferences({
        transcriptFileRefs: "rainbow",
        fileToneCode: "#ff0000",
        fileToneDocs: "danger",
      } as never),
    ).toMatchObject({
      transcriptFileRefs: "colored",
      fileToneCode: "info",
      fileToneDocs: "danger",
    });
  });

  it("applies the file reference style and one hue variable per kind", () => {
    applyAppearancePreferences({
      ...APPEARANCE_DEFAULTS,
      transcriptFileRefs: "plain",
      fileToneDocs: "danger",
      fileToneOther: "neutral",
    });
    const root = document.documentElement;
    expect(root.dataset.fileRefs).toBe("plain");
    expect(root.style.getPropertyValue("--file-ref-hue-docs")).toBe("var(--color-danger)");
    expect(root.style.getPropertyValue("--file-ref-hue-other")).toBe("var(--color-content)");
    expect(root.style.getPropertyValue("--file-ref-hue-code")).toBe("var(--color-info)");
  });

  it("defaults the image layer on, persists off and restores its default DOM state", () => {
    expect(normalizeAppearancePreferences({}).chatBackgroundLayer).toBe(true);
    expect(
      normalizeAppearancePreferences({ chatBackgroundLayer: "false" as never }).chatBackgroundLayer,
    ).toBe(true);
    const base = loadAppearancePreferences();
    saveAppearancePreferences({ ...base, chatBackgroundLayer: false }, base);
    expect(loadAppearancePreferences().chatBackgroundLayer).toBe(false);
    expect(document.documentElement.classList.contains("chat-background-layer-off")).toBe(true);
    applyAppearancePreferences({ ...APPEARANCE_DEFAULTS });
    expect(document.documentElement.classList.contains("chat-background-layer-off")).toBe(false);
  });

  it("merges image layer edits with sibling appearance changes", () => {
    const base = loadAppearancePreferences();
    localStorage.setItem(
      "bycoda.appearancePreferences.v1",
      JSON.stringify({ ...base, codeTheme: "dracula" }),
    );
    saveAppearancePreferences({ ...base, chatBackgroundLayer: false }, base);
    expect(loadAppearancePreferences()).toMatchObject({
      codeTheme: "dracula",
      chatBackgroundLayer: false,
    });
  });

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
  it("applies a 56rem comfortable reading column by default", () => {
    expect(APPEARANCE_DEFAULTS.chatWidth).toBe("comfortable");
    applyAppearancePreferences({ ...APPEARANCE_DEFAULTS });
    expect(document.documentElement.style.getPropertyValue("--appearance-chat-width")).toBe(
      "56rem",
    );
  });
  it("bounds surface contrast and applies it as a layer-strength multiplier", () => {
    expect(normalizeAppearancePreferences({}).surfaceContrast).toBe(100);
    expect(normalizeAppearancePreferences({ surfaceContrast: 10 }).surfaceContrast).toBe(50);
    expect(normalizeAppearancePreferences({ surfaceContrast: 999 }).surfaceContrast).toBe(200);
    expect(normalizeAppearancePreferences({ surfaceContrast: "x" as never }).surfaceContrast).toBe(
      100,
    );
    const style = document.documentElement.style;
    applyAppearancePreferences({ ...APPEARANCE_DEFAULTS, surfaceContrast: 125 });
    expect(style.getPropertyValue("--appearance-layer-strength")).toBe("1.25");
    applyAppearancePreferences({ ...APPEARANCE_DEFAULTS });
    expect(style.getPropertyValue("--appearance-layer-strength")).toBe("");
    expect(style.cssText).not.toContain("--appearance-layer-strength");
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
