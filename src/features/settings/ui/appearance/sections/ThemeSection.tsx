import { t, useLocale } from "../../../../../shared/i18n";
import { Group, Row, Segmented } from "../../settingsControls";
import { AppearanceSaveFeedback, type AppearanceSettings } from "../../useAppearanceSettings";
import { isDefaultAccent } from "../../AppearancePreviews";
import {
  ACCENT_COLOR_DEFAULT,
  THEME_DARK_LIGHTNESS_DEFAULT,
  THEME_HUE_DEFAULT,
  THEME_PREFERENCE_DEFAULT,
  THEME_SATURATION_DEFAULT,
  type ThemePreference,
} from "../../../model/appearance";
import {
  APPEARANCE_DEFAULTS,
  CANVAS_BACKGROUND_DEFAULT,
} from "../../../model/appearancePreferences";
import { AccentRing } from "../controls/AccentRing";
import { CanvasBackgroundRow } from "../controls/CanvasBackgroundRow";
import { PaletteCards } from "../controls/PaletteCards";
import { SaveLookButton } from "../controls/SaveLookButton";
import { SavedThemes } from "../controls/SavedThemes";
import { StateLadder } from "../controls/StateLadder";
import { ThemePreview } from "../controls/ThemePreview";
import { ToneSliders } from "../controls/ToneSliders";
import { AppearanceSection } from "./AppearanceSection";

/**
 * Theme tab order: a live preview first, then the colour choices (mode and palettes, tone, accent,
 * interaction). Generation sits above the tabs because it changes every Appearance topic. Every control writes through the existing setters.
 */
export function ThemeSection({ appearance }: { appearance: AppearanceSettings }) {
  useLocale();
  const colorsModified =
    appearance.themeHue !== THEME_HUE_DEFAULT ||
    appearance.themeSaturation !== THEME_SATURATION_DEFAULT ||
    appearance.themeDarkLightness !== THEME_DARK_LIGHTNESS_DEFAULT ||
    !isDefaultAccent(appearance.accentColor) ||
    appearance.preferences.accentReadability !== APPEARANCE_DEFAULTS.accentReadability ||
    appearance.preferences.canvasBackground !== CANVAS_BACKGROUND_DEFAULT;
  const resetColors = () => {
    appearance.onTint(THEME_HUE_DEFAULT, THEME_SATURATION_DEFAULT);
    appearance.onDarkLightness(THEME_DARK_LIGHTNESS_DEFAULT);
    appearance.onAccentColor(ACCENT_COLOR_DEFAULT);
    // Accent readability and the background tone are color preferences, so they reset here too.
    appearance.onPreferences({
      ...appearance.preferences,
      accentReadability: APPEARANCE_DEFAULTS.accentReadability,
      canvasBackground: CANVAS_BACKGROUND_DEFAULT,
    });
  };
  return (
    <AppearanceSection id="colors" title={t("Theme and colors")}>
      <Group title={t("Preview")}>
        <ThemePreview />
      </Group>
      <Group
        title={t("Themes")}
        modified={colorsModified || appearance.themePreference !== THEME_PREFERENCE_DEFAULT}
        resetLabel={t("Reset colors")}
        onReset={() => {
          resetColors();
          appearance.onThemePreference(THEME_PREFERENCE_DEFAULT);
        }}
      >
        <Row id="theme" label={t("Color scheme")}>
          <Segmented<ThemePreference>
            label={t("Color scheme")}
            value={appearance.themePreference}
            options={[
              { value: "system", label: t("System") },
              { value: "light", label: t("Light") },
              { value: "dark", label: t("Dark") },
            ]}
            onChange={appearance.onThemePreference}
          />
        </Row>
        <Row id="theme-palettes" stacked label={t("Theme palettes")}>
          <PaletteCards appearance={appearance} />
        </Row>
        <Row id="saved-themes" stacked label={t("Saved themes")}>
          <div className="theme-saved-row">
            <SavedThemes appearance={appearance} />
            <SaveLookButton appearance={appearance} />
          </div>
        </Row>
      </Group>
      <Group
        title={t("Tone")}
        description={t("Pure is true black in dark mode and white in light mode.")}
        action={<CanvasBackgroundRow appearance={appearance} />}
        modified={
          appearance.themeHue !== THEME_HUE_DEFAULT ||
          appearance.themeSaturation !== THEME_SATURATION_DEFAULT ||
          appearance.themeDarkLightness !== THEME_DARK_LIGHTNESS_DEFAULT
        }
        resetLabel={t("Reset tone")}
        onReset={() => {
          appearance.onTint(THEME_HUE_DEFAULT, THEME_SATURATION_DEFAULT);
          appearance.onDarkLightness(THEME_DARK_LIGHTNESS_DEFAULT);
        }}
      >
        <ToneSliders appearance={appearance} />
      </Group>
      <Group
        title={t("Accent")}
        modified={!isDefaultAccent(appearance.accentColor)}
        resetLabel={t("Reset accent")}
        onReset={() => appearance.onAccentColor(ACCENT_COLOR_DEFAULT)}
      >
        <Row id="accent-color" label={t("Accent color")}>
          <AccentRing appearance={appearance} />
        </Row>
      </Group>
      <StateLadder />
      <AppearanceSaveFeedback
        settingIds={[
          "theme",
          "accent-color",
          "hue",
          "saturation",
          "dark-lightness",
          "interaction-tint",
          "interaction-strength",
        ]}
      />
    </AppearanceSection>
  );
}
