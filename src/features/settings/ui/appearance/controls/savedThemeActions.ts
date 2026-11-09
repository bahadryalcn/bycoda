import { updateSessionListDisplay } from "../../../../sessions/public/sessionListDisplay";
import type { AppearanceSnapshot } from "../../../model/appearanceSnapshot";
import { captureAppearanceSnapshot } from "../../../model/appearanceSnapshot";
import { ensureCurrentLibraryImage, listBackgroundLibrary } from "../../../model/backgroundLibrary";
import { applyThemeDecorativeMotion } from "../../../model/decorativeMotion";
import { saveInteractionTint } from "../../../model/interactionTint";
import { saveLiveBackground, saveLiveBackgroundIntensity } from "../../../model/liveBackground";
import {
  addSavedTheme,
  loadSavedThemes,
  overwriteSavedTheme,
  removeSavedTheme,
  renameSavedTheme,
  saveSavedThemes,
  type SavedTheme,
} from "../../../model/savedThemes";
import { saveScrollbarStyle } from "../../../model/scrollbarStyle";
import {
  saveCrewGrowthEnabled,
  saveCrewSceneEnabled,
  saveCrewTheme,
  saveTabAnimationsEnabled,
} from "../../../model/settings";
import { saveWorkingIndicator } from "../../../model/workingIndicator";
import { saveWorkspaceBackground } from "../../../model/workspaceBackground";
import type { AppearanceSettings } from "../../useAppearanceSettings";

const percent = (fraction: number) => Math.round(fraction * 100);

/**
 * Restores every setting the snapshot holds through the existing setters, exactly as saved (no
 * contrast or readability guard like a generated theme gets). Settings it does not hold stay as
 * they are; word wrap is a behavior preference and always stays.
 */
export function applyAppearanceSnapshot(appearance: AppearanceSettings, look: AppearanceSnapshot) {
  if (look.scheme) appearance.onThemePreference(look.scheme);
  if (look.hue !== undefined && look.saturation !== undefined)
    appearance.onTint(look.hue, look.saturation);
  if (look.darkLightness !== undefined) appearance.onDarkLightness(look.darkLightness);
  if (look.accent !== undefined) appearance.onAccentColor(look.accent);
  if (look.preferences)
    // Word wrap and chat width are Chat settings the owner keeps; a look never moves them.
    appearance.onPreferences({
      ...look.preferences,
      wordWrap: appearance.preferences.wordWrap,
      chatWidth: appearance.preferences.chatWidth,
    });
  if (look.gradient) saveWorkspaceBackground(look.gradient, { replace: true });
  if (look.uiScale !== undefined) appearance.onUiScale(percent(look.uiScale));
  if (look.diffPalette) appearance.onDiffPalette(look.diffPalette);
  if (look.sessionList) updateSessionListDisplay(look.sessionList);
  if (look.scrollbar) saveScrollbarStyle(look.scrollbar);
  if (look.tint) saveInteractionTint(look.tint);
  if (look.working) saveWorkingIndicator(look.working);
  const glass = look.glass;
  if (glass) {
    appearance.onOpacity(percent(glass.sidebarOpacity));
    appearance.onMainOpacity(percent(glass.mainOpacity));
    appearance.onBlur(glass.sidebarBlur);
    appearance.onBodyGlass(glass.bodyGlass);
    appearance.onWindowGlass(glass.windowGlass);
  }
  if (look.live) {
    saveLiveBackground(look.live.scene);
    saveLiveBackgroundIntensity(look.live.intensity);
  }
  const image = look.image;
  if (image) {
    appearance.onChatBackgroundScope(image.scope);
    appearance.onChatBackgroundEmptyOpacity(percent(image.emptyOpacity));
    appearance.onChatBackgroundSessionOpacity(percent(image.sessionOpacity));
    appearance.onChatBackgroundBlur(image.blur);
    appearance.onNewThreadBackgroundEffect(image.effect);
  }
  const motion = look.motion;
  if (motion) {
    saveCrewTheme(motion.crewTheme);
    saveCrewSceneEnabled(motion.showCrew);
    saveCrewGrowthEnabled(motion.crewGrowth);
    applyThemeDecorativeMotion(motion.decorative);
    saveTabAnimationsEnabled(motion.tabAnimations);
  }
}

/** What the current chat background is in the library; none when there is no image or it cannot be kept. */
async function currentImageId(appearance: AppearanceSettings): Promise<string | undefined> {
  const path = appearance.chatBackgroundPath;
  if (!path) return undefined;
  try {
    return (await ensureCurrentLibraryImage(path)).id;
  } catch {
    return undefined;
  }
}

/** Stores the current look under `name`; `false` when storage failed or the list is full. */
export async function saveCurrentLook(appearance: AppearanceSettings, name: string) {
  const imageId = await currentImageId(appearance);
  const before = loadSavedThemes();
  const after = addSavedTheme(
    before,
    { name, look: captureAppearanceSnapshot(), imageId },
    Date.now(),
    crypto.randomUUID(),
  );
  return after.length > before.length && saveSavedThemes(after);
}

export async function overwriteWithCurrentLook(appearance: AppearanceSettings, id: string) {
  const imageId = await currentImageId(appearance);
  return saveSavedThemes(
    overwriteSavedTheme(
      loadSavedThemes(),
      id,
      { look: captureAppearanceSnapshot(), imageId },
      Date.now(),
    ),
  );
}

export function renameTheme(id: string, name: string) {
  return saveSavedThemes(renameSavedTheme(loadSavedThemes(), id, name, Date.now()));
}

export function deleteTheme(id: string) {
  return saveSavedThemes(removeSavedTheme(loadSavedThemes(), id));
}

/**
 * Applies the whole look, including the library image. A theme without an image clears the
 * current one. Resolves to `"image-missing"` when its image is no longer in the library.
 */
export async function applySavedTheme(
  appearance: AppearanceSettings,
  theme: SavedTheme,
): Promise<"applied" | "image-missing"> {
  applyAppearanceSnapshot(appearance, theme.look);
  if (!theme.imageId) {
    if (appearance.chatBackgroundPath) await appearance.onClearChatBackground();
    return "applied";
  }
  const image = (await listBackgroundLibrary()).find((entry) => entry.id === theme.imageId);
  if (!image) return "image-missing";
  const path = await appearance.onChooseChatBackground(image.path, {
    libraryId: image.id,
  });
  return path ? "applied" : "image-missing";
}
