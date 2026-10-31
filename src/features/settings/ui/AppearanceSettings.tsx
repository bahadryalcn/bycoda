import { themePalette } from "../../../shared/theme/palette";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { ImagePlus } from "../../../shared/ui/icons";
import { CrewSettings, MotionSettings } from "./AppearanceBehaviorSettings";
import { AccentReadabilityControl } from "./AccentReadabilityControl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AppearancePreview,
  AppearanceStudio,
  AppearanceInterface,
  AppearanceTypography,
  isDefaultAccent,
} from "./AppearancePreviews";

import { ColorPickerPopover, ColorSwatchRow } from "../../../shared/ui/ColorPickerPopover";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Popover } from "../../../shared/ui/Popover";
import { Button } from "../../../shared/ui/Button";

import { GradientBlurBackground } from "./GradientBlurBackground";
import { LiveBackgroundPicker } from "./LiveBackgroundPicker";
import { SessionListSettings } from "./SessionListSettings";
import { COLLAPSED_PROJECT_RAIL_MODE_DEFAULT } from "../model/settings";

import { useColorScheme } from "../../../shared/hooks/useColorScheme";
import { IS_LINUX, IS_MAC } from "../../../platform/tauri/platform";
import {
  ACCENT_COLOR_DEFAULT,
  BODY_GLASS_DEFAULT,
  WINDOW_GLASS_DEFAULT,
  SIDEBAR_OPACITY_DEFAULT,
  MAIN_OPACITY_DEFAULT,
  SIDEBAR_BLUR_DEFAULT,
  CHAT_BACKGROUND_EMPTY_OPACITY_DEFAULT,
  CHAT_BACKGROUND_SESSION_OPACITY_DEFAULT,
  CHAT_BACKGROUND_SCOPE_DEFAULT,
  CHAT_BACKGROUND_BLUR_DEFAULT,
  NEW_THREAD_BACKGROUND_EFFECT_DEFAULT,
  CHAT_BACKGROUND_BLUR_MAX,
  CHAT_BACKGROUND_BLUR_MIN,
  CHAT_BACKGROUND_OPACITY_MAX,
  CHAT_BACKGROUND_OPACITY_MIN,
  chatBackgroundSrc,
  SIDEBAR_BLUR_MAX,
  SIDEBAR_BLUR_MIN,
  MAIN_OPACITY_MAX,
  MAIN_OPACITY_MIN,
  SIDEBAR_OPACITY_MAX,
  SIDEBAR_OPACITY_MIN,
  THEME_DARK_LIGHTNESS_DEFAULT,
  THEME_DARK_LIGHTNESS_MAX,
  THEME_DARK_LIGHTNESS_MIN,
  THEME_HUE_DEFAULT,
  THEME_HUE_MAX,
  THEME_HUE_MIN,
  THEME_SATURATION_DEFAULT,
  THEME_SATURATION_MAX,
  THEME_SATURATION_MIN,
  NEW_THREAD_BACKGROUND_EFFECTS,
  NEW_THREAD_BACKGROUND_EFFECT_LABELS,
  NEW_THREAD_BACKGROUND_EFFECT_DESCRIPTIONS,
} from "../model/appearance";

import {
  LIVE_BACKGROUND_DEFAULT,
  LIVE_BACKGROUND_INTENSITY_DEFAULT,
  LIVE_BACKGROUND_INTENSITY_MAX,
  LIVE_BACKGROUND_INTENSITY_MIN,
  liveBackgroundDescription,
  liveBackgroundLabel,
  saveLiveBackground,
  saveLiveBackgroundIntensity,
  useLiveBackground,
  useLiveBackgroundIntensity,
} from "../model/liveBackground";

import {
  AdvancedSettings,
  Group,
  Row,
  Segmented,
  SettingsFeedback,
  Slider,
  Toggle,
} from "./settingsControls";
import { AppearanceSaveFeedback, type AppearanceSettings } from "./useAppearanceSettings";
import "./AppearanceSettings.css";

