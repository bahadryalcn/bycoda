import { themePalette } from "../../../shared/theme/palette";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { t, useLocale } from "../../../shared/i18n";
import type { CSSProperties, ReactNode } from "react";
import { Group, Row, Segmented, Select, Slider } from "./settingsControls";
import type { AppearanceSettings } from "./useAppearanceSettings";
import { APPEARANCE_DEFAULTS, CODE_FONTS, INTERFACE_FONTS } from "../model/appearancePreferences";
import {
  ACCENT_COLOR_DEFAULT,
  DIFF_PALETTE_DEFAULT,
  THEME_HUE_DEFAULT,
  THEME_SATURATION_DEFAULT,
  THEME_DARK_LIGHTNESS_DEFAULT,
  THEME_PREFERENCE_DEFAULT,
  type ThemePreference,
} from "../model/appearance";
import { UI_SCALE_DEFAULT, UI_SCALE_PERCENTS } from "../model/uiScale";
import { useColorScheme } from "../../../shared/hooks/useColorScheme";
import { useCodeTheme } from "../../../shared/hooks/useCodeTheme";
import { Button } from "../../../shared/ui/Button";
import { Check, RotateCcw } from "../../../shared/ui/icons";
import { TextField } from "../../../shared/ui/TextField";
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

/**
 * The palette whose surface tint matches. Only surface values count: an accent override never
 * unselects a palette, and hue is meaningless at zero saturation (Ink is the neutral palette).
 */
export function matchThemePalette(a: {
  themeHue: number;
  themeSaturation: number;
  themeDarkLightness: number;
}) {
  return presets.find(
    (p) =>
      p.saturation === a.themeSaturation &&
      p.lightness === a.themeDarkLightness &&
      (p.saturation === 0 || p.hue === a.themeHue),
  );
}

/** Where the accent comes from, stated apart from the surface palette. */
export function accentSourceLabel(a: { accentColor: string | null }) {
  const accent = a.accentColor?.toLowerCase();
  if (!accent || accent === ACCENT_COLOR_DEFAULT.toLowerCase()) return t("Accent: default");
  const palette = presets.find((p) => p.accent.toLowerCase() === accent);
  return palette ? t("Accent: {p0} palette", { p0: palette.name }) : t("Accent: custom");
}

/** The palette's own surface values for its swatch; these show a selectable option, not live UI. */
function paletteSwatch(p: (typeof presets)[number], light: boolean): CSSProperties {
  const saturation = light ? Math.round(p.saturation * 0.2) : p.saturation;
  const base = light ? 94 : p.lightness + 5;
  const raised = light ? 100 : p.lightness + 13;
  return {
    "--palette-base": `hsl(${p.hue} ${saturation}% ${base}%)`,
    "--palette-raised": `hsl(${p.hue} ${saturation}% ${raised}%)`,
    "--palette-accent": p.accent,
  } as CSSProperties;
}

/**
 * One live sample of the current appearance: surface steps, text, link, selection and the
 * accent action. Every color is a theme role, so it follows the palette, accent, mode and
 * contrast as they change. It is a picture, not a control (inert), and has no state of its own.
 */
export function AppearancePreview() {
  useLocale();
  return (
    <figure className="appearance-preview">
      <figcaption className="appearance-preview-title">{t("Preview")}</figcaption>
      <div className="appearance-preview-window" inert aria-hidden="true">
        <div className="appearance-preview-rail">
          <span>{t("Workspace")}</span>
          <span data-selected="true">{t("Chat")}</span>
          <span>{t("Terminal")}</span>
        </div>
        <div className="appearance-preview-main">
          <p className="user-message-bubble appearance-preview-bubble">{t("Message")}</p>
          <p className="appearance-preview-text">
            {PRODUCT_IDENTITY.displayName} <mark>{t("Selection")}</mark>{" "}
            <span className="appearance-preview-link">Aa</span>
          </p>
          <div className="appearance-preview-lines">
            <i />
            <i />
          </div>
          <div className="appearance-preview-composer">
            <span className="appearance-preview-placeholder" />
            <Button variant="primary" tone="accent" size="sm" tabIndex={-1}>
              {t("Send")}
            </Button>
          </div>
        </div>
      </div>
    </figure>
  );
}

