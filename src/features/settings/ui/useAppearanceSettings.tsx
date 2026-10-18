import { useCallback, useEffect, useState } from "react";
import {
  LIVE_BACKGROUND_DEFAULT,
  LIVE_BACKGROUND_INTENSITY_DEFAULT,
  saveLiveBackground,
  saveLiveBackgroundIntensity,
} from "../model/liveBackground";
import {
  APPEARANCE_DEFAULTS,
  APPEARANCE_PREFERENCES_EVENT,
  loadAppearancePreferences,
  saveAppearancePreferences,
  type AppearancePreferences,
} from "../model/appearancePreferences";

import {
  applyChatBackground,
  applyChatBackgroundBlur,
  applyChatBackgroundEmptyOpacity,
  applyChatBackgroundSessionOpacity,
  applyChatBackgroundScope,
  applyDiffPalette,
  loadDiffPalette,
  saveDiffPalette,
  DIFF_PALETTE_DEFAULT,
  type DiffPalette,
  applyAccentColor,
  applyBodyGlass,
  applySidebarBlur,
  applySidebarOpacity,
  applyMainOpacity,
  applyThemeDarkLightness,
  applyThemePreference,
  applyThemeTint,
  BODY_GLASS_DEFAULT,
  ACCENT_COLOR_DEFAULT,
  CHAT_BACKGROUND_BLUR_DEFAULT,
  CHAT_BACKGROUND_EMPTY_OPACITY_DEFAULT,
  CHAT_BACKGROUND_SESSION_OPACITY_DEFAULT,
  CHAT_BACKGROUND_SCOPE_DEFAULT,
  THEME_PREFERENCE_DEFAULT,
  loadBodyGlass,
  loadAccentColor,
  loadChatBackgroundBlur,
  loadChatBackgroundEmptyOpacity,
  loadChatBackgroundPath,
  loadChatBackgroundSessionOpacity,
  loadChatBackgroundScope,
  loadNewThreadBackgroundEffect,
  loadThemeDarkLightness,
  loadThemePreference,
  loadSidebarBlur,
  loadSidebarOpacity,
  loadMainOpacity,
  loadThemeHue,
  loadThemeSaturation,
  saveBodyGlass,
  saveAccentColor,
  saveChatBackgroundBlur,
  saveChatBackgroundEmptyOpacity,
  saveChatBackgroundPath,
  saveChatBackgroundSessionOpacity,
  saveChatBackgroundScope,
  setNewThreadBackgroundEffect,
  saveThemeDarkLightness,
  saveThemePreference,
  saveSidebarBlur,
  saveSidebarOpacity,
  saveMainOpacity,
  saveThemeHue,
  saveThemeSaturation,
  subscribeThemeStorage,
  isLightScheme,
  syncNativeGlass,
  loadShowExcludedFiles,
  saveShowExcludedFiles,
  SIDEBAR_BLUR_DEFAULT,
  SIDEBAR_OPACITY_DEFAULT,
  MAIN_OPACITY_DEFAULT,
  THEME_DARK_LIGHTNESS_DEFAULT,
  THEME_HUE_DEFAULT,
  THEME_SATURATION_DEFAULT,
  type ThemePreference,
  type ChatBackgroundScope,
  NEW_THREAD_BACKGROUND_EFFECT_DEFAULT,
  type NewThreadBackgroundEffect,
} from "../model/appearance";
import {
  pickAndSaveChatBackground,
  removeChatBackground,
} from "../../projects/model/chatBackground";
import {
  applyUiScale,
  loadUiScale,
  saveUiScale,
  subscribeUiScale,
  UI_SCALE_DEFAULT,
} from "../model/uiScale";

import { IS_LINUX } from "../../../platform/tauri/platform";

import {
  loadCollapsedProjectRailMode,
  saveCollapsedProjectRailMode,
  COLLAPSED_PROJECT_RAIL_MODE_DEFAULT,
  type CollapsedProjectRailMode,
} from "../model/settings";

