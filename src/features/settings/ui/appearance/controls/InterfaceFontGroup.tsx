import { t, useLocale } from "../../../../../shared/i18n";
import { NumberField } from "../../../../../shared/ui/NumberField";
import { INTERFACE_FONT_CATALOG } from "../../../model/fontCatalog";
import { APPEARANCE_DEFAULTS } from "../../../model/appearancePreferences";
import { Group, Row } from "../../settingsControls";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import { FontPicker } from "./FontPicker";

export const SAMPLE_SIZE_MIN = 10;
export const SAMPLE_SIZE_MAX = 20;

/** Interface font picker. The size stepper only resizes the live preview's text sample. */
export function InterfaceFontGroup({
  appearance: a,
  sampleSize,
  onSampleSize,
}: {
  appearance: AppearanceSettings;
  sampleSize: number;
  onSampleSize: (size: number) => void;
}) {
  useLocale();
  const p = a.preferences;
  return (
    <Group
      id="interface-font"
      title={t("Interface font")}
      modified={p.interfaceFont !== APPEARANCE_DEFAULTS.interfaceFont}
      onReset={() =>
        a.onPreferences({
          ...p,
          interfaceFont: APPEARANCE_DEFAULTS.interfaceFont,
        })
      }
      resetLabel={t("Reset interface font")}
    >
      <Row label={t("Interface font")}>
        <FontPicker
          label={t("Interface font")}
          catalog={INTERFACE_FONT_CATALOG}
          value={p.interfaceFont}
          onChange={(interfaceFont) => a.onPreferences({ ...p, interfaceFont })}
        />
      </Row>
      <Row
        label={t("Sample size")}
        info={t(
          "Resizes only the preview. The app's text size is Interface scale in the Interface tab.",
        )}
      >
        <NumberField
          label={t("Sample size")}
          hideLabel
          min={SAMPLE_SIZE_MIN}
          max={SAMPLE_SIZE_MAX}
          step={1}
          value={sampleSize}
          onChange={(event) => {
            if (event.currentTarget.validity.valid && event.currentTarget.value !== "")
              onSampleSize(event.currentTarget.valueAsNumber);
          }}
        />
      </Row>
    </Group>
  );
}