/** Mode, palette and accent as one related group; the caller supplies the accent rows. */
export function AppearanceStudio({
  appearance: a,
  children,
}: {
  appearance: AppearanceSettings;
  children?: ReactNode;
}) {
  useLocale();
  const light = useColorScheme() === "light";
  const selected = matchThemePalette(a);
  const resetScope = t(
    "Resets the color scheme, palette tint, accent and accent readability. Other appearance settings stay.",
  );
  const resetColors = () => {
    a.onThemePreference(THEME_PREFERENCE_DEFAULT);
    a.onTint(THEME_HUE_DEFAULT, THEME_SATURATION_DEFAULT);
    a.onDarkLightness(THEME_DARK_LIGHTNESS_DEFAULT);
    a.onAccentColor(ACCENT_COLOR_DEFAULT);
    // Accent readability is a color preference, so it returns to Auto with the accent.
    a.onPreferences({ ...a.preferences, accentReadability: APPEARANCE_DEFAULTS.accentReadability });
  };
  return (
    <Group
      title={t("Color scheme")}
      description={resetScope}
      action={
        <Button
          variant="ghost"
          tooltip={resetScope}
          startIcon={<RotateCcw aria-hidden className="icon-sm" />}
          onClick={resetColors}
        >
          {t("Reset colors")}
        </Button>
      }
    >
      <Row
        id="theme"
        label={t("Mode")}
        scope={
          a.themePreference === "system" ? (
            <span role="status">
              {t("Active mode: {p0}", { p0: light ? t("Light") : t("Dark") })}
            </span>
          ) : undefined
        }
      >
        <Segmented<ThemePreference>
          label={t("Color scheme")}
          value={a.themePreference}
          options={[
            {
              value: "system",
              get label() {
                return t("System");
              },
            },
            {
              value: "light",
              get label() {
                return t("Light");
              },
            },
            {
              value: "dark",
              get label() {
                return t("Dark");
              },
            },
          ]}
          onChange={a.onThemePreference}
        />
      </Row>
      <Row
        id="theme-palettes"
        stacked
        label={t("Theme palettes")}
        scope={
          selected
            ? undefined
            : t("Your custom colors are active. Adjust them in Custom surface colors.")
        }
      >
        <div className="appearance-palettes">
          {presets.map((p) => {
            const on = selected?.name === p.name;
            return (
              <Button
                variant="item"
                align="start"
                selected={on}
                key={p.name}
                className="appearance-palette"
                tooltip={t(p.note)}
                aria-pressed={on}
                onClick={() => {
                  a.onTint(p.hue, p.saturation);
                  a.onDarkLightness(p.lightness);
                  a.onAccentColor(p.accent);
                }}
              >
                <span
                  className="appearance-palette-swatch"
                  aria-hidden="true"
                  style={paletteSwatch(p, light)}
                >
                  <i />
                  <b />
                </span>
                <span className="appearance-palette-name">{p.name}</span>
                {on ? <Check aria-hidden className="icon-xs ms-auto" strokeWidth={2} /> : null}
              </Button>
            );
          })}
        </div>
      </Row>
      {children}
    </Group>
  );
}