export type AppearanceSettings = ReturnType<typeof useAppearanceSettings>;

export function useAppearanceSettings(
  controlledCollapsedProjectRailMode?: CollapsedProjectRailMode,
  onControlledCollapsedProjectRailModeChange?: (mode: CollapsedProjectRailMode) => void,
) {
  const [preferences, setPreferences] = useState(loadAppearancePreferences);
  useEffect(() => {
    const sync = () => setPreferences(loadAppearancePreferences());
    window.addEventListener(APPEARANCE_PREFERENCES_EVENT, sync);
    return () => window.removeEventListener(APPEARANCE_PREFERENCES_EVENT, sync);
  }, []);
  const onPreferences = useCallback((next: AppearancePreferences) => {
    setPreferences(saveAppearancePreferences(next));
  }, []);
  const [themePreference, setThemePreference] = useState<ThemePreference>(loadThemePreference);
  const [accentColor, setAccentColor] = useState(loadAccentColor);
  const [opacity, setOpacity] = useState(loadSidebarOpacity);
  const [mainOpacity, setMainOpacity] = useState(loadMainOpacity);
  const [blur, setBlur] = useState(loadSidebarBlur);
  const [themeHue, setThemeHue] = useState(loadThemeHue);
  const [themeSaturation, setThemeSaturation] = useState(loadThemeSaturation);
  const [themeDarkLightness, setThemeDarkLightness] = useState(loadThemeDarkLightness);
  useEffect(() => {
    const sync = () => {
      setThemePreference(loadThemePreference());
      setAccentColor(loadAccentColor());
      setThemeHue(loadThemeHue());
      setThemeSaturation(loadThemeSaturation());
      setThemeDarkLightness(loadThemeDarkLightness());
    };
    const unsubscribe = subscribeThemeStorage(sync);
    sync();
    return unsubscribe;
  }, []);
  const [bodyGlass, setBodyGlass] = useState(loadBodyGlass);
  const [showExcludedFiles, setShowExcludedFiles] = useState(loadShowExcludedFiles);
  const [chatBackgroundPath, setChatBackgroundPath] = useState(loadChatBackgroundPath);
  const [chatBackgroundEmptyOpacity, setChatBackgroundEmptyOpacity] = useState(
    loadChatBackgroundEmptyOpacity,
  );
  const [chatBackgroundSessionOpacity, setChatBackgroundSessionOpacity] = useState(
    loadChatBackgroundSessionOpacity,
  );
  const [chatBackgroundBlur, setChatBackgroundBlur] = useState(loadChatBackgroundBlur);
  const [diffPalette, setDiffPalette] = useState<DiffPalette>(loadDiffPalette);
  const [chatBackgroundScope, setChatBackgroundScope] =
    useState<ChatBackgroundScope>(loadChatBackgroundScope);
  const [newThreadBackgroundEffect, setBackgroundEffect] = useState<NewThreadBackgroundEffect>(
    loadNewThreadBackgroundEffect,
  );
  const [chatBackgroundBusy, setChatBackgroundBusy] = useState(false);
  const [chatBackgroundError, setChatBackgroundError] = useState<string | null>(null);
  const [uiScale, setUiScale] = useState(loadUiScale);
  const [storedCollapsedProjectRailMode, setStoredCollapsedProjectRailMode] =
    useState<CollapsedProjectRailMode>(loadCollapsedProjectRailMode);
  const collapsedProjectRailMode =
    controlledCollapsedProjectRailMode ?? storedCollapsedProjectRailMode;

  useEffect(() => subscribeUiScale(() => setUiScale(loadUiScale())), []);

  const onThemePreference = useCallback((next: ThemePreference) => {
    applyThemePreference(next, { animate: true });
    saveThemePreference(next);
    setThemePreference(next);
  }, []);

  const onAccentColor = useCallback((value: string | null) => {
    const next = applyAccentColor(value);
    saveAccentColor(next);
    setAccentColor(next);
  }, []);

  const onOpacity = useCallback((percent: number) => {
    const next = applySidebarOpacity(percent / 100);
    saveSidebarOpacity(next);
    setOpacity(next);
  }, []);

  const onMainOpacity = useCallback((percent: number) => {
    const next = applyMainOpacity(percent / 100);
    saveMainOpacity(next);
    setMainOpacity(next);
  }, []);

  const onBlur = useCallback((radius: number) => {
    const next = applySidebarBlur(radius);
    saveSidebarBlur(next);
    setBlur(next);
  }, []);

  const onTint = useCallback((hue: number, saturation: number) => {
    const next = applyThemeTint(hue, saturation);
    saveThemeHue(next.hue);
    saveThemeSaturation(next.saturation);
    setThemeHue(next.hue);
    setThemeSaturation(next.saturation);
  }, []);

  const onDarkLightness = useCallback((value: number) => {
    const next = applyThemeDarkLightness(value);
    saveThemeDarkLightness(next);
    setThemeDarkLightness(next);
  }, []);

  const onBodyGlass = useCallback((next: boolean) => {
    applyBodyGlass(next);
    saveBodyGlass(next);
    setBodyGlass(next);
    if (IS_LINUX) syncNativeGlass(isLightScheme() ? "light" : "dark");
  }, []);

  const onShowExcludedFiles = useCallback((next: boolean) => {
    saveShowExcludedFiles(next);
    setShowExcludedFiles(next);
  }, []);

  const onChooseChatBackground = useCallback(async () => {
    setChatBackgroundBusy(true);
    setChatBackgroundError(null);
    try {
      const path = await pickAndSaveChatBackground();
      if (!path) return;
      saveChatBackgroundPath(path);
      applyChatBackground(path);
      setChatBackgroundPath(path);
    } catch (error) {
      setChatBackgroundError(error instanceof Error ? error.message : String(error));
    } finally {
      setChatBackgroundBusy(false);
    }
  }, []);

  const onClearChatBackground = useCallback(async () => {
    setChatBackgroundBusy(true);
    setChatBackgroundError(null);
    try {
      await removeChatBackground();
      saveChatBackgroundPath(null);
      applyChatBackground(null);
      setChatBackgroundPath(null);
    } catch (error) {
      setChatBackgroundError(error instanceof Error ? error.message : String(error));
    } finally {
      setChatBackgroundBusy(false);
    }
  }, []);

  const onChatBackgroundEmptyOpacity = useCallback((percent: number) => {
    const next = applyChatBackgroundEmptyOpacity(percent / 100);
    saveChatBackgroundEmptyOpacity(next);
    setChatBackgroundEmptyOpacity(next);
  }, []);

  const onChatBackgroundSessionOpacity = useCallback((percent: number) => {
    const next = applyChatBackgroundSessionOpacity(percent / 100);
    saveChatBackgroundSessionOpacity(next);
    setChatBackgroundSessionOpacity(next);
  }, []);

  const onChatBackgroundBlur = useCallback((radius: number) => {
    const next = applyChatBackgroundBlur(radius);
    saveChatBackgroundBlur(next);
    setChatBackgroundBlur(next);
  }, []);

  const onDiffPalette = useCallback((next: DiffPalette) => {
    applyDiffPalette(next);
    saveDiffPalette(next);
    setDiffPalette(next);
  }, []);

  const onChatBackgroundScope = useCallback((next: ChatBackgroundScope) => {
    applyChatBackgroundScope(next);
    saveChatBackgroundScope(next);
    setChatBackgroundScope(next);
  }, []);

  const onNewThreadBackgroundEffect = useCallback((next: NewThreadBackgroundEffect) => {
    setNewThreadBackgroundEffect(next);
    setBackgroundEffect(next);
  }, []);

  const onUiScale = useCallback((percent: number) => {
    const next = saveUiScale(percent / 100);
    setUiScale(next);
    void applyUiScale(next);
  }, []);

  const onCollapsedProjectRailMode = useCallback(
    (next: CollapsedProjectRailMode) => {
      saveCollapsedProjectRailMode(next);
      setStoredCollapsedProjectRailMode(next);
      onControlledCollapsedProjectRailModeChange?.(next);
    },
    [onControlledCollapsedProjectRailModeChange],
  );

  const restoreDefaults = useCallback(() => {
    onPreferences({
      ...APPEARANCE_DEFAULTS,
      chatWidth: preferences.chatWidth,
      wordWrap: preferences.wordWrap,
    });
    onThemePreference(THEME_PREFERENCE_DEFAULT);
    onAccentColor(ACCENT_COLOR_DEFAULT);
    onOpacity(Math.round(SIDEBAR_OPACITY_DEFAULT * 100));
    onMainOpacity(Math.round(MAIN_OPACITY_DEFAULT * 100));
    onBlur(SIDEBAR_BLUR_DEFAULT);
    onTint(THEME_HUE_DEFAULT, THEME_SATURATION_DEFAULT);
    onDarkLightness(THEME_DARK_LIGHTNESS_DEFAULT);
    onBodyGlass(BODY_GLASS_DEFAULT);
    onChatBackgroundEmptyOpacity(Math.round(CHAT_BACKGROUND_EMPTY_OPACITY_DEFAULT * 100));
    onChatBackgroundSessionOpacity(Math.round(CHAT_BACKGROUND_SESSION_OPACITY_DEFAULT * 100));
    onChatBackgroundScope(CHAT_BACKGROUND_SCOPE_DEFAULT);
    onDiffPalette(DIFF_PALETTE_DEFAULT);
    onChatBackgroundBlur(CHAT_BACKGROUND_BLUR_DEFAULT);
    onNewThreadBackgroundEffect(NEW_THREAD_BACKGROUND_EFFECT_DEFAULT);
    saveLiveBackground(LIVE_BACKGROUND_DEFAULT);
    saveLiveBackgroundIntensity(LIVE_BACKGROUND_INTENSITY_DEFAULT);
    if (chatBackgroundPath) void onClearChatBackground();
    onUiScale(Math.round(UI_SCALE_DEFAULT * 100));
    onCollapsedProjectRailMode(COLLAPSED_PROJECT_RAIL_MODE_DEFAULT);
  }, [
    preferences.chatWidth,
    preferences.wordWrap,
    onPreferences,
    chatBackgroundPath,
    onBlur,
    onBodyGlass,
    onChatBackgroundEmptyOpacity,
    onChatBackgroundSessionOpacity,
    onChatBackgroundScope,
    onDiffPalette,
    onChatBackgroundBlur,
    onNewThreadBackgroundEffect,
    onClearChatBackground,
    onAccentColor,
    onThemePreference,
    onOpacity,
    onMainOpacity,
    onTint,
    onDarkLightness,
    onUiScale,
    onCollapsedProjectRailMode,
  ]);

  return {
    preferences,
    onPreferences,
    themePreference,
    accentColor,
    opacity,
    mainOpacity,
    blur,
    themeHue,
    themeSaturation,
    themeDarkLightness,
    bodyGlass,
    showExcludedFiles,
    chatBackgroundPath,
    chatBackgroundEmptyOpacity,
    chatBackgroundSessionOpacity,
    chatBackgroundScope,
    diffPalette,
    chatBackgroundBlur,
    newThreadBackgroundEffect,
    chatBackgroundBusy,
    chatBackgroundError,
    uiScale,
    collapsedProjectRailMode,
    onThemePreference,
    onAccentColor,
    onOpacity,
    onMainOpacity,
    onBlur,
    onTint,
    onDarkLightness,
    onBodyGlass,
    onShowExcludedFiles,
    onChooseChatBackground,
    onClearChatBackground,
    onChatBackgroundEmptyOpacity,
    onChatBackgroundSessionOpacity,
    onChatBackgroundScope,
    onDiffPalette,
    onChatBackgroundBlur,
    onNewThreadBackgroundEffect,
    onUiScale,
    onCollapsedProjectRailMode,
    restoreDefaults,
  };
}