/**
 * One page: topics are sections with a titled, framed group each. There is no tab strip; the
 * settings shell owns the scroll and the single "Restore defaults" confirmation for this page
 * (`appearance.restoreDefaults`), while each group shows its own reset icon only when modified.
 */
export function AppearancePage({ appearance }: { appearance: AppearanceSettings }) {
  useLocale();
  const percent = Math.round(appearance.opacity * 100);
  const mainPercent = Math.round(appearance.mainOpacity * 100);
  const light = useColorScheme() === "light";
  // Off on Windows/macOS means an opaque window: the translucency values do not apply.
  const translucencyOff = light || (!IS_LINUX && !appearance.windowGlass);
  const accentIsDefault = isDefaultAccent(appearance.accentColor);

  // Dependent translucency rows are indented sub-rows of Window glass; Linux has no such switch,
  // so there they are plain rows that only the light-mode policy disables. Reasons are tooltips.
  const lightReason = t("Light mode always uses an opaque window.");
  const windowReason = light ? lightReason : t("Turn on Window glass first");
  const dependent = (active: boolean, reason: string) =>
    IS_LINUX
      ? { disabled: !active, disabledReason: reason }
      : { dependsOn: active, disabledReason: reason };
  const defaultSidebarPercent = Math.round(SIDEBAR_OPACITY_DEFAULT * 100);
  const defaultMainPercent = Math.round(MAIN_OPACITY_DEFAULT * 100);
  const translucencyModified =
    percent !== defaultSidebarPercent ||
    mainPercent !== defaultMainPercent ||
    appearance.blur !== SIDEBAR_BLUR_DEFAULT ||
    appearance.bodyGlass !== BODY_GLASS_DEFAULT ||
    appearance.windowGlass !== WINDOW_GLASS_DEFAULT;

  return (
    <div className="appearance-settings">
      <AppearanceSection id="colors" title={t("Theme and colors")}>
        <AppearanceStudio appearance={appearance}>
          <Row
            id="accent-color"
            label={t("Accent color")}
            description={t("Send button, selected text and accent actions.")}
            modified={!accentIsDefault}
            onReset={() => appearance.onAccentColor(ACCENT_COLOR_DEFAULT)}
          >
            <AccentColorPicker value={appearance.accentColor} onChange={appearance.onAccentColor} />
          </Row>
          <AccentReadabilityControl />
          <Row stacked label={t("Preview")}>
            <AppearancePreview />
          </Row>
          <AdvancedSettings
            title={t("Custom surface colors")}
            defaultOpen={false}
            settingIds={["hue", "saturation", "dark-lightness"]}
          >
            <Row
              id="hue"
              label={t("Hue")}
              description={t(
                "Hue and saturation tint every surface. Lightness only moves the dark theme.",
              )}
              modified={appearance.themeHue !== THEME_HUE_DEFAULT}
              onReset={() => appearance.onTint(THEME_HUE_DEFAULT, appearance.themeSaturation)}
            >
              <Slider
                label={t("Hue")}
                value={appearance.themeHue}
                display={`${appearance.themeHue}°`}
                min={THEME_HUE_MIN}
                max={THEME_HUE_MAX}
                onChange={(value) => appearance.onTint(value, appearance.themeSaturation)}
              />
            </Row>
            <Row
              id="saturation"
              label={t("Saturation")}
              description={t("How strongly the hue tints the interface. Zero keeps it neutral.")}
              modified={appearance.themeSaturation !== THEME_SATURATION_DEFAULT}
              onReset={() => appearance.onTint(appearance.themeHue, THEME_SATURATION_DEFAULT)}
            >
              <Slider
                label={t("Saturation")}
                value={appearance.themeSaturation}
                display={`${appearance.themeSaturation}%`}
                min={THEME_SATURATION_MIN}
                max={THEME_SATURATION_MAX}
                onChange={(value) => appearance.onTint(appearance.themeHue, value)}
              />
            </Row>
            <Row
              id="dark-lightness"
              label={t("Dark-mode lightness")}
              description={t(
                "Base brightness of the dark theme. Lower values are darker; zero is true black.",
              )}
              disabled={light}
              disabledReason={t("Only affects dark mode.")}
              modified={appearance.themeDarkLightness !== THEME_DARK_LIGHTNESS_DEFAULT}
              onReset={() => appearance.onDarkLightness(THEME_DARK_LIGHTNESS_DEFAULT)}
            >
              <Slider
                label={t("Dark-mode lightness")}
                value={appearance.themeDarkLightness}
                display={`${appearance.themeDarkLightness}%`}
                min={THEME_DARK_LIGHTNESS_MIN}
                max={THEME_DARK_LIGHTNESS_MAX}
                onChange={appearance.onDarkLightness}
                disabled={light}
              />
            </Row>
          </AdvancedSettings>
        </AppearanceStudio>
        <AppearanceSaveFeedback
          settingIds={["theme", "accent-color", "hue", "saturation", "dark-lightness"]}
        />
      </AppearanceSection>
      <AppearanceSection id="reading" title={t("Text and readability")}>
        {appearance.preferencesUnavailable ? (
          <SettingsFeedback
            state="warning"
            action={<Button onClick={appearance.retryPreferenceRead}>{t("Retry")}</Button>}
          >
            {t(
              "Appearance preferences are unavailable. Retry reading before replacing saved choices.",
            )}
          </SettingsFeedback>
        ) : null}
        {appearance.preferencesDirty ? (
          <SettingsFeedback
            state="error"
            action={
              <Button onClick={() => appearance.onPreferences(appearance.preferences)}>
                {t("Retry save")}
              </Button>
            }
          >
            {t("Could not save changes. Your previous appearance remains active.")}
          </SettingsFeedback>
        ) : null}
        <AppearanceInterface appearance={appearance} />
        <AppearanceTypography appearance={appearance} />
        <AppearanceSaveFeedback settingIds={["ui-scale", "diff-palette"]} />
      </AppearanceSection>
      <AppearanceSection id="layout" title={t("Layout")}>
        <Group title={t("Layout")}>
          <Row
            id="collapsed-project-rail"
            label={t("Collapsed project rail")}
            description={t(
              "Keep project navigation available as a compact icon rail, or hide the rail completely.",
            )}
            modified={appearance.collapsedProjectRailMode !== COLLAPSED_PROJECT_RAIL_MODE_DEFAULT}
            onReset={() =>
              appearance.onCollapsedProjectRailMode(COLLAPSED_PROJECT_RAIL_MODE_DEFAULT)
            }
          >
            <Segmented
              label={t("Collapsed project rail")}
              value={appearance.collapsedProjectRailMode}
              options={[
                {
                  value: "compact",
                  get label() {
                    return t("Icon rail");
                  },
                },
                {
                  value: "hidden",
                  get label() {
                    return t("Hidden");
                  },
                },
              ]}
              onChange={appearance.onCollapsedProjectRailMode}
            />
          </Row>
        </Group>
        <SessionListSettings />
      </AppearanceSection>
      <AppearanceSection id="translucency" title={t("Translucency")}>
        <Group
          title={t("Translucency")}
          description={t("How much of the desktop shows through. Higher blur costs more GPU.")}
          modified={translucencyModified}
          resetLabel={t("Reset translucency")}
          onReset={() => {
            appearance.onOpacity(defaultSidebarPercent);
            appearance.onMainOpacity(defaultMainPercent);
            appearance.onBlur(SIDEBAR_BLUR_DEFAULT);
            appearance.onBodyGlass(BODY_GLASS_DEFAULT);
            appearance.onWindowGlass(WINDOW_GLASS_DEFAULT);
          }}
        >
          {IS_LINUX ? null : (
            <Row
              id="window-glass"
              label={t("Window glass")}
              description={t("Let the desktop show through in dark mode.")}
              info={
                <InfoPopover className="shrink-0">
                  <p>{t("Off draws an opaque window, which is lighter on the GPU.")}</p>
                </InfoPopover>
              }
              disabled={light}
              disabledReason={lightReason}
            >
              <Toggle
                label={t("Window glass")}
                on={appearance.windowGlass}
                onChange={appearance.onWindowGlass}
                disabled={light}
              />
            </Row>
          )}
          <Row
            id="sidebar-opacity"
            label={t("Sidebar opacity")}
            description={t("Applies to the project rail and the session sidebar.")}
            {...dependent(!translucencyOff, windowReason)}
          >
            <Slider
              label={t("Sidebar opacity")}
              feel="elastic"
              value={percent}
              display={`${percent}%`}
              min={Math.round(SIDEBAR_OPACITY_MIN * 100)}
              max={Math.round(SIDEBAR_OPACITY_MAX * 100)}
              onChange={appearance.onOpacity}
              disabled={translucencyOff}
            />
          </Row>
          <Row
            id="blur"
            label={t("Blur radius")}
            description={t("Background blur behind the window.")}
            {...dependent(
              !translucencyOff && IS_MAC,
              IS_MAC ? windowReason : t("Blur radius can only be adjusted on macOS."),
            )}
          >
            <Slider
              label={t("Blur radius")}
              feel="elastic"
              value={appearance.blur}
              display={`${appearance.blur}px`}
              min={SIDEBAR_BLUR_MIN}
              max={SIDEBAR_BLUR_MAX}
              onChange={appearance.onBlur}
              disabled={translucencyOff || !IS_MAC}
            />
          </Row>
          <Row
            id="main-pane-glass"
            label={t("Main pane glass")}
            description={t(
              "Extend the translucent treatment to the main pane behind sessions and editors.",
            )}
            disabled={translucencyOff}
            disabledReason={windowReason}
          >
            <Toggle
              label={t("Main pane glass")}
              on={appearance.bodyGlass}
              onChange={appearance.onBodyGlass}
              disabled={translucencyOff}
            />
          </Row>
          <Row
            id="main-pane-opacity"
            label={t("Main pane opacity")}
            description={t("How much of the desktop shows through the main pane.")}
            dependsOn={!translucencyOff && appearance.bodyGlass}
            disabledReason={translucencyOff ? windowReason : t("Turn on Main pane glass first")}
          >
            <Slider
              label={t("Main pane opacity")}
              value={mainPercent}
              display={`${mainPercent}%`}
              min={Math.round(MAIN_OPACITY_MIN * 100)}
              max={Math.round(MAIN_OPACITY_MAX * 100)}
              onChange={appearance.onMainOpacity}
              disabled={translucencyOff || !appearance.bodyGlass}
            />
          </Row>
        </Group>
        <AppearanceSaveFeedback
          settingIds={[
            "sidebar-opacity",
            "main-pane-opacity",
            "blur",
            "main-pane-glass",
            "window-glass",
          ]}
        />
      </AppearanceSection>
      <AppearanceSection id="backgrounds" title={t("Backgrounds")}>
        <ChatBackgroundCard appearance={appearance} />
        <LiveBackgroundCard />
        <AppearanceSaveFeedback settingIds={["chat-background", "live-background"]} />
      </AppearanceSection>
      <AppearanceSection id="motion" title={t("Motion and crew")}>
        <MotionSettings />
        <CrewSettings />
      </AppearanceSection>
    </div>
  );
}

