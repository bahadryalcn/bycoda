import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { useGroupLock } from "../../group-lock/hooks/useGroupLock";
import { setStartInPrivacyMode } from "../../group-lock/model/groupLock";
import { Group, Row, Toggle, SettingsFeedback } from "./settingsControls";
import { saveMaskEmails, useMaskEmails } from "../model/displayPrefs";
import { FileAccessSettings } from "./FileAccessSettings";
import "../../group-lock/ui/GroupPrivacy.css";

/** This computer first: what is hidden or masked here, then what files agents may touch. */
export function PrivacyStartupSettings() {
  useLocale();
  const privacy = useGroupLock();
  const maskEmails = useMaskEmails();
  // The choice applies now; the next-launch promise holds only once it is stored.
  const [startSaved, setStartSaved] = useState(true);
  const saveStart = (on: boolean) => setStartSaved(setStartInPrivacyMode(on));
  return (
    <>
      <Group
        title={t("Privacy")}
        scope={t("Applies to this computer.")}
        description={
          t("Privacy controls affect what appears in ") +
          PRODUCT_IDENTITY.displayName +
          t(". Project files and transcripts on disk are not encrypted.")
        }
      >
        <Row
          id="start-in-privacy-mode"
          label={t("Start in privacy mode")}
          description={t("Hide your workspace on the next launch.")}
          feedback={
            startSaved ? undefined : (
              <SettingsFeedback
                state="error"
                action={
                  <Button onClick={() => saveStart(privacy.settings.startInPrivacyMode)}>
                    {t("Retry")}
                  </Button>
                }
              >
                {t(
                  "Applied in this window, but not saved. The next launch may not start in privacy mode.",
                )}
              </SettingsFeedback>
            )
          }
        >
          <Toggle
            label={t("Start in privacy mode")}
            on={privacy.settings.startInPrivacyMode}
            onChange={saveStart}
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
      <FileAccessSettings />
    </>
  );
}
