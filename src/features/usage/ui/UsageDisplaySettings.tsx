import { Tooltip } from "../../../shared/ui/Tooltip";
import { Text } from "../../../shared/ui/Text";
import { t, useLocale } from "../../../shared/i18n";
import { saveShowRemainingUsage, useShowRemainingUsage } from "../../settings/model/displayPrefs";
import { settingDomId, Toggle } from "../../settings/ui/settingsControls";

/** Compact toolbar switch; keeps the settings-search anchor of the former row. */
export function UsageDisplaySettings() {
  useLocale();
  const showRemainingUsage = useShowRemainingUsage();
  return (
    <Tooltip
      label={t("Fill usage meters with what is left in each limit instead of what has been used.")}
      asChild
    >
      <Text
        as="div"
        size="caption"
        tone="secondary"
        leading="inherit"
        id={settingDomId("show-remaining-usage")}
        data-setting-id="show-remaining-usage"
        className="usage-display-toggle"
      >
        <span>{t("Show remaining usage")}</span>
        <Toggle
          label={t("Show remaining usage")}
          on={showRemainingUsage}
          onChange={saveShowRemainingUsage}
        />
      </Text>
    </Tooltip>
  );
}
