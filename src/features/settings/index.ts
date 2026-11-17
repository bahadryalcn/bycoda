/** Public types and optional surface loaders. Runtime contracts are declared below. */
export type {
  ChangesView,
  ChatBackgroundScope,
  ColorScheme,
  NewThreadBackgroundEffect,
  TranscriptLayout,
} from "./model/appearance";
export type { McpConnection } from "./model/mcp";
export type { McpSettingsSnapshot } from "./model/mcpSettingsCache";
export type { CrewTheme, DiffLayout, FollowUpBehavior } from "./model/settings";
export type * as modelAppearanceApi from "./public/appearance";
export type * as uiChatBackgroundMediaApi from "./public/ChatBackgroundMedia";
export type * as uiBackgroundHistoryApi from "./public/BackgroundHistory";
export type * as modelBackgroundControlApi from "./public/backgroundControl";
export type * as modelAppearancePreferencesApi from "./public/appearancePreferences";
export type * as modelApplicationPreferencesControlApi from "./public/applicationPreferencesControl";
export type * as modelComposerSpellingApi from "./public/composerSpelling";
export type * as modelDecorativeMotionApi from "./public/decorativeMotion";
export type * as modelMcpApi from "./public/mcp";
export type * as modelMcpSettingsCacheApi from "./public/mcpSettingsCache";
export type * as modelModelsSettingsLinkApi from "./public/modelsSettingsLink";
export type * as modelNewThreadBackgroundEffectsApi from "./public/newThreadBackgroundEffects";
export type * as modelProjectSidebarTabApi from "./public/projectSidebarTab";
export type * as modelSettingsLinkApi from "./public/settingsLink";
export type * as modelSettingsApi from "./public/settings";
export type * as modelSoundsApi from "./public/sounds";
export type * as modelUseKeybindingShortcutApi from "./public/useKeybindingShortcut";
export type * as uiConnectionRecoverySettingsApi from "./public/ConnectionRecoverySettings";
export type * as uiGradientBlurBackgroundApi from "./public/GradientBlurBackground";
export type * as uiLiveBackgroundCanvasApi from "./public/LiveBackgroundCanvas";
export type * as uiDesignStudioApi from "./public/DesignStudio";
export type * as uiSettingsControlsApi from "../../shared/ui/settings";
