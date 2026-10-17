import { themePalette } from "../../../shared/theme/palette";
import { t, useLocale } from "../../../shared/i18n";
import type { CSSProperties } from "react";
import {
  AdvancedSettings,
  Group,
  Row,
  Select,
  Slider,
  Toggle,
  Segmented,
} from "./settingsControls";
import type { AppearanceSettings } from "./useAppearanceSettings";
import { APPEARANCE_DEFAULTS, CODE_FONTS, INTERFACE_FONTS } from "../model/appearancePreferences";
import {
  ACCENT_COLOR_DEFAULT,
  DIFF_PALETTE_DEFAULT,
  THEME_HUE_DEFAULT,
  THEME_SATURATION_DEFAULT,
  THEME_DARK_LIGHTNESS_DEFAULT,
  THEME_PREFERENCE_DEFAULT,
} from "../model/appearance";
import { UI_SCALE_DEFAULT, UI_SCALE_PERCENTS } from "../model/uiScale";
import { useColorScheme } from "../../../shared/hooks/useColorScheme";
import { ControlSpecimen } from "../../../shared/ui/ControlSpecimen";
import { Button } from "../../../shared/ui/Button";
import "./AppearancePreviews.css";

const presets = [
  {
    name: "bycoda",
    note: "Cool silver, quiet surfaces",
    hue: 216,
    saturation: 24,
    lightness: 4,
    accent: themePalette.hexA3ACB8,
  },
  {
    name: "Olive",
    note: "A softer green workspace",
    hue: 150,
    saturation: 22,
    lightness: 7,
    accent: themePalette.hex69b68e,
  },
  {
    name: "Tide",
    note: "Clear blue, a little air",
    hue: 205,
    saturation: 30,
    lightness: 7,
    accent: themePalette.hex65b4db,
  },
  {
    name: "Kiln",
    note: "Warm clay, mellow light",
    hue: 25,
    saturation: 24,
    lightness: 7,
    accent: themePalette.hexdba276,
  },
  {
    name: "Dusk",
    note: "Muted violet, evening calm",
    hue: 275,
    saturation: 24,
    lightness: 7,
    accent: themePalette.hexb297d4,
  },
  {
    name: "Ink",
    note: "A study in neutral tones",
    hue: 216,
    saturation: 0,
    lightness: 5,
    accent: themePalette.hexb8b8b8,
  },
];

