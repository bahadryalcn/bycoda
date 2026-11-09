import { useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Switch } from "../../../shared/ui/Switch";
import {
  isAnonymousStatsEnabled,
  setAnonymousStatsEnabled,
  subscribeAnonymousStats,
} from "../model/accountPrivacy";
import styles from "./account.module.css";

/** The statistics choice. It needs no account and is off until turned on. */
export function AccountPrivacy() {
  useLocale();
  const statsOn = useSyncExternalStore(subscribeAnonymousStats, isAnonymousStatsEnabled);
  return (
    <section className={styles.section} aria-labelledby="account-privacy">
      <SectionLabel labelId="account-privacy">{t("Statistics")}</SectionLabel>
      <Switch
        label={t("Share anonymous usage statistics")}
        description={t(
          "Once a day bycoda sends the app version and operating system with a random install id. Never your sessions, prompts, code or file names. Off by default.",
        )}
        checked={statsOn}
        onCheckedChange={setAnonymousStatsEnabled}
      />
    </section>
  );
}
