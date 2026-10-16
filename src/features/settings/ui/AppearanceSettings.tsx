import { themePalette } from "../../../shared/theme/palette";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { ChevronLeft, ChevronRight, ImagePlus, Loader } from "../../../shared/ui/icons";
import { CrewSettings, TabMotionSettings } from "./AppearanceBehaviorSettings";
import { useRef, useState } from "react";
import { AppearanceStudio, AppearanceInterface, AppearanceTypography } from "./AppearancePreviews";

import { ColorPickerPopover, ColorSwatchRow } from "../../../shared/ui/ColorPickerPopover";
import { Popover } from "../../../shared/ui/Popover";
import { Button } from "../../../shared/ui/Button";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";

import { GradientBlurBackground } from "./GradientBlurBackground";
import { LiveBackgroundCanvas } from "./LiveBackgroundCanvas";
import { LiveBackgroundPicker, stepLiveBackground } from "./LiveBackgroundPicker";
import { SessionListSettings } from "./SessionListSettings";

import { useColorScheme } from "../../../shared/hooks/useColorScheme";
import {
  ACCENT_COLOR_DEFAULT,
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
  THEME_DARK_LIGHTNESS_MAX,
  THEME_DARK_LIGHTNESS_MIN,
  THEME_HUE_MAX,
  THEME_HUE_MIN,
  THEME_SATURATION_MAX,
  THEME_SATURATION_MIN,
  NEW_THREAD_BACKGROUND_EFFECTS,
  NEW_THREAD_BACKGROUND_EFFECT_LABELS,
  NEW_THREAD_BACKGROUND_EFFECT_DESCRIPTIONS,
} from "../model/appearance";

import { UI_SCALE_PERCENTS } from "../model/uiScale";
import {
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
  saveDecorativeMotionEnabled,
  useDecorativeMotionPreference,
  usePrefersReducedMotion,
} from "../model/decorativeMotion";

import {
  AdvancedSettings,
  Group,
  Row,
  Segmented,
  Slider,
  Toggle,
  Select,
} from "./settingsControls";
import { type AppearanceSettings } from "./useAppearanceSettings";
import "./AppearanceSettings.css";