export function AppearanceStudio({ appearance: a }: { appearance: AppearanceSettings }) {
  useLocale();
  const light = useColorScheme() === "light";
  const selected = presets.find(
    (p) =>
      p.hue === a.themeHue &&
      p.saturation === a.themeSaturation &&
      p.lightness === a.themeDarkLightness &&
      p.accent.toLowerCase() === a.accentColor?.toLowerCase(),
  );
  const resetColors = () => {
    a.onThemePreference(THEME_PREFERENCE_DEFAULT);
    a.onTint(THEME_HUE_DEFAULT, THEME_SATURATION_DEFAULT);
    a.onDarkLightness(THEME_DARK_LIGHTNESS_DEFAULT);
    a.onAccentColor(ACCENT_COLOR_DEFAULT);
  };
  return (
    <section className="appearance-studio" aria-label={t("Theme and colors")}>
      <div className="appearance-studio-heading">
        <h2>{t("Theme and colors")}</h2>
        <Button variant="ghost" onClick={resetColors}>
          {t("Reset colors")}
        </Button>
      </div>
      <div id="setting-theme" data-setting-id="theme" className="appearance-scheme-control">
        <Segmented
          label={t("Color scheme")}
          value={a.themePreference}
          options={[
            { value: "system", label: t("System") },
            { value: "light", label: t("Light") },
            { value: "dark", label: t("Dark") },
          ]}
          onChange={a.onThemePreference}
        />
        <span role="status">{t("Active mode: {p0}", { p0: light ? t("Light") : t("Dark") })}</span>
      </div>
      <div className="appearance-studio-body">
        <div
          className="appearance-control-preview"
          role="region"
          aria-label={t("Live control preview")}
        >
          <ControlSpecimen />
          <AdvancedSettings title={t("All control states")}>
            <ControlSpecimen expanded />
          </AdvancedSettings>
        </div>
        <div className="appearance-material-library">
          <div className="appearance-library-heading">
            <h3>{t("Theme palettes")}</h3>
          </div>
          <div
            id="setting-theme-palettes"
            data-setting-id="theme-palettes"
            role="group"
            aria-label={t("Theme palettes")}
          >
            {presets.map((p) => (
              <Button
                variant="item"
                selected={selected?.name === p.name}
                key={p.name}
                className="appearance-palette"
                tooltip={t(p.note)}
                aria-pressed={selected?.name === p.name}
                onClick={() => {
                  a.onTint(p.hue, p.saturation);
                  a.onDarkLightness(p.lightness);
                  a.onAccentColor(p.accent);
                }}
              >
                {/* Swatches display the selectable palette data; control colors remain semantic. */}
                <span
                  className="appearance-material-sample"
                  aria-hidden="true"
                  style={
                    {
                      "--material-base": `hsl(${p.hue} ${p.saturation}% ${light ? 94 : p.lightness + 5}%)`,
                      "--material-ink": `hsl(${p.hue} ${p.saturation}% ${light ? 24 : 82}%)`,
                      "--material-accent": p.accent,
                    } as CSSProperties
                  }
                >
                  <i />
                  <i />
                  <i />
                </span>
                <span className="appearance-material-name">
                  <strong>{p.name}</strong>
                </span>
                <span aria-hidden="true">{selected?.name === p.name ? "✓" : ""}</span>
              </Button>
            ))}
          </div>
          <p className="appearance-library-note">
            {selected
              ? t("{p0} is selected. One palette, in daylight or after hours.", {
                  p0: selected.name,
                })
              : t("Your custom colors are active. Adjust them in Advanced.")}
          </p>
        </div>
      </div>
      <AdvancedSettings title={t("About this preview")}>
        <p className="appearance-preview-help">
          {t(
            "This is an example workspace. Your choices apply throughout the app and are saved automatically.",
          )}
        </p>
      </AdvancedSettings>
    </section>
  );
}

export function AppearanceInterface({ appearance: a }: { appearance: AppearanceSettings }) {
  useLocale();
  const p = a.preferences;
  return (
    <Group
      title={t("Scale and accessibility")}
      persistence={{ mode: "automatic" }}
      layout="full"
      action={
        <Button
          variant="ghost"
          onClick={() => {
            a.onPreferences({
              ...p,
              contrast: APPEARANCE_DEFAULTS.contrast,
              controlDensity: APPEARANCE_DEFAULTS.controlDensity,
              chatWidth: APPEARANCE_DEFAULTS.chatWidth,
            });
            a.onDiffPalette(DIFF_PALETTE_DEFAULT);
            a.onUiScale(Math.round(UI_SCALE_DEFAULT * 100));
          }}
        >
          {t("Reset reading settings")}
        </Button>
      }
    >
      <Row
        id="interface-scale"
        label={t("Interface scale")}
        description={t(
          "Zoom the whole interface. You can also use Ctrl+=, Ctrl+-, and Ctrl+0 (Cmd on macOS).",
        )}
      >
        <Select
          label={t("Interface scale")}
          value={String(Math.round(a.uiScale * 100))}
          options={UI_SCALE_PERCENTS.map((percent) => ({
            value: String(percent),
            label: `${percent}%`,
          }))}
          onChange={(value) => a.onUiScale(Number(value))}
        />
      </Row>
      <Row id="control-density" label={t("Control density")}>
        <Select
          label={t("Control density")}
          value={p.controlDensity}
          options={[
            { value: "compact", label: t("Compact") },
            { value: "comfortable", label: t("Comfortable") },
            { value: "touch", label: t("Touch") },
          ]}
          onChange={(value) =>
            a.onPreferences({
              ...p,
              controlDensity: value === "comfortable" || value === "touch" ? value : "compact",
            })
          }
        />
      </Row>
      <Row
        id="interface-contrast"
        label={t("Contrast")}
        description={t("Make structural borders and secondary text softer or stronger.")}
      >
        <Slider
          label={t("Contrast")}
          value={p.contrast}
          display={`${p.contrast}%`}
          min={75}
          max={150}
          onChange={(contrast) => a.onPreferences({ ...p, contrast })}
        />
      </Row>
      <Row
        id="diff-colors"
        label={t("Diff colors")}
        description={t("Choose how added (+) and removed (−) lines are highlighted.")}
      >
        <Select
          label={t("Diff colors")}
          value={a.diffPalette}
          options={[
            {
              value: "default",
              get label() {
                return t("Red & green");
              },
            },
            {
              value: "colorblind",
              get label() {
                return t("Blue & orange");
              },
            },
            {
              value: "high-contrast",
              get label() {
                return t("Blue & orange · stronger");
              },
            },
          ]}
          onChange={(value) =>
            a.onDiffPalette(value === "colorblind" || value === "high-contrast" ? value : "default")
          }
        />
      </Row>
      <Row
        id="chat-width"
        label={t("Chat width")}
        description={t(
          "Limit message width on large screens. Full width uses all available space.",
        )}
      >
        <Select
          label={t("Chat width")}
          value={p.chatWidth}
          options={[
            {
              value: "comfortable",
              get label() {
                return t("Comfortable");
              },
            },
            {
              value: "wide",
              get label() {
                return t("Wide");
              },
            },
            {
              value: "full",
              get label() {
                return t("Full width");
              },
            },
          ]}
          onChange={(value) =>
            a.onPreferences({
              ...p,
              chatWidth: value === "wide" || value === "full" ? value : "comfortable",
            })
          }
        />
      </Row>
    </Group>
  );
}

