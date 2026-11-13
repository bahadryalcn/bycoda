import { useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import {
  isAnonymousStatsEnabled,
  setAnonymousStatsEnabled,
  subscribeAnonymousStats,
} from "../../account";
import { DiagnosticsSharingSetting } from "../../diagnostics";
import {
  useGroupLock,
  setStartInPrivacyMode,
  PrivacyStorageError,
} from "../../group-lock/public/privacySettings";
import { Group, Row, Toggle, SettingsFeedback } from "./settingsControls";
import { saveMaskEmails, useMaskEmails, useMaskEmailsSaved } from "../model/displayPrefs";
import { FileAccessSettings } from "./FileAccessSettings";
import "../../group-lock/ui/GroupPrivacy.css";

/** This computer first: what is hidden or masked here, then what files agents may touch. */
export function PrivacyStartupSettings() {
  useLocale();
  const privacy = useGroupLock();
  const maskEmails = useMaskEmails();
  const maskSaved = useMaskEmailsSaved();
  const statsOn = useSyncExternalStore(subscribeAnonymousStats, isAnonymousStatsEnabled);
  // The choice applies now; the next-launch promise holds only once it is stored.
  const startSaved = !privacy.unsavedOptions?.includes("startInPrivacyMode");
  const saveStart = (on: boolean) => {
    setStartInPrivacyMode(on);
  };
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
            privacy.storageAvailable === false ? (
              <PrivacyStorageError />
            ) : startSaved ? undefined : (
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
            disabled={privacy.storageAvailable === false}
            onChange={saveStart}
          />
        </Row>
        <Row
          id="mask-emails"
          label={t("Mask account emails")}
          description={t(
            "Blur account emails in Settings and the usage popover until you click one, so they stay out of screenshots.",
          )}
          feedback={
            maskSaved ? undefined : (
              <SettingsFeedback
                state="error"
                action={<Button onClick={() => saveMaskEmails(maskEmails)}>{t("Retry")}</Button>}
              >
                {t(
                  "Applied in this window, but not saved. The next launch may use the previous choice.",
                )}
              </SettingsFeedback>
            )
          }
        >
          <Toggle label={t("Mask account emails")} on={maskEmails} onChange={saveMaskEmails} />
        </Row>
        <Row
          id="anonymous-statistics"
          label={t("Share anonymous usage statistics")}
          description={t(
            "Once a day bycoda sends the app version and operating system with a random install id. Never your sessions, prompts, code or file names. Off by default.",
          )}
        >
          <Toggle
            label={t("Share anonymous usage statistics")}
            on={statsOn}
            onChange={setAnonymousStatsEnabled}
          />
        </Row>
        <Row
          label={t("Share diagnostic logs")}
          description={t("Help us fix crashes by sending redacted app logs.")}
          stacked
        >
          <DiagnosticsSharingSetting />
        </Row>
      </Group>
      <FileAccessSettings />
    </>
  );
}
