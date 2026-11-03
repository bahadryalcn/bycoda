import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { t, useLocale } from "../../../shared/i18n";
import { useState, type CSSProperties, type ReactNode } from "react";
import {
  AdvancedSettings,
  Group,
  Row,
  Segmented,
  Select,
  Slider,
  settingDomId,
} from "./settingsControls";
import type { AppearanceSettings } from "./useAppearanceSettings";
import {
  APPEARANCE_DEFAULTS,
  CANVAS_BACKGROUND_DEFAULT,
  CODE_FONTS,
  INTERFACE_FONTS,
  type CanvasBackground,
} from "../model/appearancePreferences";
import {
  ACCENT_COLOR_DEFAULT,
  DIFF_PALETTE_DEFAULT,
  THEME_HUE_DEFAULT,
  THEME_SATURATION_DEFAULT,
  THEME_DARK_LIGHTNESS_DEFAULT,
  THEME_PREFERENCE_DEFAULT,
  canvasBackgroundIsPure,
  type ThemePreference,
} from "../model/appearance";
import { THEME_PALETTE_PRESETS, matchThemePalette } from "../model/themePalettes";
import { UI_SCALE_DEFAULT, UI_SCALE_MAX, UI_SCALE_MIN, UI_SCALE_STEP } from "../model/uiScale";
import { useColorScheme } from "../../../shared/hooks/useColorScheme";
import { useCodeTheme } from "../../../shared/hooks/useCodeTheme";
import { Button } from "../../../shared/ui/Button";
import { Check } from "../../../shared/ui/icons";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Combobox } from "../../../shared/ui/Combobox";
import { RadioTiles } from "./RadioTiles";
import "./AppearancePreviews.css";
import "./AppearanceSettings.css";

export { matchThemePalette };

/** True while the accent is the app default (no override, or the default value itself). */
export function isDefaultAccent(accentColor: string | null) {
  return !accentColor || accentColor.toLowerCase() === ACCENT_COLOR_DEFAULT.toLowerCase();
}

export type Tint = { hue: number; saturation: number; lightness: number; accent: string };

/**
 * A tone's own surface values for a sample; these show a selectable option (a mode or a palette in
 * light or dark), not live UI, so they are computed from the option instead of the current theme.
 * With the Pure background the ground is the shared pure role and the card keeps the palette tint.
 */
function toneStyle(p: Tint, light: boolean, pure: boolean): CSSProperties {
  const saturation = light ? Math.round(p.saturation * 0.2) : p.saturation;
  const tinted = (lightness: number) => `hsl(${p.hue} ${saturation}% ${lightness}%)`;
  const base = pure
    ? `var(${light ? "--palette-canvasPureLight" : "--palette-canvasPureDark"})`
    : tinted(light ? 94 : p.lightness + 5);
  const raised = light ? tinted(pure ? 93 : 100) : tinted(p.lightness + 13);
  return {
    "--palette-base": base,
    "--palette-raised": raised,
    "--palette-accent": p.accent,
  } as CSSProperties;
}

function ToneSample({ tint, tone, pure }: { tint: Tint; tone: "light" | "dark"; pure: boolean }) {
  return (
    <span
      className="appearance-tone"
      data-tone={tone}
      aria-hidden="true"
      style={toneStyle(tint, tone === "light", pure)}
    >
      <i />
      <b />
    </span>
  );
}

/** The sample inside a mode tile: one tone, or both side by side for System. */
export function ModePreview({
  mode,
  tint,
  pure,
}: {
  mode: ThemePreference;
  tint: Tint;
  pure: boolean;
}) {
  return (
    <span className="appearance-mode-preview" data-split={mode === "system" || undefined}>
      {mode === "dark" ? null : <ToneSample tint={tint} tone="light" pure={pure} />}
      {mode === "light" ? null : <ToneSample tint={tint} tone="dark" pure={pure} />}
    </span>
  );
}

/**
 * One live sample of the current appearance, drawn as a small app window: project rail, session
 * sidebar, chat canvas with a message, selection and link, a code card and the composer with the
 * accent action. Every color is a theme role, so it follows palette, Pure/Tinted background, accent,
 * mode and contrast as they change. It is a picture, not a control: inert and hidden from
 * assistive technology, and it mounts no app feature components.
 */
