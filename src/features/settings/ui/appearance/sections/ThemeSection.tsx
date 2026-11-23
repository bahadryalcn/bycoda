import { t, useLocale } from "../../../../../shared/i18n";
import { AdvancedSettings, Group, Row, Segmented } from "../../../../../shared/ui/settings";
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
import { PaletteCards } from "../controls/PaletteCards";
import { ThemePreview } from "../controls/ThemePreview";
import { SavedThemes } from "../controls/SavedThemes";
import { StateLadder } from "../controls/StateLadder";
import { ToneSliders } from "../controls/ToneSliders";
import { AppearanceSection } from "./AppearanceSection";
import { generatorSession } from "../controls/themeGeneratorSession";
import "./ThemeSection.css";

/**
 * Theme tab: one group with mode, palettes plus one live preview, accent and saved themes; tone and
 * interaction tuning sit in its closing Advanced row. Generation sits under the tabs because it
 * changes every Appearance topic. Every control writes through the existing setters.
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
        title={t("Theme")}
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
          <div className="theme-palettes-preview">
            <ThemePreview appearance={appearance} />
          </div>
        </Row>
        <Row
          id="accent-color"
          controlWidth="fill"
          label={t("Accent color")}
          modified={!isDefaultAccent(appearance.accentColor)}
          onReset={() => {
            generatorSession.invalidateImageIntent();
            appearance.onAccentColor(ACCENT_COLOR_DEFAULT);
          }}
        >
          <AccentRing appearance={appearance} />
        </Row>
        <Row id="saved-themes" stacked label={t("Saved themes")}>
          <SavedThemes appearance={appearance} />
        </Row>
        <AdvancedSettings
          title={t("Tone and interaction")}
          settingIds={[
            "canvas-background",
            "hue",
            "saturation",
            "dark-lightness",
            "surface-contrast",
            "interaction-tint",
            "interaction-strength",
          ]}
        >
          <ToneSliders appearance={appearance} />
          <StateLadder />
        </AdvancedSettings>
      </Group>
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
