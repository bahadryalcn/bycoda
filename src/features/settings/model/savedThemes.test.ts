// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { captureAppearanceSnapshot, normalizeAppearanceSnapshot } from "./appearanceSnapshot";
import { saveInteractionTint } from "./interactionTint";
import { saveLiveBackground, saveLiveBackgroundIntensity } from "./liveBackground";
import {
  addSavedTheme,
  dropImageReference,
  loadSavedThemes,
  normalizeSavedThemes,
  overwriteSavedTheme,
  referencedImageIds,
  removeSavedTheme,
  renameSavedTheme,
  saveSavedThemes,
  SAVED_THEMES_MAX,
  themesUsingImage,
} from "./savedThemes";
import { saveScrollbarStyle } from "./scrollbarStyle";
import { saveCrewTheme } from "./settings";
import { saveWorkingIndicator } from "./workingIndicator";

const IMAGE = "0123456789abcdef01234567";
const OTHER = "76543210fedcba9876543210";

beforeEach(() => localStorage.clear());

describe("appearance snapshot", () => {
  it("survives a JSON round trip unchanged", () => {
    saveLiveBackground("silk");
    saveLiveBackgroundIntensity(0.5);
    saveCrewTheme("matrix");
    saveScrollbarStyle({ ...captureAppearanceSnapshot().scrollbar!, size: "wide" });
    saveWorkingIndicator({ ...captureAppearanceSnapshot().working!, style: "steady" });
    saveInteractionTint({ ...captureAppearanceSnapshot().tint!, source: "accent" });
    const look = captureAppearanceSnapshot();
    expect(normalizeAppearanceSnapshot(JSON.parse(JSON.stringify(look)))).toEqual(look);
    expect(look.live).toEqual({ scene: "silk", intensity: 0.5 });
    expect(look.motion?.crewTheme).toBe("matrix");
    expect(look.scrollbar?.size).toBe("wide");
    expect(look.working?.style).toBe("steady");
    expect(look.tint?.source).toBe("accent");
  });

  it("drops invalid fields and groups, clamps numbers", () => {
    const look = normalizeAppearanceSnapshot({
      scheme: "sepia",
      hue: 999,
      saturation: "high",
      accent: "red",
      diffPalette: "high-contrast",
      glass: { sidebarOpacity: 0.5, mainOpacity: 0.5, sidebarBlur: 8, bodyGlass: true },
      live: { scene: "silk", intensity: 0.4 },
      image: { scope: "all", emptyOpacity: 0.3, sessionOpacity: 0.2, blur: 4, effect: "nope" },
      motion: "yes",
    });
    expect(look.scheme).toBeUndefined();
    expect(look.hue).toBe(360);
    expect(look.saturation).toBeUndefined();
    expect(look.accent).toBeUndefined();
    expect(look.diffPalette).toBe("high-contrast");
    expect(look.glass).toBeUndefined();
    expect(look.live).toEqual({ scene: "silk", intensity: 0.4 });
    expect(look.image).toBeUndefined();
    expect(look.motion).toBeUndefined();
  });

  it("keeps the default accent as null and keeps a custom one as written", () => {
    expect(normalizeAppearanceSnapshot({ accent: null }).accent).toBeNull();
    expect(normalizeAppearanceSnapshot({ accent: "#ABCDEF" }).accent).toBe("#ABCDEF");
  });
});

describe("saved themes", () => {
  const look = { hue: 10, saturation: 20 };

  it("normalizes stored themes: bad entries, nameless and repeated ids are dropped", () => {
    const themes = normalizeSavedThemes([
      { id: "a", name: "  Kiln   glow ", createdAt: 5, look, imageId: IMAGE },
      { id: "a", name: "Duplicate", look },
      { id: "b", name: "   ", look },
      { name: "No id", look },
      "junk",
      { id: "c", name: "Bad image", look: { hue: "x" }, imageId: "../../evil" },
    ]);
    expect(themes.map((theme) => theme.id)).toEqual(["a", "c"]);
    expect(themes[0]).toMatchObject({ name: "Kiln glow", imageId: IMAGE, updatedAt: 5 });
    expect(themes[1]?.imageId).toBeUndefined();
    expect(themes[1]?.look).toEqual({});
    expect(normalizeSavedThemes("nope")).toEqual([]);
  });

  it("caps the list and stores and reloads through localStorage", () => {
    const many = Array.from({ length: SAVED_THEMES_MAX + 5 }, (_, index) => ({
      id: `t${index}`,
      name: `Theme ${index}`,
      look,
    }));
    expect(normalizeSavedThemes(many)).toHaveLength(SAVED_THEMES_MAX);
    const added = addSavedTheme([], { name: "Saved", look, imageId: IMAGE }, 1, "id1");
    expect(saveSavedThemes(added)).toBe(true);
    expect(loadSavedThemes()).toEqual(added);
    expect(saveSavedThemes([])).toBe(true);
    expect(loadSavedThemes()).toEqual([]);
  });

  it("reads a corrupt record as empty", () => {
    localStorage.setItem("bycoda.savedThemes.v1", "{not json");
    expect(loadSavedThemes()).toEqual([]);
  });

  it("renames, overwrites and removes", () => {
    let themes = addSavedTheme([], { name: "One", look, imageId: IMAGE }, 1, "a");
    themes = renameSavedTheme(themes, "a", " Two ", 2);
    expect(themes[0]).toMatchObject({ name: "Two", updatedAt: 2, createdAt: 1 });
    expect(renameSavedTheme(themes, "a", "  ", 3)[0]?.name).toBe("Two");
    themes = overwriteSavedTheme(themes, "a", { look: { hue: 99 } }, 4);
    expect(themes[0]).toMatchObject({ name: "Two", look: { hue: 99 }, updatedAt: 4 });
    expect(themes[0]?.imageId).toBeUndefined();
    expect(removeSavedTheme(themes, "a")).toEqual([]);
  });

  it("protects library images that themes reference", () => {
    let themes = addSavedTheme([], { name: "One", look, imageId: IMAGE }, 1, "a");
    themes = addSavedTheme(themes, { name: "Two", look }, 1, "b");
    themes = addSavedTheme(themes, { name: "Three", look, imageId: IMAGE }, 1, "c");
    expect([...referencedImageIds(themes)]).toEqual([IMAGE]);
    expect(themesUsingImage(themes, IMAGE).map((theme) => theme.name)).toEqual(["One", "Three"]);
    expect(themesUsingImage(themes, OTHER)).toEqual([]);
    const dropped = dropImageReference(themes, IMAGE);
    expect(referencedImageIds(dropped).size).toBe(0);
    expect(dropped.map((theme) => theme.name)).toEqual(["One", "Two", "Three"]);
    expect(dropImageReference(themes, OTHER)).toEqual(themes);
  });
});
