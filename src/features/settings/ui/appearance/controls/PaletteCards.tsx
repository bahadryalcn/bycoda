import { surfaceAttributes } from "../../../../../shared/ui/Surface";
import { t, useLocale } from "../../../../../shared/i18n";
import { RadioGroup } from "../../../../../shared/ui/RadioGroup";
import { Text } from "../../../../../shared/ui/Text";
import { THEME_PALETTE_PRESETS, matchThemePalette } from "../../../model/themePalettes";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import "./ThemeControls.css";
import { writeGeneratorValue } from "./themeGeneratorSession";

/** The four colours a palette stands for: canvas, surface, line and its accent. */
export function paletteSwatches(
  hue: number,
  saturation: number,
  lightness: number,
  accent: string,
): string[] {
  return [
    `hsl(${hue} ${Math.round(saturation * 0.6)}% ${Math.max(2, lightness - 1)}%)`,
    `hsl(${hue} ${Math.round(saturation * 0.7)}% ${lightness + 5}%)`,
    `hsl(${hue} ${Math.round(saturation * 0.5)}% ${lightness + 13}%)`,
    accent,
  ];
}

/** Named palette cards. Choosing one sets its tint, depth and accent together. */
export function PaletteCards({ appearance }: { appearance: AppearanceSettings }) {
  useLocale();
  const selected = matchThemePalette(appearance);
  const select = (name: string) => {
    const palette = THEME_PALETTE_PRESETS.find((preset) => preset.name === name);
    if (!palette) return;
    appearance.onTint(palette.hue, palette.saturation);
    appearance.onDarkLightness(palette.lightness);
    appearance.onAccentColor(palette.accent);
    writeGeneratorValue("selectedLookName", palette.name, "");
  };
  return (
    <RadioGroup
      variant="tiles"
      label={t("Theme palettes")}
      value={selected?.name ?? ""}
      onValueChange={select}
      className="theme-palettes"
      tileClassName="theme-palette-card"
      tile={{ motion: "none", selectionIndicator: "focus-ring", frame: "preview" }}
      options={THEME_PALETTE_PRESETS.map((palette) => ({
        value: palette.name,
        ariaLabel: palette.name,
        tooltip: `${palette.name}: ${t(palette.note)}`,
        content: (
          <>
            <span className="theme-palette-swatches" aria-hidden="true">
              {paletteSwatches(
                palette.hue,
                palette.saturation,
                palette.lightness,
                palette.accent,
              ).map((color, swatch) => (
                <span
                  key={swatch}
                  {...surfaceAttributes({ variant: "user-color" })}
                  style={{ "--surface-user-color": color } as React.CSSProperties}
                />
              ))}
            </span>
            <Text as="span" size="secondary" tone="inherit" weight="medium" leading="inherit">
              {palette.name}
            </Text>
          </>
        ),
      }))}
    />
  );
}
