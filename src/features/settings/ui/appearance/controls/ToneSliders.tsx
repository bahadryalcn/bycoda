import type { CSSProperties } from "react";
import { t, useLocale } from "../../../../../shared/i18n";
import { useColorScheme } from "../../../../../shared/hooks/useColorScheme";
import { Text } from "../../../../../shared/ui/Text";
import {
  THEME_DARK_LIGHTNESS_MAX,
  THEME_DARK_LIGHTNESS_MIN,
  THEME_HUE_MAX,
  THEME_HUE_MIN,
  THEME_SATURATION_MAX,
  THEME_SATURATION_MIN,
} from "../../../model/appearance";
import { APPEARANCE_RANGES } from "../../../model/themeRanges";
import { Row, Slider } from "../../settingsControls";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import "./ThemeControls.css";
import "./ToneSliders.css";
import { ThemePreview } from "./ThemePreview";

/** The hue slider's rainbow: seven stops at one lightness, built from the wheel itself. */
const HUE_TRACK = `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360]
  .map((stop) => `hsl(${stop} 80% 55%)`)
  .join(", ")})`;
const HUE_TRACK_STYLE = { "--ui-hue-track": HUE_TRACK } as CSSProperties;

/** Hue, saturation and depth as labelled sliders, then the four surface steps they produce. */
export function ToneSliders({ appearance }: { appearance: AppearanceSettings }) {
  useLocale();
  const light = useColorScheme() === "light";
  const { themeHue: hue, themeSaturation: saturation, themeDarkLightness: depth } = appearance;
  const { surfaceContrast } = appearance.preferences;
  return (
    <div className="theme-detail-split">
      <div className="theme-detail-controls">
        <Row id="hue" label={t("Hue")}>
          <div className="theme-hue-field" style={HUE_TRACK_STYLE}>
            <Slider
              label={t("Hue")}
              className="theme-hue-slider"
              value={hue}
              display={`${hue}°`}
              min={THEME_HUE_MIN}
              max={THEME_HUE_MAX}
              onChange={(next) => appearance.onTint(next, saturation)}
            />
          </div>
        </Row>
        <Row id="saturation" label={t("Saturation")}>
          <Slider
            label={t("Saturation")}
            value={saturation}
            display={`${saturation}%`}
            min={THEME_SATURATION_MIN}
            max={THEME_SATURATION_MAX}
            onChange={(next) => appearance.onTint(hue, next)}
          />
        </Row>
        <Row
          id="dark-lightness"
          label={t("Depth")}
          description={t("Dark mode only. Sets how deep the dark canvas is.")}
          disabled={light}
        >
          <Slider
            label={t("Depth")}
            value={depth}
            display={String(depth)}
            min={THEME_DARK_LIGHTNESS_MIN}
            max={THEME_DARK_LIGHTNESS_MAX}
            disabled={light}
            onChange={appearance.onDarkLightness}
          />
        </Row>
        <Row
          id="surface-contrast"
          label={t("Surface contrast")}
          description={t("How strongly cards, fields and dialogs lift off the canvas.")}
        >
          <Slider
            label={t("Surface contrast")}
            value={surfaceContrast}
            display={`${surfaceContrast}%`}
            min={APPEARANCE_RANGES.surfaceContrast.min}
            max={APPEARANCE_RANGES.surfaceContrast.max}
            step={5}
            onChange={(next) =>
              appearance.onPreferences({ ...appearance.preferences, surfaceContrast: next })
            }
          />
        </Row>
      </div>
      <div className="theme-detail-preview">
        <ThemePreview appearance={appearance} />
        <Row
          stacked
          label={t("Surfaces")}
          description={t("The four steps the tint produces, from the canvas up to a selected row.")}
        >
          <div className="tone-ramp" aria-hidden="true">
            {(
              [
                ["base", t("Base")],
                ["surface", t("Surface")],
                ["line", t("Line")],
                ["selected", t("Selected")],
              ] as const
            ).map(([step, label]) => (
              <span key={step} className="tone-step" data-step={step}>
                <span className="tone-swatch" />
                <Text as="span" size="caption" tone="secondary" truncate>
                  {label}
                </Text>
              </span>
            ))}
          </div>
        </Row>
      </div>
    </div>
  );
}
