import { t, useLocale } from "../../../shared/i18n";
import { useGroupLock } from "../../group-lock/hooks/useGroupLock";
import { setStartInPrivacyMode } from "../../group-lock/model/groupLock";
import { Group, Row, Toggle } from "./settingsControls";
import { saveMaskEmails, useMaskEmails } from "../model/displayPrefs";
import { FileAccessSettings } from "./FileAccessSettings";

export function PrivacyStartupSettings() {
  useLocale();
  const privacy = useGroupLock();
  const maskEmails = useMaskEmails();
  return (
    <Group title={t("Privacy")}>
      <Row
        id="start-in-privacy-mode"
        label={t("Start in privacy mode")}
        description={t("Hide your workspace on the next launch.")}
      >
        <Toggle
          label={t("Start in privacy mode")}
          on={privacy.settings.startInPrivacyMode}
          onChange={setStartInPrivacyMode}
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
      <FileAccessSettings embedded />
    </Group>
  );
}
