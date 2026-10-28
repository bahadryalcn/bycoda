import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  readAppearanceSaveIssues,
  retryAppearanceSave,
  subscribeAppearanceSaveIssues,
} from "../model/appearancePersistence";
import { Button } from "../../../shared/ui/Button";
import { SettingsFeedback } from "./settingsControls";
import { t, useLocale } from "../../../shared/i18n";
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
  appearancePreferencesReadUnavailable,
  normalizeAppearancePreferences,
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
  WINDOW_GLASS_DEFAULT,
  ACCENT_COLOR_DEFAULT,
  CHAT_BACKGROUND_BLUR_DEFAULT,
  CHAT_BACKGROUND_EMPTY_OPACITY_DEFAULT,
  CHAT_BACKGROUND_SESSION_OPACITY_DEFAULT,
  CHAT_BACKGROUND_SCOPE_DEFAULT,
  THEME_PREFERENCE_DEFAULT,
  loadBodyGlass,
  loadWindowGlass,
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
  saveWindowGlass,
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
  subscribeShowExcludedFiles,
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
  subscribeCollapsedProjectRailMode,
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
  const preferencesBase = useRef(preferences);
  const preferencesDraft = useRef<AppearancePreferences | null>(null);
  const [preferencesDirty, setPreferencesDirty] = useState(false);
  const [preferencesUnavailable, setPreferencesUnavailable] = useState(
    appearancePreferencesReadUnavailable,
  );
  const receivePreferences = useCallback((current: AppearancePreferences) => {
    const draft = preferencesDraft.current;
    const edits = draft
      ? Object.entries(draft).filter(
          ([key, value]) => value !== preferencesBase.current[key as keyof AppearancePreferences],
        )
      : [];
    const unresolved = edits.some(
      ([key, value]) => current[key as keyof AppearancePreferences] !== value,
    );
    const next = unresolved
      ? normalizeAppearancePreferences({ ...current, ...Object.fromEntries(edits) })
      : current;
    preferencesDraft.current = unresolved ? next : null;
    preferencesBase.current = current;
    setPreferencesDirty(unresolved);
    setPreferences(next);
  }, []);
  const retryPreferenceRead = useCallback(() => {
    const current = loadAppearancePreferences();
    const unavailable = appearancePreferencesReadUnavailable();
    setPreferencesUnavailable(unavailable);
    if (!unavailable) receivePreferences(current);
  }, [receivePreferences]);
  useEffect(() => {
    const sync = () => {
      const current = loadAppearancePreferences();
      setPreferencesUnavailable(appearancePreferencesReadUnavailable());
      if (!appearancePreferencesReadUnavailable()) receivePreferences(current);
    };
    window.addEventListener(APPEARANCE_PREFERENCES_EVENT, sync);
    return () => window.removeEventListener(APPEARANCE_PREFERENCES_EVENT, sync);
  }, [receivePreferences]);
  const onPreferences = useCallback((next: AppearancePreferences) => {
    try {
      const saved = saveAppearancePreferences(next, preferencesBase.current);
      preferencesBase.current = saved;
      preferencesDraft.current = null;
      setPreferencesDirty(false);
      setPreferences(saved);
      setPreferencesUnavailable(false);
    } catch {
      // Keep the editable draft; the DOM keeps the last durably saved appearance.
      const draft = normalizeAppearancePreferences(next);
      preferencesDraft.current = draft;
      setPreferences(draft);
      setPreferencesDirty(true);
      setPreferencesUnavailable(appearancePreferencesReadUnavailable());
    }
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
      setOpacity(loadSidebarOpacity());
      setMainOpacity(loadMainOpacity());
      setBlur(loadSidebarBlur());
      setBodyGlass(loadBodyGlass());
      setWindowGlass(loadWindowGlass());
      setChatBackgroundPath(loadChatBackgroundPath());
      setChatBackgroundEmptyOpacity(loadChatBackgroundEmptyOpacity());
      setChatBackgroundSessionOpacity(loadChatBackgroundSessionOpacity());
      setChatBackgroundScope(loadChatBackgroundScope());
      setChatBackgroundBlur(loadChatBackgroundBlur());
      setDiffPalette(loadDiffPalette());
      setBackgroundEffect(loadNewThreadBackgroundEffect());
    };
    const unsubscribe = subscribeThemeStorage(sync);
    sync();
    return unsubscribe;
  }, []);
  const [bodyGlass, setBodyGlass] = useState(loadBodyGlass);
  const [windowGlass, setWindowGlass] = useState(loadWindowGlass);
  const [showExcludedFiles, setShowExcludedFiles] = useState(loadShowExcludedFiles);
  useEffect(
    () => subscribeShowExcludedFiles(() => setShowExcludedFiles(loadShowExcludedFiles())),
    [],
  );
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
  const [chatBackgroundOperation, setChatBackgroundOperation] = useState<
    "choose" | "remove" | null
  >(null);
  const chatBackgroundPending = useRef(false);
  const [chatBackgroundError, setChatBackgroundError] = useState<string | null>(null);
  const [uiScale, setUiScale] = useState(loadUiScale);
  const [storedCollapsedProjectRailMode, setStoredCollapsedProjectRailMode] =
    useStoredPreferenceState(loadCollapsedProjectRailMode, subscribeCollapsedProjectRailMode);
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

  const onWindowGlass = useCallback((next: boolean) => {
    saveWindowGlass(next);
    setWindowGlass(next);
    if (!IS_LINUX) syncNativeGlass(isLightScheme() ? "light" : "dark");
  }, []);

  const onShowExcludedFiles = useCallback((next: boolean) => {
    saveShowExcludedFiles(next);
    setShowExcludedFiles(loadShowExcludedFiles());
  }, []);

  const onChooseChatBackground = useCallback(async () => {
    if (chatBackgroundPending.current) return;
    chatBackgroundPending.current = true;
    setChatBackgroundBusy(true);
    setChatBackgroundOperation("choose");
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
      chatBackgroundPending.current = false;
      setChatBackgroundBusy(false);
      setChatBackgroundOperation(null);
    }
  }, []);

  const onClearChatBackground = useCallback(async () => {
    if (chatBackgroundPending.current) return;
    chatBackgroundPending.current = true;
    setChatBackgroundBusy(true);
    setChatBackgroundOperation("remove");
    setChatBackgroundError(null);
    try {
      await removeChatBackground();
      saveChatBackgroundPath(null);
      applyChatBackground(null);
      setChatBackgroundPath(null);
    } catch (error) {
      setChatBackgroundError(error instanceof Error ? error.message : String(error));
    } finally {
      chatBackgroundPending.current = false;
      setChatBackgroundBusy(false);
      setChatBackgroundOperation(null);
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
    onWindowGlass(WINDOW_GLASS_DEFAULT);
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
    onWindowGlass,
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
    preferencesUnavailable,
    preferencesDirty,
    retryPreferenceRead,
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
    windowGlass,
    showExcludedFiles,
    chatBackgroundPath,
    chatBackgroundEmptyOpacity,
    chatBackgroundSessionOpacity,
    chatBackgroundScope,
    diffPalette,
    chatBackgroundBlur,
    newThreadBackgroundEffect,
    chatBackgroundBusy,
    chatBackgroundOperation,
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
    onWindowGlass,
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

/** Feedback stays in the owning Appearance topic; each retry targets only failed writes there. */
export function AppearanceSaveFeedback({ settingIds }: { settingIds: readonly string[] }) {
  useLocale();
  const all = useSyncExternalStore(
    subscribeAppearanceSaveIssues,
    readAppearanceSaveIssues,
    readAppearanceSaveIssues,
  );
  const issues = all.filter((issue) => settingIds.includes(issue.settingId));
  if (!issues.length) return null;
  return (
    <SettingsFeedback
      state="error"
      action={
        <Button onClick={() => issues.forEach((issue) => retryAppearanceSave(issue.key))}>
          {t("Retry save")}
        </Button>
      }
    >
      {issues.some((issue) => issue.applied)
        ? t("Applied in this window, but could not save. Retry before closing the app.")
        : t("Could not save changes. Your previous appearance remains active.")}
    </SettingsFeedback>
  );
}