/** A topic: a labelled landmark that keeps search targets; its groups carry the visible titles. */
function AppearanceSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={`appearance-topic-${id}`}
      tabIndex={-1}
      className="appearance-section"
      aria-label={title}
    >
      <div className="appearance-section-body settings-topics">{children}</div>
    </section>
  );
}

function LiveBackgroundCard() {
  useLocale();
  const effect = useLiveBackground();
  const intensity = useLiveBackgroundIntensity();
  const strength = Math.round(intensity * 100);

  return (
    <Group
      id="live-background"
      title={t("Live background")}
      description={t("Subtle full-pane motion that responds while the AI works.")}
      modified={
        effect !== LIVE_BACKGROUND_DEFAULT || intensity !== LIVE_BACKGROUND_INTENSITY_DEFAULT
      }
      resetLabel={t("Reset live background")}
      onReset={() => {
        saveLiveBackground(LIVE_BACKGROUND_DEFAULT);
        saveLiveBackgroundIntensity(LIVE_BACKGROUND_INTENSITY_DEFAULT);
      }}
    >
      {/* One picker: a grid of even thumbnails, the selected scene plays live and is named below. */}
      <Row
        stacked
        label={liveBackgroundLabel(effect)}
        description={liveBackgroundDescription(effect)}
      >
        <LiveBackgroundPicker
          value={effect}
          onChange={saveLiveBackground}
          label={t("Live background scene")}
        />
      </Row>
      <Row
        label={t("Visibility")}
        description={t("Strength of the animated layer.")}
        dependsOn={effect !== "none"}
        disabledReason={t("Choose a scene first")}
      >
        <Slider
          label={t("Live background visibility")}
          value={strength}
          display={`${strength}%`}
          min={Math.round(LIVE_BACKGROUND_INTENSITY_MIN * 100)}
          max={Math.round(LIVE_BACKGROUND_INTENSITY_MAX * 100)}
          onChange={(value) => saveLiveBackgroundIntensity(value / 100)}
          disabled={effect === "none"}
        />
      </Row>
    </Group>
  );
}

