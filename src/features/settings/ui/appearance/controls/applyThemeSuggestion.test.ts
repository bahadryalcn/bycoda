// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSessionListDisplay } from "../../../../sessions/model/sessionListDisplay";
import { APPEARANCE_DEFAULTS } from "../../../model/appearancePreferences";
import { loadInteractionTint } from "../../../model/interactionTint";
import { loadLiveBackground, loadLiveBackgroundIntensity } from "../../../model/liveBackground";
import { loadScrollbarStyle } from "../../../model/scrollbarStyle";
import {
  loadCrewTheme,
  loadCrewSceneEnabled,
  loadTabAnimationsEnabled,
} from "../../../model/settings";
import { normalizeThemeSuggestion } from "../../../model/themeSuggestions";
import { loadWorkingIndicator } from "../../../model/workingIndicator";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import { applyDrawnImageTuning, applyThemeSuggestion } from "./applyThemeSuggestion";

function mockAppearance() {
  const fns = {
    onThemePreference: vi.fn(),
    onTint: vi.fn(),
    onAccentColor: vi.fn(),
    onDarkLightness: vi.fn(),
    onPreferences: vi.fn(),
    onUiScale: vi.fn(),
    onDiffPalette: vi.fn(),
    onOpacity: vi.fn(),
    onMainOpacity: vi.fn(),
    onBlur: vi.fn(),
    onBodyGlass: vi.fn(),
    onWindowGlass: vi.fn(),
    onNewThreadBackgroundEffect: vi.fn(),
    onChatBackgroundScope: vi.fn(),
    onChatBackgroundEmptyOpacity: vi.fn(),
    onChatBackgroundSessionOpacity: vi.fn(),
    onChatBackgroundBlur: vi.fn(),
  };
  const appearance = {
    ...fns,
    preferences: { ...APPEARANCE_DEFAULTS },
  } as unknown as AppearanceSettings;
  return { appearance, fns };
}

const base = { name: "Kiln", hue: 20, saturation: 30, accent: "#c2410c" };
const suggest = (extra: Record<string, unknown>) =>
  normalizeThemeSuggestion({ ...base, ...extra })!;

beforeEach(() => localStorage.clear());

