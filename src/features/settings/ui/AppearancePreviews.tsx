import { themePalette } from "../../../shared/theme/palette";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { t, useLocale } from "../../../shared/i18n";
import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import {
  AdvancedSettings,
  Group,
  Row,
  Select,
  Slider,
  settingDomId,
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
  type ThemePreference,
} from "../model/appearance";
import { UI_SCALE_DEFAULT, UI_SCALE_PERCENTS } from "../model/uiScale";
import { useColorScheme } from "../../../shared/hooks/useColorScheme";
import { useCodeTheme } from "../../../shared/hooks/useCodeTheme";
import { Button } from "../../../shared/ui/Button";
import { Check } from "../../../shared/ui/icons";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Combobox } from "../../../shared/ui/Combobox";
import { liveBackgroundKeyTarget } from "./LiveBackgroundPicker";
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

/** True while the accent is the app default (no override, or the default value itself). */
export function isDefaultAccent(accentColor: string | null) {
  return !accentColor || accentColor.toLowerCase() === ACCENT_COLOR_DEFAULT.toLowerCase();
}

type Tint = { hue: number; saturation: number; lightness: number; accent: string };

/**
 * A tone's own surface values for a sample; these show a selectable option (a mode or a palette in
 * light or dark), not live UI, so they are computed from the option instead of the current theme.
 */
function toneStyle(p: Tint, light: boolean): CSSProperties {
  const saturation = light ? Math.round(p.saturation * 0.2) : p.saturation;
  const base = light ? 94 : p.lightness + 5;
  const raised = light ? 100 : p.lightness + 13;
  return {
    "--palette-base": `hsl(${p.hue} ${saturation}% ${base}%)`,
    "--palette-raised": `hsl(${p.hue} ${saturation}% ${raised}%)`,
    "--palette-accent": p.accent,
  } as CSSProperties;
}

function ToneSample({ tint, tone }: { tint: Tint; tone: "light" | "dark" }) {
  return (
    <span
      className="appearance-tone"
      data-tone={tone}
      aria-hidden="true"
      style={toneStyle(tint, tone === "light")}
    >
      <i />
      <b />
    </span>
  );
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

/** System / Light / Dark as three visual cards; the selected card carries the accent border. */
function ModeCards({ appearance: a }: { appearance: AppearanceSettings }) {
  const light = useColorScheme() === "light";
  const group = useRef<HTMLDivElement>(null);
  const tint: Tint = {
    hue: a.themeHue,
    saturation: a.themeSaturation,
    lightness: a.themeDarkLightness,
    accent: a.accentColor ?? ACCENT_COLOR_DEFAULT,
  };
  const modes: { value: ThemePreference; label: string }[] = [
    { value: "system", label: t("System") },
    { value: "light", label: t("Light") },
    { value: "dark", label: t("Dark") },
  ];
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = liveBackgroundKeyTarget(event.key, index, modes.length);
    const next = target === null ? undefined : modes[target];
    if (target === null || !next) return;
    event.preventDefault();
    a.onThemePreference(next.value);
    group.current
      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
      [target]?.focus({ preventScroll: true });
  };
  return (
    <div ref={group} role="radiogroup" aria-label={t("Color scheme")} className="appearance-modes">
      {modes.map((mode, index) => {
        const on = a.themePreference === mode.value;
        return (
          <Button
            key={mode.value}
            variant="item"
            motion="none"
            selected={on}
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className="appearance-mode-card"
            data-mode={mode.value}
            tooltip={
              mode.value === "system"
                ? t("Active mode: {p0}", { p0: light ? t("Light") : t("Dark") })
                : undefined
            }
            onClick={() => a.onThemePreference(mode.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span
              className="appearance-mode-preview"
              data-split={mode.value === "system" || undefined}
            >
              {mode.value === "dark" ? null : <ToneSample tint={tint} tone="light" />}
              {mode.value === "light" ? null : <ToneSample tint={tint} tone="dark" />}
            </span>
            <span className="appearance-card-name">
              {mode.label}
              {on ? <Check aria-hidden className="icon-xs ms-auto" strokeWidth={2} /> : null}
            </span>
          </Button>
        );
      })}
    </div>
  );
}

/**
 * Mode cards, then theme cards with the caller's accent rows, preview and Advanced rows. The
 * caller supplies those children because the accent picker lives with the page.
 */
export function AppearanceStudio({
  appearance: a,
  children,
}: {
  appearance: AppearanceSettings;
  children?: ReactNode;
}) {
  useLocale();
  const selected = matchThemePalette(a);
  const colorsModified =
    a.themeHue !== THEME_HUE_DEFAULT ||
    a.themeSaturation !== THEME_SATURATION_DEFAULT ||
    a.themeDarkLightness !== THEME_DARK_LIGHTNESS_DEFAULT ||
    !isDefaultAccent(a.accentColor) ||
    a.preferences.accentReadability !== APPEARANCE_DEFAULTS.accentReadability;
  const resetColors = () => {
    a.onTint(THEME_HUE_DEFAULT, THEME_SATURATION_DEFAULT);
    a.onDarkLightness(THEME_DARK_LIGHTNESS_DEFAULT);
    a.onAccentColor(ACCENT_COLOR_DEFAULT);
    // Accent readability is a color preference, so it returns to Auto with the accent.
    a.onPreferences({ ...a.preferences, accentReadability: APPEARANCE_DEFAULTS.accentReadability });
  };
  return (
    <>
      <Group
        title={t("Color scheme")}
        modified={a.themePreference !== THEME_PREFERENCE_DEFAULT}
        onReset={() => a.onThemePreference(THEME_PREFERENCE_DEFAULT)}
      >
        <Row id="theme" stacked label={t("Mode")}>
          <ModeCards appearance={a} />
        </Row>
      </Group>
      <Group
        title={t("Themes")}
        modified={colorsModified}
        resetLabel={t("Reset colors")}
        onReset={resetColors}
      >
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
                  motion="none"
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
                  <span className="appearance-mode-preview" data-split>
                    <ToneSample tint={p} tone="light" />
                    <ToneSample tint={p} tone="dark" />
                  </span>
                  <span className="appearance-card-name">
                    {p.name}
                    {on ? <Check aria-hidden className="icon-xs ms-auto" strokeWidth={2} /> : null}
                  </span>
                </Button>
              );
            })}
          </div>
        </Row>
        {children}
      </Group>
    </>
  );
}