export function AppearanceInterface({ appearance: a }: { appearance: AppearanceSettings }) {
  useLocale();
  const p = a.preferences;
  return (
    <Group
      title={t("Scale and accessibility")}
      action={
        <Button
          variant="ghost"
          onClick={() => {
            a.onPreferences({
              ...p,
              contrast: APPEARANCE_DEFAULTS.contrast,
              controlDensity: APPEARANCE_DEFAULTS.controlDensity,
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
    </Group>
  );
}

export function AppearanceTypography({ appearance: a }: { appearance: AppearanceSettings }) {
  useLocale();
  const codeTheme = useCodeTheme();
  const p = a.preferences;
  const fontOptions = (fonts: readonly string[]) =>
    fonts.map((value) => ({
      value,
      label: value === "System" ? t("System default") : value,
    }));
  return (
    <Group
      title={t("Fonts and code")}
      action={
        <Button
          variant="ghost"
          onClick={() =>
            a.onPreferences({
              ...p,
              interfaceFont: APPEARANCE_DEFAULTS.interfaceFont,
              codeFont: APPEARANCE_DEFAULTS.codeFont,
              codeSize: APPEARANCE_DEFAULTS.codeSize,
              terminalFont: APPEARANCE_DEFAULTS.terminalFont,
              terminalSize: APPEARANCE_DEFAULTS.terminalSize,
              terminalWeight: APPEARANCE_DEFAULTS.terminalWeight,
              terminalLineHeight: APPEARANCE_DEFAULTS.terminalLineHeight,
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
      <div className="appearance-type-sample" aria-label={t("Interface font")}>
        <span className="appearance-type-alphabet">Aa</span>
        <div>
          <p>{t("Navigation, messages, buttons and settings.")}</p>
          <span>ABCDEFGHIJKLMNOPQRSTUVWXYZ · 0123456789</span>
        </div>
      </div>
      <Row
        id="monospace-font"
        label={t("Monospace font")}
        description={t(
          "Code blocks, file editors and diffs. Terminals inherit this font unless overridden below.",
        )}
      >
        <Select
          label={t("Monospace font")}
          value={p.codeFont}
          options={fontOptions(CODE_FONTS)}
          onChange={(codeFont) => a.onPreferences({ ...p, codeFont })}
        />
      </Row>
      <Row
        id="code-theme"
        label={t("Code theme")}
        description={t(
          "Applies to editors, diffs and code blocks. Light appearance uses GitHub Light.",
        )}
      >
        <Select
          label={t("Code theme")}
          value={codeTheme}
          options={[
            { value: "github", label: "GitHub Dark default" },
            { value: "dracula", label: "Dracula" },
          ]}
          onChange={(value) =>
            a.onPreferences({ ...p, codeTheme: value === "dracula" ? "dracula" : "github" })
          }
        />
      </Row>
      <Row id="code-font-size" label={t("Code font size")}>
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
      </Row>

      <pre className="appearance-code-sample" aria-label={t("Code font preview")}>
        <code>
          <span className="appearance-code-comment">// bycoda · TypeScript</span>
          {"\n"}
          <span className="appearance-code-keyword">const</span>
          {" message = "}
          <span className="appearance-code-string">{'"Hello, bycoda"'}</span>
          {";\n\n"}
          <span className="appearance-code-keyword">export function</span>
          {" greet(name: string) {\n  return `${message}, ${name}`;\n}"}
        </code>
      </pre>
      <Row
        id="terminal-font"
        label={t("Terminal font")}
        description={t(
          "Enter an installed font name, such as Cascadia Code or JetBrains Mono. Leave empty to inherit the monospace font.",
        )}
      >
        <TextField
          label={t("Terminal font")}
          hideLabel
          value={p.terminalFont}
          placeholder={t("System default")}
          onChange={(event) => a.onPreferences({ ...p, terminalFont: event.target.value })}
        />
      </Row>
      <Row
        id="terminal-font-size"
        label={t("Terminal font size")}
        description={t("Ctrl + mouse wheel zooms only the terminal under the pointer.")}
      >
        <Slider
          label={t("Terminal font size")}
          value={p.terminalSize}
          display={t("{p0} px", { p0: p.terminalSize })}
          min={8}
          max={40}
          onChange={(terminalSize) => a.onPreferences({ ...p, terminalSize })}
        />
      </Row>
      <Row id="terminal-font-weight" label={t("Terminal font weight")}>
        <Select
          label={t("Terminal font weight")}
          value={String(p.terminalWeight)}
          options={[
            { value: "300", label: t("Light") },
            { value: "400", label: t("Regular") },
            { value: "500", label: t("Medium") },
            { value: "600", label: t("Semibold") },
            { value: "700", label: t("Bold") },
          ]}
          onChange={(value) => a.onPreferences({ ...p, terminalWeight: Number(value) })}
        />
      </Row>
      <Row id="terminal-line-height" label={t("Terminal line spacing")}>
        <Select
          label={t("Terminal line spacing")}
          value={String(p.terminalLineHeight)}
          options={[1, 1.15, 1.35, 1.5].map((value) => ({
            value: String(value),
            label: `${value}×`,
          }))}
          onChange={(value) => a.onPreferences({ ...p, terminalLineHeight: Number(value) })}
        />
      </Row>
      <pre
        className="appearance-terminal-sample"
        aria-label={t("Terminal font preview")}
        style={{
          fontFamily: p.terminalFont.trim()
            ? `${JSON.stringify(p.terminalFont)}, monospace`
            : "var(--font-mono)",
          fontSize: p.terminalSize,
          fontWeight: p.terminalWeight,
          lineHeight: p.terminalLineHeight,
        }}
      >
        <code>
          {'bycoda $ echo "Hello, bycoda"\nHello, bycoda · 0123456789\nAa Bb Cc → [] {} ()'}
        </code>
      </pre>
    </Group>
  );
}
