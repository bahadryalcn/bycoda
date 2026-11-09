import { t, useLocale } from "../../../../../shared/i18n";
import { NumberField } from "../../../../../shared/ui/NumberField";
import { CODE_FONT_CATALOG, fontFamilyValue } from "../../../model/fontCatalog";
import { APPEARANCE_DEFAULTS } from "../../../model/appearancePreferences";
import { Group, Row, Segmented } from "../../settingsControls";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import { FontPicker } from "./FontPicker";

const SAME_AS_CODE = "__same-as-code";
/** The terminal-only list: "System" is the same-as-code choice, so it is not offered twice. */
const TERMINAL_FONT_CATALOG = CODE_FONT_CATALOG.filter((font) => font.id !== "System");

/** Terminal weights offered as Light / Regular / Bold; saved values snap to the nearest one. */
function terminalWeightChoice(weight: number): "300" | "400" | "700" {
  if (weight <= 350) return "300";
  if (weight <= 550) return "400";
  return "700";
}

/** Terminal font picker (first choice: same as the code font), size, weight and line spacing. */
export function TerminalFontGroup({ appearance: a }: { appearance: AppearanceSettings }) {
  useLocale();
  const p = a.preferences;
  const d = APPEARANCE_DEFAULTS;
  const same =
    p.terminalFontSource !== "custom" || !p.terminalFont.trim() || p.terminalFont === "System";
  const modified =
    p.terminalFontSource !== d.terminalFontSource ||
    p.terminalFont !== d.terminalFont ||
    p.terminalSize !== d.terminalSize ||
    p.terminalWeight !== d.terminalWeight ||
    p.terminalLineHeight !== d.terminalLineHeight;
  return (
    <Group
      title={t("Terminal")}
      modified={modified}
      onReset={() =>
        a.onPreferences({
          ...p,
          terminalFontSource: d.terminalFontSource,
          terminalFont: d.terminalFont,
          terminalSize: d.terminalSize,
          terminalWeight: d.terminalWeight,
          terminalLineHeight: d.terminalLineHeight,
        })
      }
      resetLabel={t("Reset terminal")}
    >
      <Row
        id="terminal-font"
        label={t("Terminal font")}
        modified={
          p.terminalFontSource !== d.terminalFontSource || p.terminalFont !== d.terminalFont
        }
        onReset={() =>
          a.onPreferences({
            ...p,
            terminalFontSource: d.terminalFontSource,
            terminalFont: d.terminalFont,
          })
        }
      >
        <FontPicker
          label={t("Terminal font")}
          catalog={TERMINAL_FONT_CATALOG}
          value={same ? SAME_AS_CODE : p.terminalFont}
          monospace
          leading={{
            value: SAME_AS_CODE,
            label: t("Same as code font"),
            family: fontFamilyValue(CODE_FONT_CATALOG, p.codeFont),
          }}
          onChange={(choice) =>
            a.onPreferences(
              choice === SAME_AS_CODE
                ? { ...p, terminalFontSource: "code" }
                : { ...p, terminalFontSource: "custom", terminalFont: choice },
            )
          }
        />
      </Row>
      <Row
        id="terminal-font-size"
        label={t("Terminal font size")}
        modified={p.terminalSize !== d.terminalSize}
        onReset={() => a.onPreferences({ ...p, terminalSize: d.terminalSize })}
      >
        <NumberField
          label={t("Terminal font size")}
          hideLabel
          min={8}
          max={40}
          step={1}
          value={p.terminalSize}
          onChange={(event) => {
            if (event.currentTarget.validity.valid && event.currentTarget.value !== "")
              a.onPreferences({
                ...p,
                terminalSize: event.currentTarget.valueAsNumber,
              });
          }}
        />
      </Row>
      <Row
        id="terminal-font-weight"
        label={t("Terminal font weight")}
        modified={p.terminalWeight !== d.terminalWeight}
        onReset={() => a.onPreferences({ ...p, terminalWeight: d.terminalWeight })}
      >
        <Segmented
          label={t("Terminal font weight")}
          value={terminalWeightChoice(p.terminalWeight)}
          options={[
            { value: "300", label: t("Light") },
            { value: "400", label: t("Regular") },
            { value: "700", label: t("Bold") },
          ]}
          onChange={(value) => a.onPreferences({ ...p, terminalWeight: Number(value) })}
        />
      </Row>
      <Row
        id="terminal-line-height"
        label={t("Terminal line spacing")}
        modified={p.terminalLineHeight !== d.terminalLineHeight}
        onReset={() => a.onPreferences({ ...p, terminalLineHeight: d.terminalLineHeight })}
      >
        <Segmented
          label={t("Terminal line spacing")}
          value={String(p.terminalLineHeight)}
          options={[1, 1.15, 1.35, 1.5].map((value) => ({
            value: String(value),
            label: `${value}×`,
          }))}
          onChange={(value) => a.onPreferences({ ...p, terminalLineHeight: Number(value) })}
        />
      </Row>
    </Group>
  );
}
