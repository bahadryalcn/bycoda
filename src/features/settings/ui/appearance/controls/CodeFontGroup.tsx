import { t, useLocale } from "../../../../../shared/i18n";
import { NumberField } from "../../../../../shared/ui/NumberField";
import { CODE_FONT_CATALOG } from "../../../model/fontCatalog";
import { APPEARANCE_DEFAULTS } from "../../../model/appearancePreferences";
import { Group, Row, Segmented, Toggle } from "../../../../../shared/ui/settings";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import { FontPicker } from "./FontPicker";
import { useNumberDraft } from "./useNumberDraft";

/** Code font picker, size, ligatures and code theme. The sample lives in the live preview. */
export function CodeFontGroup({ appearance: a }: { appearance: AppearanceSettings }) {
  useLocale();
  const p = a.preferences;
  const d = APPEARANCE_DEFAULTS;
  const codeSize = useNumberDraft(p.codeSize, (size) => a.onPreferences({ ...p, codeSize: size }));
  return (
    <Group
      id="monospace-font"
      title={t("Code font")}
      modified={p.codeFont !== d.codeFont || p.codeSize !== d.codeSize}
      onReset={() => a.onPreferences({ ...p, codeFont: d.codeFont, codeSize: d.codeSize })}
      resetLabel={t("Reset code font")}
    >
      <Row label={t("Font")}>
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
          {...codeSize}
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
        modified={p.codeTheme !== d.codeTheme}
        onReset={() => a.onPreferences({ ...p, codeTheme: d.codeTheme })}
      >
        <Segmented<"github" | "dracula">
          label={t("Code theme")}
          value={p.codeTheme}
          onChange={(codeTheme) => a.onPreferences({ ...p, codeTheme })}
          options={[
            { value: "github", label: t("GitHub") },
            { value: "dracula", label: t("Dracula") },
          ]}
        />
      </Row>
    </Group>
  );
}