export function AppearanceTypography({ appearance: a }: { appearance: AppearanceSettings }) {
  useLocale();
  const p = a.preferences;
  const fontOptions = (fonts: readonly string[]) =>
    fonts.map((value) => ({
      value,
      label: value === "System" ? t("System default") : value,
    }));
  return (
    <Group
      title={t("Fonts and code")}
      persistence={{ mode: "automatic" }}
      layout="full"
      action={
        <Button
          variant="ghost"
          onClick={() =>
            a.onPreferences({
              ...p,
              interfaceFont: APPEARANCE_DEFAULTS.interfaceFont,
              codeFont: APPEARANCE_DEFAULTS.codeFont,
              codeSize: APPEARANCE_DEFAULTS.codeSize,
              wordWrap: APPEARANCE_DEFAULTS.wordWrap,
            })
          }
        >
          {t("Reset fonts")}
        </Button>
      }
    >
      <Row
        id="interface-font"
        label={t("Interface font")}
        description={t("Navigation, messages, buttons and settings.")}
      >
        <Select
          label={t("Interface font")}
          value={p.interfaceFont}
          options={fontOptions(INTERFACE_FONTS)}
          onChange={(interfaceFont) => a.onPreferences({ ...p, interfaceFont })}
        />
      </Row>
      <Row
        id="monospace-font"
        label={t("Monospace font")}
        description={t("Code blocks, file editors, diffs and the terminal.")}
      >
        <Select
          label={t("Monospace font")}
          value={p.codeFont}
          options={fontOptions(CODE_FONTS)}
          onChange={(codeFont) => a.onPreferences({ ...p, codeFont })}
        />
        <div id="setting-code-font-size" data-setting-id="code-font-size" tabIndex={-1}>
          <Select
            label={t("Code font size")}
            value={String(p.codeSize)}
            options={[11, 12, 13, 14, 15, 16, 17, 18].map((value) => ({
              value: String(value),
              get label() {
                return t("{p0} px", { p0: value });
              },
            }))}
            onChange={(value) => a.onPreferences({ ...p, codeSize: Number(value) })}
          />
        </div>
      </Row>
      <Row
        id="code-word-wrap"
        label={t("Word wrap")}
        description={t(
          "Wrap long lines in chat code blocks. File editors keep their own wrap control.",
        )}
      >
        <Toggle
          label={t("Word wrap")}
          on={p.wordWrap}
          onChange={(wordWrap) => a.onPreferences({ ...p, wordWrap })}
        />
      </Row>
      <pre className="appearance-code-sample" aria-label={t("Code font preview")}>
        <code>{'const message = "Hello, bycoda";\nconsole.log(message);'}</code>
      </pre>
    </Group>
  );
}