export function ChatBackgroundCard({ appearance }: { appearance: AppearanceSettings }) {
  useLocale();
  const src = chatBackgroundSrc(appearance.chatBackgroundPath);
  const hasImage = Boolean(appearance.chatBackgroundPath && src);
  const emptyVisibility = Math.round(appearance.chatBackgroundEmptyOpacity * 100);
  const sessionVisibility = Math.round(appearance.chatBackgroundSessionOpacity * 100);
  const busy = appearance.chatBackgroundBusy;
  const [preview, setPreview] = useState<"empty" | "conversation">("empty");
  const [decoded, setDecoded] = useState<{ src: string; state: "ready" | "error" } | null>(null);
  useEffect(() => {
    if (!src) return;
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (active) setDecoded({ src, state: "ready" });
    };
    image.onerror = () => {
      if (active) setDecoded({ src, state: "error" });
    };
    image.src = src;
    return () => {
      active = false;
      image.onload = null;
      image.onerror = null;
    };
  }, [src]);
  const imageState = decoded?.src === src ? decoded.state : "loading";
  const modified =
    Math.round(appearance.chatBackgroundEmptyOpacity * 100) !==
      Math.round(CHAT_BACKGROUND_EMPTY_OPACITY_DEFAULT * 100) ||
    Math.round(appearance.chatBackgroundSessionOpacity * 100) !==
      Math.round(CHAT_BACKGROUND_SESSION_OPACITY_DEFAULT * 100) ||
    appearance.chatBackgroundScope !== CHAT_BACKGROUND_SCOPE_DEFAULT ||
    appearance.chatBackgroundBlur !== CHAT_BACKGROUND_BLUR_DEFAULT ||
    appearance.newThreadBackgroundEffect !== NEW_THREAD_BACKGROUND_EFFECT_DEFAULT;

  return (
    <Group
      id="chat-background"
      title={t("Chat background")}
      description={t("An image behind your chat panes. It stays on this device.")}
      modified={modified}
      resetLabel={t("Reset background settings")}
      onReset={() => {
        appearance.onChatBackgroundEmptyOpacity(
          Math.round(CHAT_BACKGROUND_EMPTY_OPACITY_DEFAULT * 100),
        );
        appearance.onChatBackgroundSessionOpacity(
          Math.round(CHAT_BACKGROUND_SESSION_OPACITY_DEFAULT * 100),
        );
        appearance.onChatBackgroundScope(CHAT_BACKGROUND_SCOPE_DEFAULT);
        appearance.onChatBackgroundBlur(CHAT_BACKGROUND_BLUR_DEFAULT);
        appearance.onNewThreadBackgroundEffect(NEW_THREAD_BACKGROUND_EFFECT_DEFAULT);
      }}
    >
      <Row
        label={t("Image")}
        info={
          <InfoPopover className="shrink-0">
            <p>{t("Preview only. Project backgrounds can override this image.")}</p>
          </InfoPopover>
        }
        feedback={
          <>
            {hasImage && imageState === "error" ? (
              <SettingsFeedback state="error">
                {t("Image could not be loaded. Choose another image or remove it.")}
              </SettingsFeedback>
            ) : null}
            {appearance.chatBackgroundError ? (
              <SettingsFeedback state="error">{appearance.chatBackgroundError}</SettingsFeedback>
            ) : null}
          </>
        }
      >
        <div className="appearance-bg-picker">
          <div className="appearance-bg-thumb" data-empty={!hasImage || undefined}>
            {hasImage ? (
              <div
                className={`relative isolate h-full overflow-hidden ${imageState === "ready" ? "chat-pane-background" : ""}`}
                data-project-chat-background="false"
                data-session-empty={preview === "empty"}
              >
                {imageState === "loading" ? (
                  <div className="p-2">
                    <SettingsFeedback state="loading">{t("Loading…")}</SettingsFeedback>
                  </div>
                ) : imageState === "ready" &&
                  appearance.newThreadBackgroundEffect === "gradient-blur" ? (
                  <GradientBlurBackground className="gradient-blur-preview absolute inset-0" />
                ) : null}
                {imageState === "ready" && preview === "conversation" ? (
                  <div
                    className="relative flex h-full flex-col items-end justify-center gap-1 p-2"
                    aria-hidden
                  >
                    <span className="max-w-[80%] rounded-sm bg-(--ui-surface-selected) px-2 py-0.5 text-ui-micro text-content">
                      {t("Conversation")}
                    </span>
                    <span className="self-start rounded-sm bg-(--ui-surface) px-2 py-0.5 text-ui-micro text-(--ui-text-secondary)">
                      {PRODUCT_IDENTITY.displayName}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : (
              <ImagePlus className="icon-md text-(--ui-text-secondary)" aria-hidden />
            )}
          </div>
          <div className="appearance-bg-actions">
            {hasImage ? (
              <>
                <Button
                  className="shrink-0"
                  onClick={() => void appearance.onChooseChatBackground()}
                  disabled={busy}
                  loading={appearance.chatBackgroundOperation === "choose"}
                  loadingLabel={t("Loading…")}
                  stableWidth
                >
                  {t("Change")}
                </Button>
                <Button
                  className="shrink-0"
                  onClick={() => void appearance.onClearChatBackground()}
                  disabled={busy}
                  variant="danger"
                  loading={appearance.chatBackgroundOperation === "remove"}
                  loadingLabel={t("Loading…")}
                  stableWidth
                >
                  {t("Remove")}
                </Button>
              </>
            ) : (
              <Button
                onClick={() => void appearance.onChooseChatBackground()}
                loading={busy}
                loadingLabel={t("Loading…")}
                startIcon={<ImagePlus className="icon-sm" aria-hidden />}
                stableWidth
              >
                {t("Choose an image")}
              </Button>
            )}
          </div>
        </div>
      </Row>
      {hasImage ? (
        <>
          <Row label={t("Preview")}>
            <Segmented
              label={t("Preview")}
              value={preview}
              onChange={setPreview}
              options={[
                { value: "empty", label: t("Empty only") },
                { value: "conversation", label: t("Conversation") },
              ]}
            />
          </Row>
          <Row
            label={t("Background effect")}
            description={
              NEW_THREAD_BACKGROUND_EFFECT_DESCRIPTIONS[appearance.newThreadBackgroundEffect]
            }
          >
            <Segmented
              label={t("Background effect")}
              value={appearance.newThreadBackgroundEffect}
              options={NEW_THREAD_BACKGROUND_EFFECTS.map((effect) => ({
                value: effect,
                label: NEW_THREAD_BACKGROUND_EFFECT_LABELS[effect],
              }))}
              onChange={appearance.onNewThreadBackgroundEffect}
              optionIdPrefix="new-thread-background-effect"
            />
          </Row>
          <Row label={t("Show on")} description={t("Empty sessions only, or every conversation.")}>
            <Segmented
              label={t("Show background on")}
              value={appearance.chatBackgroundScope}
              options={[
                {
                  value: "empty",
                  get label() {
                    return t("Empty only");
                  },
                },
                {
                  value: "all",
                  get label() {
                    return t("All sessions");
                  },
                },
              ]}
              onChange={appearance.onChatBackgroundScope}
            />
          </Row>
          <Row
            label={t("Empty chat visibility")}
            description={t("Background strength before a chat has messages.")}
          >
            <Slider
              label={t("Empty chat background visibility")}
              value={emptyVisibility}
              display={`${emptyVisibility}%`}
              min={Math.round(CHAT_BACKGROUND_OPACITY_MIN * 100)}
              max={Math.round(CHAT_BACKGROUND_OPACITY_MAX * 100)}
              onChange={appearance.onChatBackgroundEmptyOpacity}
            />
          </Row>
          <Row
            label={t("Session visibility")}
            description={t("Background strength once the conversation has messages.")}
          >
            <Slider
              label={t("Session background visibility")}
              value={sessionVisibility}
              display={`${sessionVisibility}%`}
              min={Math.round(CHAT_BACKGROUND_OPACITY_MIN * 100)}
              max={Math.round(CHAT_BACKGROUND_OPACITY_MAX * 100)}
              onChange={appearance.onChatBackgroundSessionOpacity}
            />
          </Row>
        </>
      ) : null}
      <Row
        label={t("Background blur")}
        description={t("Applies to global and project images.")}
        info={
          <InfoPopover className="shrink-0">
            <p>
              {t(
                "Blurs the image behind chat panes, including project images. Haze keeps its own blur.",
              )}
            </p>
          </InfoPopover>
        }
      >
        <Slider
          label={t("Chat background blur")}
          value={appearance.chatBackgroundBlur}
          display={`${appearance.chatBackgroundBlur}px`}
          min={CHAT_BACKGROUND_BLUR_MIN}
          max={CHAT_BACKGROUND_BLUR_MAX}
          onChange={appearance.onChatBackgroundBlur}
        />
      </Row>
    </Group>
  );
}

export const ACCENT_COLOR_PRESETS = [
  themePalette.hex4da3f5,
  themePalette.hex8b5cf6,
  themePalette.hexec4899,
  themePalette.hexef4444,
  themePalette.hexf59e0b,
  themePalette.hex10b981,
] as const;

export function AccentColorPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const colorIndex = value
    ? ACCENT_COLOR_PRESETS.indexOf(value as (typeof ACCENT_COLOR_PRESETS)[number])
    : -1;
  const presetIndex =
    value == null || value.toLowerCase() === ACCENT_COLOR_DEFAULT.toLowerCase()
      ? 0
      : colorIndex >= 0
        ? colorIndex + 1
        : -1;

  return (
    <div ref={root} className="appearance-accent">
      <ColorSwatchRow
        colors={[ACCENT_COLOR_DEFAULT, ...ACCENT_COLOR_PRESETS]}
        labels={[
          t("Default"),
          t("Blue"),
          t("Violet"),
          t("Pink"),
          t("Red"),
          t("Orange"),
          t("Green"),
        ]}
        colorIndex={presetIndex >= 0 ? presetIndex : undefined}
        customColor={presetIndex < 0 ? (value ?? undefined) : undefined}
        customPickerOpen={open}
        onPickIndex={(index) => {
          setOpen(false);
          onChange(
            index === 0
              ? ACCENT_COLOR_DEFAULT
              : (ACCENT_COLOR_PRESETS[index - 1] ?? ACCENT_COLOR_PRESETS[0]),
          );
        }}
        onToggleCustom={() => setOpen((current) => !current)}
      />
      {open ? (
        <Popover
          anchor={root}
          side="bottom"
          align="end"
          width={248}
          flow="scroll"
          onDismiss={() => setOpen(false)}
          className="px-2 pb-2"
        >
          <ColorPickerPopover value={value ?? ACCENT_COLOR_PRESETS[0]} onChange={onChange} />
        </Popover>
      ) : null}
    </div>
  );
}