describe("applyThemeSuggestion", () => {
  it("applies only tint and accent when nothing else is set", () => {
    const { appearance, fns } = mockAppearance();
    applyThemeSuggestion(appearance, suggest({}));
    expect(fns.onTint).toHaveBeenCalledWith(20, 30);
    expect(fns.onAccentColor).toHaveBeenCalledOnce();
    expect(fns.onPreferences).not.toHaveBeenCalled();
    expect(fns.onUiScale).not.toHaveBeenCalled();
    expect(fns.onOpacity).not.toHaveBeenCalled();
  });

  it("merges typography, contrast and accent readability into one preferences write", () => {
    const { appearance, fns } = mockAppearance();
    applyThemeSuggestion(
      appearance,
      suggest({
        codeFont: "JetBrains Mono",
        typography: {
          codeSize: 15,
          ligatures: false,
          terminalFont: "JetBrains Mono",
          terminalSize: 14,
          terminalWeight: 500,
          terminalLineHeight: 1.15,
        },
        interface: { contrast: 120, accentReadability: "strong" },
      }),
    );
    expect(fns.onPreferences).toHaveBeenCalledOnce();
    expect(fns.onPreferences.mock.calls[0]![0]).toMatchObject({
      codeFont: "JetBrains Mono",
      codeSize: 15,
      codeLigatures: false,
      terminalFont: "JetBrains Mono",
      terminalFontSource: "custom",
      terminalSize: 14,
      terminalWeight: 500,
      terminalLineHeight: 1.15,
      contrast: 120,
      accentReadability: "strong",
    });
  });

  it("applies the interface group through setters and stores", () => {
    const { appearance, fns } = mockAppearance();
    applyThemeSuggestion(
      appearance,
      suggest({
        interface: {
          uiScale: 110,
          diffPalette: "colorblind",
          rowDensity: "detailed",
          showModel: false,
          scrollbarSize: "wide",
          scrollbarVisibility: "always",
          tintSource: "accent",
          workingColor: "theme",
          workingStyle: "steady",
        },
      }),
    );
    expect(fns.onUiScale).toHaveBeenCalledWith(110);
    expect(fns.onDiffPalette).toHaveBeenCalledWith("colorblind");
    expect(loadSessionListDisplay()).toMatchObject({
      density: "detailed",
      showModel: false,
    });
    expect(loadScrollbarStyle()).toMatchObject({
      size: "wide",
      visibility: "always",
    });
    expect(loadInteractionTint().source).toBe("accent");
    expect(loadWorkingIndicator()).toMatchObject({
      color: "theme",
      style: "steady",
    });
  });

  it("applies the background group, with intensity as a fraction", () => {
    const { appearance, fns } = mockAppearance();
    applyThemeSuggestion(
      appearance,
      suggest({
        background: {
          sidebarOpacity: 85,
          mainOpacity: 90,
          sidebarBlur: 30,
          bodyGlass: true,
          windowGlass: false,
          liveScene: "silk",
          liveIntensity: 50,
          newThreadEffect: "halftone",
        },
      }),
    );
    expect(fns.onOpacity).toHaveBeenCalledWith(85);
    expect(fns.onMainOpacity).toHaveBeenCalledWith(90);
    expect(fns.onBlur).toHaveBeenCalledWith(30);
    expect(fns.onBodyGlass).toHaveBeenCalledWith(true);
    expect(fns.onWindowGlass).toHaveBeenCalledWith(false);
    expect(fns.onNewThreadBackgroundEffect).toHaveBeenCalledWith("halftone");
    expect(loadLiveBackground()).toBe("silk");
    expect(loadLiveBackgroundIntensity()).toBeCloseTo(0.5);
  });

  it("applies image tuning only when the model gave it, and the motion group", () => {
    const { appearance, fns } = mockAppearance();
    applyThemeSuggestion(appearance, suggest({}));
    expect(fns.onChatBackgroundScope).not.toHaveBeenCalled();
    applyThemeSuggestion(
      appearance,
      suggest({
        image: {
          scope: "empty",
          emptyOpacity: 50,
          sessionOpacity: 10,
          blur: 8,
        },
        motion: { crewTheme: "lotr", showCrew: false, tabAnimations: false },
      }),
    );
    expect(fns.onChatBackgroundScope).toHaveBeenCalledWith("empty");
    expect(fns.onChatBackgroundEmptyOpacity).toHaveBeenCalledWith(50);
    expect(fns.onChatBackgroundSessionOpacity).toHaveBeenCalledWith(10);
    expect(fns.onChatBackgroundBlur).toHaveBeenCalledWith(8);
    expect(loadCrewTheme()).toBe("lotr");
    expect(loadCrewSceneEnabled()).toBe(false);
    expect(loadTabAnimationsEnabled()).toBe(false);
  });
});

describe("applyDrawnImageTuning", () => {
  it("shows a drawn image in every thread with readable defaults", () => {
    const { appearance, fns } = mockAppearance();
    applyDrawnImageTuning(appearance, suggest({}));
    expect(fns.onChatBackgroundScope).toHaveBeenCalledWith("all");
    expect(fns.onChatBackgroundEmptyOpacity).toHaveBeenCalledWith(40);
    expect(fns.onChatBackgroundSessionOpacity).toHaveBeenCalledWith(18);
    expect(fns.onChatBackgroundBlur).toHaveBeenCalledWith(6);
  });

  it("prefers the model's values", () => {
    const { appearance, fns } = mockAppearance();
    applyDrawnImageTuning(appearance, suggest({ image: { scope: "empty", blur: 0 } }));
    expect(fns.onChatBackgroundScope).toHaveBeenCalledWith("empty");
    expect(fns.onChatBackgroundBlur).toHaveBeenCalledWith(0);
  });
});
