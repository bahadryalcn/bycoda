import { Text } from "../../../shared/ui/Text";
import { t, useLocale } from "../../../shared/i18n";
import { saveShowRemainingUsage, useShowRemainingUsage } from "../../settings/model/displayPrefs";
import { settingDomId, Toggle } from "../../../shared/ui/settings";

/** Compact toolbar switch; keeps the settings-search anchor of the former row. */
export function UsageDisplaySettings() {
  useLocale();
  const showRemainingUsage = useShowRemainingUsage();
  return (
    <Text
      as="label"
      size="caption"
      tone="secondary"
      leading="inherit"
      id={settingDomId("show-remaining-usage")}
      data-setting-id="show-remaining-usage"
      className="usage-display-setting"
    >
      <span>{t("Show remaining usage")}</span>
      <Toggle
        label={t("Show remaining usage")}
        on={showRemainingUsage}
        onChange={saveShowRemainingUsage}
      />
    </Text>
  );
}
