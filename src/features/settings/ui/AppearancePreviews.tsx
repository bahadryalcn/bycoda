import { themePalette } from "../../../shared/theme/palette";
import { t, useLocale } from "../../../shared/i18n";
import type { CSSProperties } from "react";
import { Group, Row, Select, Slider, Toggle, Segmented } from "./settingsControls";
import type { AppearanceSettings } from "./useAppearanceSettings";
import { CODE_FONTS, INTERFACE_FONTS } from "../model/appearancePreferences";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { useColorScheme } from "../../../shared/hooks/useColorScheme";
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
  const scheme = useColorScheme();
  const light = scheme === "light";
  const selected = presets.find(
    (p) =>
      p.hue === a.themeHue &&
      p.saturation === a.themeSaturation &&
      p.lightness === a.themeDarkLightness &&
      p.accent.toLowerCase() === a.accentColor?.toLowerCase(),
  );
  const workspaceStyle = {
    "--studio-base": `hsl(${a.themeHue} ${a.themeSaturation}% ${light ? 97 : a.themeDarkLightness}%)`,
    "--studio-raised": `hsl(${a.themeHue} ${a.themeSaturation}% ${light ? 92 : a.themeDarkLightness + 7}%)`,
    "--studio-ink": `hsl(${a.themeHue} ${a.themeSaturation}% ${light ? 16 : 91}%)`,
    "--studio-line": `color-mix(in srgb, var(--studio-ink) ${(7 * a.preferences.contrast) / 100}%, transparent)`,
    "--studio-secondary": `color-mix(in srgb, var(--studio-ink) ${Math.min(85, (55 * a.preferences.contrast) / 100)}%, transparent)`,
    "--studio-chat-span":
      a.preferences.chatWidth === "full"
        ? "100%"
        : a.preferences.chatWidth === "wide"
          ? "94%"
          : "80%",
    "--studio-sidebar-opacity": light ? 1 : a.opacity,
    "--studio-body-opacity": light || !a.bodyGlass ? 1 : a.mainOpacity,
  } as CSSProperties;
  return (
    <div className="appearance-studio">
      <div className="appearance-studio-heading">
        <div>
          <span className="appearance-eyebrow">{t("Theme and colors")}</span>
          <h2>{t("Workspace appearance")}</h2>
          <p>{t("Choose a color mode and palette, then check the example workspace below.")}</p>
        </div>
        <div id="setting-theme" data-setting-id="theme" className="appearance-scheme-control">
          <span>{t("Color mode")}</span>
          <span role="status">
            {t("Active mode: {p0}", { p0: light ? t("Light") : t("Dark") })}
          </span>
          <Segmented
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
        </div>
      </div>
      <div className="appearance-studio-body">
        <div
          className="appearance-desk"
          style={workspaceStyle}
          role="region"
          aria-label={t("Live workspace preview")}
        >
          <div className="appearance-desk-top">
            <span>
              <img src={PRODUCT_IDENTITY.logoSrc} alt="" />
              <img
                className="bycoda-brand-lettering"
                style={{ width: 90, height: 18 }}
                src={PRODUCT_IDENTITY.wordmarkSrc}
                alt={PRODUCT_IDENTITY.displayName}
              />
            </span>
            <span className="appearance-desk-tab">{t("studio / welcome")}</span>
            <span className="appearance-live-label">
              <i />
              {t("Live preview")}
            </span>
          </div>
          <div className="appearance-desk-content">
            <aside className="appearance-desk-sidebar" aria-label={t("Sidebar preview")}>
              <span className="appearance-desk-caption">{t("YOUR CORNER")}</span>
              <strong>
                <span>▱</span>
                {t(" Studio")}
              </strong>
              <div className="appearance-desk-current">{t("Welcome home")}</div>
              <div>{t("Small ideas")}</div>
              <div>{t("Next steps")}</div>
              <span className="appearance-desk-caption appearance-desk-later">
                {t("RECENT FILES")}
              </span>
              <div className="appearance-desk-file">{t("↳ welcome.ts")}</div>
              <div className="appearance-desk-file">{t("↳ notes.md")}</div>
              <div className="appearance-desk-sidebar-bottom">{t("All the room you need.")}</div>
            </aside>
            <div className="appearance-desk-chat">
              <div className="appearance-desk-conversation">
                <div className="appearance-desk-user">
                  {t("Let’s make something good together.")}
                </div>
                <div className="appearance-desk-response">
                  <span className="appearance-desk-caption">{t("İMECE")}</span>
                  <h3>{t("Good work starts with a little clarity.")}</h3>
                  <p>{t("Your ideas, a quiet workspace, and room for the next step.")}</p>
                </div>
                <div className="appearance-desk-code" aria-label={t("Code and diff preview")}>
                  <div>
                    <span>{t("▧ welcome.ts")}</span>
                    <span className="appearance-desk-caption">−1 +1</span>
                  </div>
                  <pre>
                    <code>
                      <span className="appearance-code-keyword">{"export function"}</span>
                      {" welcome(name: string) {\n"}
                      <span className="appearance-deletion">{'−  return "Hello " + name;\n'}</span>
                      <span className="appearance-addition">
                        {
                          " + return `Merhaba ${name}, let’s build something thoughtful together.`;\n"
                        }
                      </span>
                      {"}"}
                    </code>
                  </pre>
                </div>
                <div className="appearance-desk-terminal">
                  <span>✓</span>
                  {t(" Workspace ready")} <span className="appearance-desk-terminal-cursor">▎</span>
                </div>
                <div className="appearance-desk-composer">
                  <span>{t("What shall we work on?")}</span>
                  <span>↗</span>
                </div>
              </div>
            </div>
          </div>
          <div className="appearance-desk-footer">
            <span>
              {selected?.name ?? t("Custom palette")} / {light ? t("daylight") : t("after hours")}
            </span>
            <span>
              {a.preferences.codeSize}
              {t("px · ")}
              {a.preferences.chatWidth}
            </span>
          </div>
        </div>
        <div className="appearance-material-library">
          <div className="appearance-library-heading">
            <h3>{t("Theme palettes")}</h3>
            <p>{t("Surface · ink · accent")}</p>
          </div>
          <div id="setting-theme-palettes" data-setting-id="theme-palettes" role="group" aria-label={t("Theme palettes")}>
            {presets.map((p) => (
              <button
                type="button"
                key={p.name}
                className="appearance-palette"
                aria-pressed={selected?.name === p.name}
                onClick={() => {
                  a.onTint(p.hue, p.saturation);
                  a.onDarkLightness(p.lightness);
                  a.onAccentColor(p.accent);
                }}
                style={
                  {
                    "--material-base": `hsl(${p.hue} ${p.saturation}% ${light ? 94 : p.lightness + 5}%)`,
                    "--material-ink": `hsl(${p.hue} ${p.saturation}% ${light ? 24 : 82}%)`,
                    "--material-accent": p.accent,
                  } as CSSProperties
                }
              >
                <span className="appearance-material-sample" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="appearance-material-name">
                  <strong>{p.name}</strong>
                  <small>{t(p.note)}</small>
                </span>
                <span className="appearance-material-check" aria-hidden="true">
                  {selected?.name === p.name ? "✓" : ""}
                </span>
              </button>
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
      <div className="appearance-studio-caption">
        <span>{t("Make it yours.")}</span>
        <p>
          {t(
            "This is an example workspace. Your choices apply throughout the app and are saved automatically.",
          )}
        </p>
      </div>
    </div>
  );
}

export function AppearanceInterface({ appearance: a }: { appearance: AppearanceSettings }) {
  useLocale();
  const p = a.preferences;
  return (
    <Group
      title={t("Reading & space")}
      persistence={{ mode: "automatic" }}
      layout="full"
      description={t("Adjust contrast, diff highlights and conversation width.")}
    >
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
      description={t(
        "Try your fonts in the workspace above. Unavailable fonts fall back to your device’s default.",
      )}
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
    </Group>
  );
}
