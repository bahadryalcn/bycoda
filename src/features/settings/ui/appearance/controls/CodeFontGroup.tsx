import { t, useLocale } from "../../../../../shared/i18n";
import { NumberField } from "../../../../../shared/ui/NumberField";
import { CODE_FONT_CATALOG } from "../../../model/fontCatalog";
import { APPEARANCE_DEFAULTS } from "../../../model/appearancePreferences";
import { RadioTiles } from "../../RadioTiles";
import { Group, Row, Toggle } from "../../settingsControls";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import { FontPicker } from "./FontPicker";
import "./TypographySamples.css";

const CODE_THEMES = [
  { value: "github", label: "GitHub Dark default", swatch: "github" },
  { value: "dracula", label: "Dracula", swatch: "dracula" },
] as const;

/** Code font picker, size, ligatures and code theme. The sample lives in the live preview. */
export function CodeFontGroup({ appearance: a }: { appearance: AppearanceSettings }) {
  useLocale();
  const p = a.preferences;
  const d = APPEARANCE_DEFAULTS;
  return (
    <Group
      id="monospace-font"
      title={t("Code font")}
      modified={p.codeFont !== d.codeFont || p.codeSize !== d.codeSize}
      onReset={() => a.onPreferences({ ...p, codeFont: d.codeFont, codeSize: d.codeSize })}
      resetLabel={t("Reset code font")}
    >
      <Row label={t("Code font")}>
        <FontPicker
          label={t("Code font")}
          catalog={CODE_FONT_CATALOG}
          value={p.codeFont}
          monospace
          onChange={(codeFont) => a.onPreferences({ ...p, codeFont })}
        />
      </Row>
      <Row
        id="code-font-size"
        label={t("Code font size")}
        modified={p.codeSize !== d.codeSize}
        onReset={() => a.onPreferences({ ...p, codeSize: d.codeSize })}
      >
        <NumberField
          label={t("Code font size")}
          hideLabel
          min={11}
          max={18}
          step={1}
          value={p.codeSize}
          onChange={(event) => {
            if (event.currentTarget.validity.valid && event.currentTarget.value !== "")
              a.onPreferences({
                ...p,
                codeSize: event.currentTarget.valueAsNumber,
              });
          }}
        />
      </Row>
      <Row
        id="code-ligatures"
        label={t("Ligatures")}
        description={t("Join sequences such as => and != into single glyphs in code and editors.")}
        modified={p.codeLigatures !== d.codeLigatures}
        onReset={() => a.onPreferences({ ...p, codeLigatures: d.codeLigatures })}
      >
        <Toggle
          label={t("Ligatures")}
          on={p.codeLigatures}
          onChange={(codeLigatures) => a.onPreferences({ ...p, codeLigatures })}
        />
      </Row>
      <Row
        id="code-theme"
        label={t("Code theme")}
        stacked
        modified={p.codeTheme !== d.codeTheme}
        onReset={() => a.onPreferences({ ...p, codeTheme: d.codeTheme })}
      >
        <RadioTiles
          label={t("Code theme")}
          className="code-theme-chips"
          tileClassName="code-theme-chip"
          value={p.codeTheme}
          onChange={(codeTheme) => a.onPreferences({ ...p, codeTheme })}
          options={CODE_THEMES.map((theme) => ({
            value: theme.value,
            children: (
              <>
                <span className="code-theme-swatch" data-swatch={theme.swatch} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                {theme.label}
              </>
            ),
          }))}
        />
      </Row>
    </Group>
  );
}
