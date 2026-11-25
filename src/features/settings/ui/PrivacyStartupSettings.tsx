import { useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { DIAGNOSTIC_RETENTION_DAYS } from "@bycoda/account-contracts";
import {
  AnonymousUsageSetting,
  getStatisticsMode,
  setStatisticsMode,
  statsDisclosure,
  subscribeStatisticsMode,
} from "../../account";
import {
  ActivitySharingSetting,
  SharingModeSelect,
  SharingNoticeSetting,
} from "../../data-sharing";
import { DiagnosticsSharingSetting } from "../../diagnostics";
import {
  useGroupLock,
  setStartInPrivacyMode,
  PrivacyStorageError,
} from "../../group-lock/public/privacySettings";
import { Group, Row, Toggle, SettingsFeedback } from "../../../shared/ui/settings";
import { saveMaskEmails, useMaskEmails, useMaskEmailsSaved } from "../model/displayPrefs";
import { FileAccessSettings } from "./FileAccessSettings";
import "../../group-lock/ui/GroupPrivacy.css";

/** This computer first: what is hidden or masked here, then what files agents may touch. */
export function PrivacyStartupSettings() {
  useLocale();
  const privacy = useGroupLock();
  const maskEmails = useMaskEmails();
  const maskSaved = useMaskEmailsSaved();
  const statisticsMode = useSyncExternalStore(subscribeStatisticsMode, getStatisticsMode);
  // The choice applies now; the next-launch promise holds only once it is stored.
  const startSaved = !privacy.unsavedOptions?.includes("startInPrivacyMode");
  const saveStart = (on: boolean) => {
    setStartInPrivacyMode(on);
  };
  return (
    <>
      <Group title={t("Privacy")}>
        <Row
          id="start-in-privacy-mode"
          label={t("Start in privacy mode")}
          feedback={
            privacy.storageAvailable === false ? (
              <PrivacyStorageError />
            ) : startSaved ? undefined : (
              <SettingsFeedback
                state="error"
                action={{
                  label: t("Retry"),
                  onClick: () => saveStart(privacy.settings.startInPrivacyMode),
                }}
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
                action={{ label: t("Retry"), onClick: () => saveMaskEmails(maskEmails) }}
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
          description={statsDisclosure()}
        >
          <SharingModeSelect
            label={t("Share anonymous usage statistics")}
            value={statisticsMode}
            change={setStatisticsMode}
          />
        </Row>
        <AnonymousUsageSetting />
        <ActivitySharingSetting />
        <SharingNoticeSetting />
        <Row
          label={t("Share diagnostic logs")}
          description={t(
            "Diagnostic logs are the app and Host logs, with secrets, e-mail addresses and your user name removed on this computer. They never include your conversations, prompts or code. They are kept {p0} days.",
            { p0: DIAGNOSTIC_RETENTION_DAYS },
          )}
        >
          <DiagnosticsSharingSetting />
        </Row>
      </Group>
      <FileAccessSettings />
    </>
  );
}
