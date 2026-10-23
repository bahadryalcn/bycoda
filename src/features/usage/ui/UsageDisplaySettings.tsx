import { t, useLocale } from "../../../shared/i18n";
import { saveShowRemainingUsage, useShowRemainingUsage } from "../../settings/model/displayPrefs";
import { Row, Toggle } from "../../settings/ui/settingsControls";

export function UsageDisplaySettings() {
  useLocale();
  const showRemainingUsage = useShowRemainingUsage();
  return (
    <Row
      id="show-remaining-usage"
      label={t("Show remaining usage")}
      description={t(
        "Fill usage meters with what is left in each limit instead of what has been used.",
      )}
    >
      <Toggle
        label={t("Show remaining usage")}
        on={showRemainingUsage}
        onChange={saveShowRemainingUsage}
      />
    </Row>
  );
}