export function AppearancePreview() {
  useLocale();
  return (
    <figure className="appearance-preview" aria-hidden="true">
      <div className="appearance-preview-window" inert>
        <div className="appearance-preview-rail">
          <span data-selected="true">{PRODUCT_IDENTITY.displayName.slice(0, 1).toUpperCase()}</span>
          <span />
          <span />
          <span />
        </div>
        <div className="appearance-preview-sidebar">
          <span className="appearance-preview-heading">{t("Sessions")}</span>
          <span className="appearance-preview-row" data-selected="true">
            {t("Chat")}
          </span>
          <span className="appearance-preview-row">{t("Workspace")}</span>
          <span className="appearance-preview-row">{t("Terminal")}</span>
          <span className="appearance-preview-row">
            <i />
          </span>
          <span className="appearance-preview-row">
            <i />
          </span>
        </div>
        <div className="appearance-preview-chat">
          <div className="appearance-preview-transcript">
            <p className="user-message-bubble appearance-preview-bubble">{t("Message")}</p>
            <p className="appearance-preview-text">
              {PRODUCT_IDENTITY.displayName} <mark>{t("Selection")}</mark>{" "}
              <span className="appearance-preview-link">Aa</span>
            </p>
            <div className="appearance-preview-lines">
              <i />
              <i />
              <i />
            </div>
            <div className="appearance-preview-card">
              <i />
              <i />
            </div>
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
function ModeCards({ appearance: a, pure }: { appearance: AppearanceSettings; pure: boolean }) {
  const light = useColorScheme() === "light";
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
  return (
    <RadioTiles
      label={t("Color scheme")}
      className="appearance-modes"
      tileClassName="appearance-mode-card"
      value={a.themePreference}
      onChange={a.onThemePreference}
      options={modes.map((mode) => ({
        value: mode.value,
        data: { "data-mode": mode.value },
        tooltip:
          mode.value === "system"
            ? t("Active mode: {p0}", { p0: light ? t("Light") : t("Dark") })
            : undefined,
        children: (
          <>
            <ModePreview mode={mode.value} tint={tint} pure={pure} />
            <span className="appearance-card-name">
              {mode.label}
              {a.themePreference === mode.value ? (
                <Check aria-hidden className="icon-xs ms-auto" strokeWidth={2} />
              ) : null}
            </span>
          </>
        ),
      }))}
    />
  );
}

/**
 * Background tone: Pure paints the shared canvas pure black (dark) or white (light) for every
 * theme palette; Tinted keeps the palette canvas. Custom surface colors keep their own tinted
 * canvas, so the control is inactive while they are in use and says why.
 */
function CanvasBackgroundRow({
  appearance: a,
  customColors,
}: {
  appearance: AppearanceSettings;
  customColors: boolean;
}) {
  const value = a.preferences.canvasBackground;
  const save = (canvasBackground: CanvasBackground) =>
    a.onPreferences({ ...a.preferences, canvasBackground });
  return (
    <Row
      id="canvas-background"
      label={t("Background tone")}
      description={
        customColors
          ? t(
              "Custom surface colors keep their own background. Choose a theme palette to use Pure.",
            )
          : t("Pure is true black in dark mode and white in light mode.")
      }
      disabled={customColors}
      modified={value !== CANVAS_BACKGROUND_DEFAULT}
      onReset={() => save(CANVAS_BACKGROUND_DEFAULT)}
    >
      <Segmented<CanvasBackground>
        label={t("Background tone")}
        value={value}
        options={[
          { value: "pure", label: t("Pure") },
          { value: "tinted", label: t("Tinted") },
        ]}
        onChange={save}
      />
    </Row>
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
  const pureChosen = a.preferences.canvasBackground === "pure";
  const pure = canvasBackgroundIsPure(a.preferences.canvasBackground, a);
  const colorsModified =
    a.themeHue !== THEME_HUE_DEFAULT ||
    a.themeSaturation !== THEME_SATURATION_DEFAULT ||
    a.themeDarkLightness !== THEME_DARK_LIGHTNESS_DEFAULT ||
    !isDefaultAccent(a.accentColor) ||
    a.preferences.accentReadability !== APPEARANCE_DEFAULTS.accentReadability ||
    a.preferences.canvasBackground !== CANVAS_BACKGROUND_DEFAULT;
  const resetColors = () => {
    a.onTint(THEME_HUE_DEFAULT, THEME_SATURATION_DEFAULT);
    a.onDarkLightness(THEME_DARK_LIGHTNESS_DEFAULT);
    a.onAccentColor(ACCENT_COLOR_DEFAULT);
    // Accent readability and the background tone are color preferences, so they reset here too.
    a.onPreferences({
      ...a.preferences,
      accentReadability: APPEARANCE_DEFAULTS.accentReadability,
      canvasBackground: CANVAS_BACKGROUND_DEFAULT,
    });
  };
  return (
    <>
      <Group
        title={t("Color scheme")}
        modified={a.themePreference !== THEME_PREFERENCE_DEFAULT}
        onReset={() => a.onThemePreference(THEME_PREFERENCE_DEFAULT)}
      >
        <Row id="theme" stacked label={t("Mode")}>
          <ModeCards appearance={a} pure={pure} />
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
            {THEME_PALETTE_PRESETS.map((p) => {
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
                    <ToneSample tint={p} tone="light" pure={pureChosen} />
                    <ToneSample tint={p} tone="dark" pure={pureChosen} />
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
        <CanvasBackgroundRow appearance={a} customColors={!selected} />
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
  const [scaleDraft, setScaleDraft] = useState<number | null>(null);
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
        {/* Zoom reflows the whole window, so the value applies when the thumb is released (or a key
            changes it); dragging only previews the number and the thumb never moves under the pointer. */}
        <Slider
          label={t("Interface scale")}
          value={scaleDraft ?? scalePercent}
          display={`${scaleDraft ?? scalePercent}%`}
          min={Math.round(UI_SCALE_MIN * 100)}
          max={Math.round(UI_SCALE_MAX * 100)}
          step={Math.round(UI_SCALE_STEP * 100)}
          onChange={setScaleDraft}
          onValueCommit={(percent) => {
            setScaleDraft(null);
            a.onUiScale(percent);
          }}
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
