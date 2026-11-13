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
import { SavedThemes } from "../controls/SavedThemes";
import { StateLadder } from "../controls/StateLadder";
import { ToneSliders } from "../controls/ToneSliders";
import { AppearanceSection } from "./AppearanceSection";
import { generatorSession } from "../controls/themeGeneratorSession";
import "./ThemeSection.css";

/**
 * Theme tab order: colour choices (mode and palettes, tone with a live preview, accent,
 * interaction). Generation sits under the tabs because it changes every Appearance topic. Every control writes through the existing setters.
 */
export function ThemeSection({ appearance }: { appearance: AppearanceSettings }) {
  useLocale();
  const colorsModified =
    appearance.themeHue !== THEME_HUE_DEFAULT ||
    appearance.themeSaturation !== THEME_SATURATION_DEFAULT ||
    appearance.themeDarkLightness !== THEME_DARK_LIGHTNESS_DEFAULT ||
    !isDefaultAccent(appearance.accentColor) ||
    appearance.preferences.accentReadability !== APPEARANCE_DEFAULTS.accentReadability ||
    appearance.preferences.surfaceContrast !== APPEARANCE_DEFAULTS.surfaceContrast ||
    appearance.preferences.canvasBackground !== CANVAS_BACKGROUND_DEFAULT;
  const resetColors = () => {
    generatorSession.invalidateImageIntent();
    appearance.onTint(THEME_HUE_DEFAULT, THEME_SATURATION_DEFAULT);
    appearance.onDarkLightness(THEME_DARK_LIGHTNESS_DEFAULT);
    appearance.onAccentColor(ACCENT_COLOR_DEFAULT);
    // Accent readability and the background tone are color preferences, so they reset here too.
    appearance.onPreferences({
      ...appearance.preferences,
      accentReadability: APPEARANCE_DEFAULTS.accentReadability,
      surfaceContrast: APPEARANCE_DEFAULTS.surfaceContrast,
      canvasBackground: CANVAS_BACKGROUND_DEFAULT,
    });
  };
  return (
    <AppearanceSection id="colors" title={t("Theme and colors")}>
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
          <SavedThemes appearance={appearance} />
        </Row>
      </Group>
      <Group
        title={t("Tone")}
        description={t("Pure is true black in dark mode and white in light mode.")}
        action={<CanvasBackgroundRow appearance={appearance} />}
        modified={
          appearance.themeHue !== THEME_HUE_DEFAULT ||
          appearance.themeSaturation !== THEME_SATURATION_DEFAULT ||
          appearance.themeDarkLightness !== THEME_DARK_LIGHTNESS_DEFAULT ||
          appearance.preferences.surfaceContrast !== APPEARANCE_DEFAULTS.surfaceContrast
        }
        resetLabel={t("Reset tone")}
        onReset={() => {
          generatorSession.invalidateImageIntent();
          appearance.onTint(THEME_HUE_DEFAULT, THEME_SATURATION_DEFAULT);
          appearance.onDarkLightness(THEME_DARK_LIGHTNESS_DEFAULT);
          appearance.onPreferences({
            ...appearance.preferences,
            surfaceContrast: APPEARANCE_DEFAULTS.surfaceContrast,
          });
        }}
      >
        <ToneSliders appearance={appearance} />
      </Group>
      <Group
        title={t("Accent")}
        modified={!isDefaultAccent(appearance.accentColor)}
        resetLabel={t("Reset accent")}
        onReset={() => {
          generatorSession.invalidateImageIntent();
          appearance.onAccentColor(ACCENT_COLOR_DEFAULT);
        }}
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
          "surface-contrast",
          "interaction-tint",
          "interaction-strength",
        ]}
      />
    </AppearanceSection>
  );
}
