import { useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { DiagnosticsSharingSetting } from "../../diagnostics";
import { Group, Row, Toggle } from "../../settings/public/settingsControls";
import {
  isAnonymousStatsEnabled,
  setAnonymousStatsEnabled,
  subscribeAnonymousStats,
} from "../model/accountPrivacy";

/** The statistics and diagnostic-log choices of this computer. They need no account. */
export function AccountPrivacy() {
  useLocale();
  const statsOn = useSyncExternalStore(subscribeAnonymousStats, isAnonymousStatsEnabled);
  return (
    <Group
      title={t("This computer")}
      description={t("Choices stored on this computer only, signed in or not.")}
    >
      <Row
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
      <Row label={t("Diagnostic logs")} stacked>
        <DiagnosticsSharingSetting />
      </Row>
    </Group>
  );
}
