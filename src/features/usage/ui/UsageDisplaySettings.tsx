import { actionHostAttributes } from "../../../shared/ui/ActionHost";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { t, useLocale } from "../../../shared/i18n";
import { saveShowRemainingUsage, useShowRemainingUsage } from "../../settings/model/displayPrefs";
import { settingDomId, Toggle } from "../../../shared/ui/settings";

/** Compact toolbar switch; keeps the settings-search anchor of the former row. */
export function UsageDisplaySettings() {
  useLocale();
  const showRemainingUsage = useShowRemainingUsage();
  const appearance = surfaceAttributes({ radius: "none" }, "usage-display-toggle");
  return (
    <div className="flex items-center gap-1">
      <Text
        as="div"
        size="caption"
        tone="secondary"
        leading="inherit"
        id={settingDomId("show-remaining-usage")}
        data-setting-id="show-remaining-usage"
        {...appearance}
        {...actionHostAttributes(
          { pressFeedback: false, size: "caption", tone: "secondary" },
          appearance.className,
        )}
      >
        <span>{t("Show remaining usage")}</span>
        <Toggle
          label={t("Show remaining usage")}
          on={showRemainingUsage}
          onChange={saveShowRemainingUsage}
        />
      </Text>
      <InfoPopover label={t("About remaining usage")}>
        <p>
          {t("Fill usage meters with what is left in each limit instead of what has been used.")}
        </p>
      </InfoPopover>
    </div>
  );
}
