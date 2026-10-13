import { t, useLocale } from "../../../shared/i18n";
import { useGroupLock } from "../../group-lock/hooks/useGroupLock";
import { setStartInPrivacyMode } from "../../group-lock/model/groupLock";
import { Group, Row, Toggle } from "./settingsControls";
import { FileAccessSettings } from "./FileAccessSettings";

export function PrivacyStartupSettings() {
  useLocale();
  const privacy = useGroupLock();
  return (
    <>
      <FileAccessSettings />
      <Group title={t("Privacy")}>
        <Row
          id="start-in-privacy-mode"
          label={t("Start in privacy mode")}
          description={t(
            "Show a privacy screen before revealing your workspace. Applies on the next launch. Uses your lock password if one is set.",
          )}
        >
          <Toggle
            label={t("Start in privacy mode")}
            on={privacy.settings.startInPrivacyMode}
            onChange={setStartInPrivacyMode}
          />
        </Row>
      </Group>
    </>
  );
}
