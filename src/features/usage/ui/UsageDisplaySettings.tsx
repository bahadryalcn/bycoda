import { t, useLocale } from "../../../shared/i18n";
import {
  saveMaskEmails,
  saveShowRemainingUsage,
  useMaskEmails,
  useShowRemainingUsage,
} from "../../settings/model/displayPrefs";
import { Group, Row, Toggle } from "../../settings/ui/settingsControls";

export function UsageDisplaySettings() {
  useLocale();
  const showRemainingUsage = useShowRemainingUsage();
  const maskEmails = useMaskEmails();
  return (
    <Group title={t("Usage and privacy")}>
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
      <Row
        id="mask-emails"
        label={t("Mask account emails")}
        description={t(
          "Blur account emails in Settings and the usage popover until you click one, so they stay out of screenshots.",
        )}
      >
        <Toggle label={t("Mask account emails")} on={maskEmails} onChange={saveMaskEmails} />
      </Row>
    </Group>
  );
}
