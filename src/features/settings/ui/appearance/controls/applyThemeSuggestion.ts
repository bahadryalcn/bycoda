import { updateSessionListDisplay } from "../../../../sessions/public/sessionListDisplay";
import { backgroundGradientChange } from "../../../model/backgroundGradient";
import type { AppearancePreferences } from "../../../model/appearancePreferences";
import { applyThemeDecorativeMotion } from "../../../model/decorativeMotion";
import { loadInteractionTint, saveInteractionTint } from "../../../model/interactionTint";
import { saveLiveBackground, saveLiveBackgroundIntensity } from "../../../model/liveBackground";
import { loadScrollbarStyle, saveScrollbarStyle } from "../../../model/scrollbarStyle";
import {
  saveCrewGrowthEnabled,
  saveCrewSceneEnabled,
  saveCrewTheme,
  saveTabAnimationsEnabled,
} from "../../../model/settings";
import { resolveImageTuning, resolveThemeTypography } from "../../../model/themeSuggestionFields";
import { ensureAccentContrast, type ThemeSuggestion } from "../../../model/themeSuggestions";
import { loadWorkingIndicator, saveWorkingIndicator } from "../../../model/workingIndicator";
import {
  loadWorkspaceBackground,
  saveWorkspaceBackground,
} from "../../../model/workspaceBackground";
import type { AppearanceSettings } from "../../useAppearanceSettings";

/** Preference fields a suggestion sets, merged into the record in one write. */
function preferenceChanges(
  suggestion: ThemeSuggestion,
  currentCodeSize: number,
): Partial<AppearancePreferences> {
  const { interface: ui } = suggestion;
  const type =
    suggestion.typography && resolveThemeTypography(suggestion.typography, currentCodeSize);
  const changes: Partial<AppearancePreferences> = {
    ...(suggestion.canvas ? { canvasBackground: suggestion.canvas } : {}),
    ...(suggestion.interfaceFont ? { interfaceFont: suggestion.interfaceFont } : {}),
    ...(suggestion.codeFont ? { codeFont: suggestion.codeFont } : {}),
    ...(suggestion.codeTheme ? { codeTheme: suggestion.codeTheme } : {}),
    ...(suggestion.density ? { controlDensity: suggestion.density } : {}),
  };
  if (type?.codeSize !== undefined) changes.codeSize = type.codeSize;
  if (type?.ligatures !== undefined) changes.codeLigatures = type.ligatures;
  if (type?.terminalFont !== undefined) {
    changes.terminalFont = type.terminalFont;
    changes.terminalFontSource = "custom";
  }
  if (type?.terminalSize !== undefined) changes.terminalSize = type.terminalSize;
  if (type?.terminalWeight !== undefined) changes.terminalWeight = type.terminalWeight;
  if (type?.terminalLineHeight !== undefined) changes.terminalLineHeight = type.terminalLineHeight;
  if (ui?.contrast !== undefined) changes.contrast = ui.contrast;
  if (ui?.accentReadability) changes.accentReadability = ui.accentReadability;
  return changes;
}

function applyInterface(
  appearance: AppearanceSettings,
  ui: NonNullable<ThemeSuggestion["interface"]>,
) {
  if (ui.uiScale !== undefined) appearance.onUiScale(ui.uiScale);
  if (ui.diffPalette) appearance.onDiffPalette(ui.diffPalette);
  const row = {
    ...(ui.rowDensity ? { density: ui.rowDensity } : {}),
    ...(ui.showModel !== undefined ? { showModel: ui.showModel } : {}),
    ...(ui.showBranch !== undefined ? { showBranch: ui.showBranch } : {}),
  };
  if (Object.keys(row).length > 0) updateSessionListDisplay(row);
  const scrollbar = {
    ...(ui.scrollbarColor ? { color: ui.scrollbarColor } : {}),
    ...(ui.scrollbarSize ? { size: ui.scrollbarSize } : {}),
    ...(ui.scrollbarVisibility ? { visibility: ui.scrollbarVisibility } : {}),
  };
  if (Object.keys(scrollbar).length > 0)
    saveScrollbarStyle({ ...loadScrollbarStyle(), ...scrollbar });
  if (ui.tintSource) saveInteractionTint({ ...loadInteractionTint(), source: ui.tintSource });
  const working = {
    ...(ui.workingColor ? { color: ui.workingColor } : {}),
    ...(ui.workingStyle ? { style: ui.workingStyle } : {}),
  };
  if (Object.keys(working).length > 0)
    saveWorkingIndicator({ ...loadWorkingIndicator(), ...working });
}

