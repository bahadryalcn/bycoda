// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSessionListDisplay } from "../../../../sessions/model/sessionListDisplay";
import { APPEARANCE_DEFAULTS } from "../../../model/appearancePreferences";
import { captureAppearanceSnapshot } from "../../../model/appearanceSnapshot";
import { loadInteractionTint, saveInteractionTint } from "../../../model/interactionTint";
import {
  loadLiveBackground,
  loadLiveBackgroundIntensity,
  saveLiveBackground,
  saveLiveBackgroundIntensity,
} from "../../../model/liveBackground";
import { loadScrollbarStyle } from "../../../model/scrollbarStyle";
import { loadCrewTheme, saveCrewTheme } from "../../../model/settings";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import { applyAppearanceSnapshot } from "./savedThemeActions";

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
    preferences: { ...APPEARANCE_DEFAULTS, wordWrap: true },
  } as unknown as AppearanceSettings;
  return { appearance, fns };
}

beforeEach(() => localStorage.clear());

describe("applyAppearanceSnapshot", () => {
  it("restores every captured setting exactly, without contrast guards", () => {
    saveLiveBackground("silk");
    saveLiveBackgroundIntensity(0.5);
    saveCrewTheme("matrix");
    saveInteractionTint({ ...loadInteractionTint(), source: "accent" });
    const saved = captureAppearanceSnapshot();
    const look = {
      ...saved,
      hue: 77,
      saturation: 12,
      accent: "#101010",
      glass: {
        sidebarOpacity: 0.3,
        mainOpacity: 0.4,
        sidebarBlur: 20,
        bodyGlass: true,
        windowGlass: false,
      },
      uiScale: 1.25,
      scrollbar: { ...loadScrollbarStyle(), size: "large" as const },
      sessionList: { density: "compact" as const, showModel: false, showBranch: false },
    };
    // Change the live state, then restore it from the snapshot.
    saveLiveBackground("none");
    saveCrewTheme("classic");
    saveInteractionTint({ ...loadInteractionTint(), source: "neutral" });
    const { appearance, fns } = mockAppearance();
    applyAppearanceSnapshot(appearance, look);

    expect(fns.onTint).toHaveBeenCalledWith(77, 12);
    expect(fns.onAccentColor).toHaveBeenCalledWith("#101010");
    expect(fns.onOpacity).toHaveBeenCalledWith(30);
    expect(fns.onMainOpacity).toHaveBeenCalledWith(40);
    expect(fns.onBlur).toHaveBeenCalledWith(20);
    expect(fns.onBodyGlass).toHaveBeenCalledWith(true);
    expect(fns.onWindowGlass).toHaveBeenCalledWith(false);
    expect(fns.onUiScale).toHaveBeenCalledWith(125);
    expect(fns.onChatBackgroundBlur).toHaveBeenCalledWith(look.image!.blur);
    expect(loadLiveBackground()).toBe("silk");
    expect(loadLiveBackgroundIntensity()).toBe(0.5);
    expect(loadCrewTheme()).toBe("matrix");
    expect(loadInteractionTint().source).toBe("accent");
    expect(loadScrollbarStyle().size).toBe("large");
    expect(loadSessionListDisplay()).toMatchObject({
      density: "compact",
      showModel: false,
      showBranch: false,
    });
  });

  it("captures and restores the chat image layer with saved looks", () => {
    const { appearance, fns } = mockAppearance();
    applyAppearanceSnapshot(appearance, {
      preferences: { ...APPEARANCE_DEFAULTS, chatBackgroundLayer: false },
    });
    expect(fns.onPreferences).toHaveBeenCalledWith(
      expect.objectContaining({ chatBackgroundLayer: false }),
    );
    expect(captureAppearanceSnapshot().preferences?.chatBackgroundLayer).toBe(true);
  });

  it("captures and restores surface contrast with the preferences record", () => {
    const { appearance, fns } = mockAppearance();
    applyAppearanceSnapshot(appearance, {
      preferences: { ...APPEARANCE_DEFAULTS, surfaceContrast: 135 },
    });
    expect(fns.onPreferences.mock.calls[0]![0]).toMatchObject({ surfaceContrast: 135 });
    expect(captureAppearanceSnapshot().preferences?.surfaceContrast).toBe(100);
  });

  it("keeps word wrap and chat width and skips settings the snapshot does not hold", () => {
    const { appearance, fns } = mockAppearance();
    applyAppearanceSnapshot(appearance, {
      preferences: { ...APPEARANCE_DEFAULTS, wordWrap: false, chatWidth: "full", codeSize: 16 },
    });
    expect(fns.onPreferences.mock.calls[0]![0]).toMatchObject({
      codeSize: 16,
      wordWrap: true,
      chatWidth: "comfortable",
    });
    expect(fns.onTint).not.toHaveBeenCalled();
    expect(fns.onOpacity).not.toHaveBeenCalled();
    expect(fns.onAccentColor).not.toHaveBeenCalled();
  });
});