export function AppearanceInterface({ appearance: a }: { appearance: AppearanceSettings }) {
  useLocale();
  const p = a.preferences;
  const scalePercent = Math.round(a.uiScale * 100);
  const defaultScalePercent = Math.round(UI_SCALE_DEFAULT * 100);
  return (
    <Group title={t("Interface")}>
      <Row
        id="interface-scale"
        label={t("Interface scale")}
        description={t("Zoom the whole interface.")}
        info={
          <InfoPopover className="shrink-0">
            <p>
              {t(
                "Zoom the whole interface. You can also use Ctrl+=, Ctrl+-, and Ctrl+0 (Cmd on macOS).",
              )}
            </p>
          </InfoPopover>
        }
        modified={scalePercent !== defaultScalePercent}
        onReset={() => a.onUiScale(defaultScalePercent)}
      >
        <Select
          label={t("Interface scale")}
          value={String(scalePercent)}
          options={UI_SCALE_PERCENTS.map((percent) => ({
            value: String(percent),
            label: `${percent}%`,
          }))}
          onChange={(value) => a.onUiScale(Number(value))}
        />
      </Row>
      <Row
        id="control-density"
        label={t("Control density")}
        description={t("Height of buttons and fields.")}
        modified={p.controlDensity !== APPEARANCE_DEFAULTS.controlDensity}
        onReset={() =>
          a.onPreferences({ ...p, controlDensity: APPEARANCE_DEFAULTS.controlDensity })
        }
      >
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
        modified={p.contrast !== APPEARANCE_DEFAULTS.contrast}
        onReset={() => a.onPreferences({ ...p, contrast: APPEARANCE_DEFAULTS.contrast })}
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
        modified={a.diffPalette !== DIFF_PALETTE_DEFAULT}
        onReset={() => a.onDiffPalette(DIFF_PALETTE_DEFAULT)}
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

const CODE_SIZES = [11, 12, 13, 14, 15, 16, 17, 18] as const;
const TERMINAL_SIZES = [8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 40] as const;
/** Common terminal faces offered as suggestions; the field still accepts any installed font. */
const TERMINAL_FONT_SUGGESTIONS = [
  "Cascadia Code",
  "JetBrains Mono",
  "Fira Code",
  "Consolas",
  "Menlo",
  "SF Mono",
  "Courier New",
] as const;

/** Sizes in px for a font row's size select; a saved size outside the list stays selectable. */
function sizeOptions(sizes: readonly number[], current: number) {
  return [...new Set([...sizes, current])]
    .sort((x, y) => x - y)
    .map((value) => ({ value: String(value), label: t("{p0} px", { p0: value }) }));
}

/** The shared font + size pattern: the font control and a compact size select side by side. */
function FontPair({
  font,
  size,
  sizeId,
}: {
  font: ReactNode;
  size: ReactNode;
  /** Indexed setting id of the size control, so search and deep links still land on it. */
  sizeId: string;
}) {
  return (
    <div className="appearance-font-pair">
      <div className="appearance-font">{font}</div>
      <div className="appearance-size" id={settingDomId(sizeId)} data-setting-id={sizeId}>
        {size}
      </div>
    </div>
  );
}

export function AppearanceTypography({ appearance: a }: { appearance: AppearanceSettings }) {
  useLocale();
  const codeTheme = useCodeTheme();
  const p = a.preferences;
  const D = APPEARANCE_DEFAULTS;
  const fontOptions = (fonts: readonly string[]) =>
    fonts.map((value) => ({
      value,
      label: value === "System" ? t("System default") : value,
    }));
  return (
    <Group title={t("Typography")}>
      <Row
        id="interface-font"
        label={t("Interface font")}
        description={t("Navigation, messages, buttons and settings.")}
        modified={p.interfaceFont !== D.interfaceFont}
        onReset={() => a.onPreferences({ ...p, interfaceFont: D.interfaceFont })}
        feedback={
          <div className="appearance-type-sample" aria-hidden="true">
            <span className="appearance-type-alphabet">Aa</span>
            <span>The quick brown fox jumps over the lazy dog · 0123456789</span>
          </div>
        }
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
        description={t("Code blocks, editors and diffs.")}
        info={
          <InfoPopover className="shrink-0">
            <p>
              {t(
                "Code blocks, file editors and diffs. Terminals inherit this font unless overridden below.",
              )}
            </p>
          </InfoPopover>
        }
        modified={p.codeFont !== D.codeFont || p.codeSize !== D.codeSize}
        onReset={() => a.onPreferences({ ...p, codeFont: D.codeFont, codeSize: D.codeSize })}
        feedback={
          <pre className="appearance-code-sample" aria-label={t("Code font preview")}>
            <code>
              <span className="appearance-code-line">
                <span className="appearance-code-comment">// bycoda · TypeScript</span>
              </span>
              <span className="appearance-code-line">
                <span className="appearance-code-keyword">const</span>
                {" message = "}
                <span className="appearance-code-string">{'"Hello, bycoda"'}</span>
                {";"}
              </span>
              <span className="appearance-code-line" data-diff="del">
                {"- return message;"}
              </span>
              <span className="appearance-code-line" data-diff="add">
                {"+ return `${message}!`;"}
              </span>
            </code>
          </pre>
        }
      >
        <FontPair
          sizeId="code-font-size"
          font={
            <Select
              label={t("Monospace font")}
              value={p.codeFont}
              options={fontOptions(CODE_FONTS)}
              onChange={(codeFont) => a.onPreferences({ ...p, codeFont })}
            />
          }
          size={
            <Select
              label={t("Code font size")}
              value={String(p.codeSize)}
              options={sizeOptions(CODE_SIZES, p.codeSize)}
              onChange={(value) => a.onPreferences({ ...p, codeSize: Number(value) })}
            />
          }
        />
      </Row>
      <Row
        id="code-theme"
        label={t("Code theme")}
        description={t(
          "Applies to editors, diffs and code blocks. Light appearance uses GitHub Light.",
        )}
        modified={p.codeTheme !== D.codeTheme}
        onReset={() => a.onPreferences({ ...p, codeTheme: D.codeTheme })}
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
      <Row
        id="terminal-font"
        label={t("Terminal font")}
        description={t("Empty inherits the monospace font.")}
        info={
          <InfoPopover className="shrink-0">
            <p>
              {t(
                "Enter an installed font name, such as Cascadia Code or JetBrains Mono. Leave empty to inherit the monospace font.",
              )}
            </p>
            <p>{t("Ctrl + mouse wheel zooms only the terminal under the pointer.")}</p>
          </InfoPopover>
        }
        modified={p.terminalFont !== D.terminalFont || p.terminalSize !== D.terminalSize}
        onReset={() =>
          a.onPreferences({ ...p, terminalFont: D.terminalFont, terminalSize: D.terminalSize })
        }
        feedback={
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
        }
      >
        <FontPair
          sizeId="terminal-font-size"
          font={
            <Combobox
              label={t("Terminal font")}
              hideLabel
              allowCustomValue
              options={TERMINAL_FONT_SUGGESTIONS.map((font) => ({ value: font, label: font }))}
              value={p.terminalFont}
              placeholder={t("System default")}
              onValueChange={(terminalFont) => a.onPreferences({ ...p, terminalFont })}
            />
          }
          size={
            <Select
              label={t("Terminal font size")}
              value={String(p.terminalSize)}
              options={sizeOptions(TERMINAL_SIZES, p.terminalSize)}
              onChange={(value) => a.onPreferences({ ...p, terminalSize: Number(value) })}
            />
          }
        />
      </Row>
      <AdvancedSettings
        defaultOpen={false}
        settingIds={["terminal-font-weight", "terminal-line-height"]}
      >
        <Row
          id="terminal-font-weight"
          label={t("Terminal font weight")}
          modified={p.terminalWeight !== D.terminalWeight}
          onReset={() => a.onPreferences({ ...p, terminalWeight: D.terminalWeight })}
        >
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
        <Row
          id="terminal-line-height"
          label={t("Terminal line spacing")}
          modified={p.terminalLineHeight !== D.terminalLineHeight}
          onReset={() => a.onPreferences({ ...p, terminalLineHeight: D.terminalLineHeight })}
        >
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
      </AdvancedSettings>
    </Group>
  );
}