function applyBackground(
  appearance: AppearanceSettings,
  background: NonNullable<ThemeSuggestion["background"]>,
) {
  if (background.sidebarOpacity !== undefined) appearance.onOpacity(background.sidebarOpacity);
  if (background.mainOpacity !== undefined) appearance.onMainOpacity(background.mainOpacity);
  if (background.sidebarBlur !== undefined) appearance.onBlur(background.sidebarBlur);
  if (background.bodyGlass !== undefined) appearance.onBodyGlass(background.bodyGlass);
  if (background.windowGlass !== undefined) appearance.onWindowGlass(background.windowGlass);
  if (background.liveScene) saveLiveBackground(background.liveScene);
  if (background.liveIntensity !== undefined)
    saveLiveBackgroundIntensity(background.liveIntensity / 100);
  if (background.newThreadEffect)
    appearance.onNewThreadBackgroundEffect(background.newThreadEffect);
}

/** Scope, opacity per view and blur of the chat background image. */
export function applyImageTuning(
  appearance: AppearanceSettings,
  image: NonNullable<ThemeSuggestion["image"]>,
) {
  if (image.scope) appearance.onChatBackgroundScope(image.scope);
  if (image.emptyOpacity !== undefined) appearance.onChatBackgroundEmptyOpacity(image.emptyOpacity);
  if (image.sessionOpacity !== undefined)
    appearance.onChatBackgroundSessionOpacity(image.sessionOpacity);
  if (image.blur !== undefined) appearance.onChatBackgroundBlur(image.blur);
}

/** Applied after a drawn image is in place: the model's values, else readable defaults. */
export function applyDrawnImageTuning(appearance: AppearanceSettings, suggestion: ThemeSuggestion) {
  applyImageTuning(appearance, resolveImageTuning(suggestion.image));
}

/**
 * Applies a suggestion through the existing setters: tint and accent always (the accent always
 * passes contrast), every optional field only when the model chose it. Preference fields share one
 * `onPreferences` write.
 */
export function applyThemeSuggestion(appearance: AppearanceSettings, suggestion: ThemeSuggestion) {
  if (suggestion.scheme) appearance.onThemePreference(suggestion.scheme);
  appearance.onTint(suggestion.hue, suggestion.saturation);
  appearance.onAccentColor(ensureAccentContrast(suggestion.accent));
  if (suggestion.darkLightness !== undefined) appearance.onDarkLightness(suggestion.darkLightness);
  const preferences = preferenceChanges(suggestion, appearance.preferences.codeSize);
  if (Object.keys(preferences).length > 0)
    appearance.onPreferences({ ...appearance.preferences, ...preferences });
  if (suggestion.gradient) {
    const background = loadWorkspaceBackground();
    const change = backgroundGradientChange(suggestion.gradient);
    saveWorkspaceBackground(
      { ...background, ...change },
      {
        base: background,
        fields: Object.keys(change) as (keyof typeof change)[],
      },
    );
  }
  if (suggestion.interface) applyInterface(appearance, suggestion.interface);
  if (suggestion.background) applyBackground(appearance, suggestion.background);
  if (suggestion.image) applyImageTuning(appearance, suggestion.image);
  const motion = suggestion.motion;
  if (motion?.crewTheme) saveCrewTheme(motion.crewTheme);
  if (motion?.showCrew !== undefined) saveCrewSceneEnabled(motion.showCrew);
  if (motion?.crewGrowth !== undefined) saveCrewGrowthEnabled(motion.crewGrowth);
  if (motion?.decorative !== undefined) applyThemeDecorativeMotion(motion.decorative);
  if (motion?.tabAnimations !== undefined) saveTabAnimationsEnabled(motion.tabAnimations);
}