export function AppearancePage({ appearance }: { appearance: AppearanceSettings }) {
  useLocale();
  const percent = Math.round(appearance.opacity * 100);
  const mainPercent = Math.round(appearance.mainOpacity * 100);
  const glassDisabled = useColorScheme() === "light";
  const decorativeMotion = useDecorativeMotionPreference();
  const reducedMotion = usePrefersReducedMotion();

  return (
    <div className="appearance-settings">
      <AppearanceStudio appearance={appearance} />
      <div className="appearance-tuning">
        <AppearanceInterface appearance={appearance} />
        <AppearanceTypography appearance={appearance} />
      </div>
      <div className="appearance-options">
        <Group title={t("Layout")} persistence={{ mode: "automatic" }}>
          <Row
            id="collapsed-project-rail"
            label={t("Collapsed project rail")}
            description={t(
              "Keep project navigation available as a compact icon rail, or hide the rail completely.",
            )}
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
          <Row
            id="interface-scale"
            label={t("Interface scale")}
            description={t(
              "Zoom the whole interface. You can also use Ctrl+=, Ctrl+-, and Ctrl+0 (Cmd on macOS).",
            )}
          >
            <Select
              label={t("Interface scale")}
              value={String(Math.round(appearance.uiScale * 100))}
              options={UI_SCALE_PERCENTS.map((percent) => ({
                value: String(percent),
                label: `${percent}%`,
              }))}
              onChange={(value) => appearance.onUiScale(Number(value))}
            />
          </Row>
        </Group>
        <SessionListSettings />
        <Group
          title={t("Translucency")}
          persistence={{ mode: "automatic" }}
          description={
            glassDisabled
              ? t(
                  "Light mode always uses an opaque window, so these are off. Your dark-mode values are preserved.",
                )
              : t(
                  "How much of the desktop shows through {p0}. Blur costs more to composite the higher it goes.",
                  { p0: PRODUCT_IDENTITY.displayName },
                )
          }
        >
          <Row
            id="sidebar-opacity"
            label={t("Sidebar opacity")}
            description={t("Applies to the project rail and the session sidebar.")}
          >
            <Slider
              label={t("Sidebar opacity")}
              value={percent}
              display={`${percent}%`}
              min={Math.round(SIDEBAR_OPACITY_MIN * 100)}
              max={Math.round(SIDEBAR_OPACITY_MAX * 100)}
              onChange={appearance.onOpacity}
              disabled={glassDisabled}
            />
          </Row>
          <Row
            id="blur"
            label={t("Blur radius")}
            description={t("Background blur behind the window.")}
          >
            <Slider
              label={t("Blur radius")}
              value={appearance.blur}
              display={String(appearance.blur)}
              min={SIDEBAR_BLUR_MIN}
              max={SIDEBAR_BLUR_MAX}
              onChange={appearance.onBlur}
              disabled={glassDisabled}
            />
          </Row>
          <Row
            id="main-pane-glass"
            label={t("Main pane glass")}
            description={t(
              "Extend the translucent treatment to the main pane behind sessions and editors.",
            )}
          >
            <Toggle
              label={t("Main pane glass")}
              on={appearance.bodyGlass}
              onChange={appearance.onBodyGlass}
              disabled={glassDisabled}
            />
          </Row>
          <Row
            id="main-pane-opacity"
            dependency={
              !glassDisabled && !appearance.bodyGlass
                ? t("Enable Main pane glass to adjust its opacity. Your value is preserved.")
                : undefined
            }
            label={t("Main pane opacity")}
            description={t("Applies to the main pane when main pane glass is on.")}
          >
            <Slider
              label={t("Main pane opacity")}
              value={mainPercent}
              display={`${mainPercent}%`}
              min={Math.round(MAIN_OPACITY_MIN * 100)}
              max={Math.round(MAIN_OPACITY_MAX * 100)}
              onChange={appearance.onMainOpacity}
              disabled={glassDisabled || !appearance.bodyGlass}
            />
          </Row>
        </Group>
        <Group title={t("Accent")} persistence={{ mode: "automatic" }}>
          <Row
            id="accent-color"
            label={t("Accent color")}
            description={t("Used for the composer send button and your message bubbles.")}
          >
            <AccentColorPicker value={appearance.accentColor} onChange={appearance.onAccentColor} />
          </Row>
        </Group>

        <AdvancedSettings
          title={t("Custom surface colors")}
          settingIds={["hue", "saturation", "dark-lightness"]}
        >
          <Group
            title={t("Color")}
            description={t(
              "Hue and saturation tint every surface. Lightness only moves the dark theme.",
            )}
          >
            <Row
              id="hue"
              label={t("Hue")}
              description={t("Base hue for accents and tinted surfaces.")}
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
              description={
                glassDisabled
                  ? t("This only affects dark mode. Your dark-mode value is preserved.")
                  : t(
                      "Base brightness of the dark theme. Lower values are darker; zero is true black.",
                    )
              }
            >
              <Slider
                label={t("Dark-mode lightness")}
                value={appearance.themeDarkLightness}
                display={`${appearance.themeDarkLightness}%`}
                min={THEME_DARK_LIGHTNESS_MIN}
                max={THEME_DARK_LIGHTNESS_MAX}
                onChange={appearance.onDarkLightness}
                disabled={glassDisabled}
              />
            </Row>
          </Group>
        </AdvancedSettings>
        <Group title={t("Motion")} persistence={{ mode: "automatic" }}>
          <TabMotionSettings />
          <Row
            id="decorative-motion"
            label={t("Decorative animations")}
            description={
              reducedMotion
                ? t(
                    "Your system requests reduced motion, so decorative animations stay still. Your saved choice is preserved.",
                  )
                : t("Animate project sigils, chat transitions and the agent crew scene.")
            }
          >
            <Toggle
              label={t("Decorative animations")}
              on={decorativeMotion}
              onChange={saveDecorativeMotionEnabled}
            />
          </Row>
        </Group>
        <ChatBackgroundCard appearance={appearance} />
        <LiveBackgroundCard />
        <CrewSettings />
      </div>
    </div>
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
      description={t(
        "An animated scene behind your chat panes. While the AI replies, the scene reacts; the default face speaks the reply. It stays still when decorative animations are off.",
      )}
    >
      <div className="border-b border-content/5 p-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            iconOnly
            label={t("Previous scene")}
            onClick={() => saveLiveBackground(stepLiveBackground(effect, -1))}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <div className="relative h-36 min-w-0 flex-1 overflow-hidden rounded-lg border border-content/10 bg-background-base">
            {effect !== "none" ? (
              <LiveBackgroundCanvas
                effect={effect}
                intensity={intensity}
                demoSpeech
                className="absolute inset-0"
              />
            ) : null}
          </div>
          <Button
            variant="ghost"
            iconOnly
            label={t("Next scene")}
            onClick={() => saveLiveBackground(stepLiveBackground(effect, 1))}
          >
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
        <div className="mt-2 text-center">
          <p className="text-[13px] font-medium text-content">{liveBackgroundLabel(effect)}</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-content/65">
            {liveBackgroundDescription(effect)}
          </p>
        </div>
      </div>
      <div className="border-b border-content/5 px-4 py-3.5 last:border-b-0">
        <LiveBackgroundPicker
          value={effect}
          onChange={saveLiveBackground}
          label={t("Live background scene")}
        />
      </div>
      {effect !== "none" ? (
        <Row label={t("Visibility")} description={t("Strength of the animated layer.")}>
          <Slider
            label={t("Live background visibility")}
            value={strength}
            display={`${strength}%`}
            min={Math.round(LIVE_BACKGROUND_INTENSITY_MIN * 100)}
            max={Math.round(LIVE_BACKGROUND_INTENSITY_MAX * 100)}
            onChange={(value) => saveLiveBackgroundIntensity(value / 100)}
          />
        </Row>
      ) : null}
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

  return (
    <Group
      id="chat-background"
      title={t("Chat background")}
      description={t("An image behind your chat panes. It stays on this device.")}
    >
      <div className="border-b border-content/5 p-4 last:border-b-0">
        <div className="overflow-hidden rounded-lg border border-content/10">
          {hasImage ? (
            <div
              className={`relative h-36 ${appearance.newThreadBackgroundEffect === "gradient-blur" ? "bg-background-base" : ""}`}
            >
              {appearance.newThreadBackgroundEffect === "gradient-blur" ? (
                <GradientBlurBackground
                  className="gradient-blur-preview absolute inset-0"
                  style={{ opacity: appearance.chatBackgroundEmptyOpacity }}
                />
              ) : (
                <div
                  aria-hidden
                  className="size-full bg-cover bg-center bg-no-repeat"
                  style={{
                    backgroundImage: "var(--chat-background-image)",
                    opacity: appearance.chatBackgroundEmptyOpacity,
                  }}
                />
              )}
              <span className="pointer-events-none absolute bottom-2 left-2 text-[11px] text-content/40">
                {t("Empty chat preview at ")}
                {emptyVisibility}%
              </span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void appearance.onChooseChatBackground()}
              disabled={busy}
              className="flex h-36 w-full flex-col items-center justify-center gap-2 text-content/40 hover:bg-content/5 hover:text-content/70 disabled:cursor-default disabled:opacity-40"
            >
              {busy ? (
                <Loader className="size-5 motion-safe:animate-spin" aria-hidden />
              ) : (
                <ImagePlus className="size-5" aria-hidden />
              )}
              <span className="text-[12px]">{t("Choose an image")}</span>
            </button>
          )}
        </div>
        {hasImage ? (
          <div className="mt-3 flex items-center justify-end gap-2">
            <SecondaryButton
              onClick={() => void appearance.onChooseChatBackground()}
              disabled={busy}
            >
              {busy ? <Loader className="size-3.5 motion-safe:animate-spin" aria-hidden /> : null}
              {t("Change")}
            </SecondaryButton>
            <SecondaryButton
              onClick={() => void appearance.onClearChatBackground()}
              disabled={busy}
              danger
            >
              {t("Remove")}
            </SecondaryButton>
          </div>
        ) : null}
        {appearance.chatBackgroundError ? (
          <p role="alert" className="mt-2 text-[12px] text-danger">
            {appearance.chatBackgroundError}
          </p>
        ) : null}
      </div>
      {hasImage ? (
        <>
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
          <Row
            label={t("Background blur")}
            description={t(
              "Blurs the image behind chat panes, including project images. Haze keeps its own blur.",
            )}
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
        </>
      ) : null}
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
    <div ref={root} className="w-48">
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
          onDismiss={() => setOpen(false)}
          className="px-2 pb-2"
        >
          <ColorPickerPopover value={value ?? ACCENT_COLOR_PRESETS[0]} onChange={onChange} />
        </Popover>
      ) : null}
    </div>
  );
}
