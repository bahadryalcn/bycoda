import { t, useLocale } from "../../../../../shared/i18n";
import { INTERFACE_FONT_CATALOG } from "../../../model/fontCatalog";
import { APPEARANCE_DEFAULTS } from "../../../model/appearancePreferences";
import { Group, Row } from "../../../../../shared/ui/settings";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import { FontPicker } from "./FontPicker";

/** Interface font picker; the specimen in the live preview shows the result. */
export function InterfaceFontGroup({ appearance: a }: { appearance: AppearanceSettings }) {
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
      <Row label={t("Font")}>
        <FontPicker
          label={t("Interface font")}
          catalog={INTERFACE_FONT_CATALOG}
          value={p.interfaceFont}
          onChange={(interfaceFont) => a.onPreferences({ ...p, interfaceFont })}
        />
      </Row>
    </Group>
  );
}
