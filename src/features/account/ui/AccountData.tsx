import { useState } from "react";
import { openExternal } from "../../../platform/tauri/openExternal";
import { t, useLocale } from "../../../shared/i18n";
import { formatDays, formatDuration } from "../../../shared/i18n/format";
import { Button } from "../../../shared/ui/Button";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { useDataSummary } from "../hooks/useAccountData";
import { exportDataUrl } from "../model/accountPortal";
import { AccountPrivacy } from "./AccountPrivacy";
import styles from "./account.module.css";

/** What bycoda stores about the account, the anonymous statistics choice and the data export. */
export function AccountData() {
  useLocale();
  const query = useDataSummary();
  const summary = query.data;
  const [openFailed, setOpenFailed] = useState(false);
  const url = exportDataUrl();
  return (
    <>
      <section className={styles.section} aria-labelledby="account-data">
        <SectionLabel labelId="account-data">{t("Your data")}</SectionLabel>
        {query.isPending ? <LoadingText>{t("Loading your data summary…")}</LoadingText> : null}
        {query.isError ? (
          <InlineError retry={{ onRetry: () => query.refetch(), pending: query.isFetching }}>
            {t("Could not load your data summary.")}
          </InlineError>
        ) : null}
        {summary ? (
          <DescriptionList columns={2} size="sm">
            <DescriptionItem term={t("Devices")}>
              {t("{p0} active, {p1} signed out", {
                p0: summary.devices.active,
                p1: summary.devices.revoked,
              })}
            </DescriptionItem>
            <DescriptionItem term={t("Active time")}>
              {t("{p0}, {p1} in total", {
                p0: formatDays(summary.activity.days),
                p1: formatDuration(summary.activity.totalMinutes * 60_000),
              })}
            </DescriptionItem>
            <DescriptionItem term={t("Notifications")}>
              {summary.notifications.feedItems}
            </DescriptionItem>
            <DescriptionItem term={t("Support requests")}>
              {summary.support.tickets}
            </DescriptionItem>
            <DescriptionItem term={t("Ready exports")}>{summary.exports.ready}</DescriptionItem>
          </DescriptionList>
        ) : null}
        <p className={styles.lead}>
          {t("bycoda never stores your sessions, prompts, code, file names or project names.")}
        </p>
        {url ? (
          <div className={styles.actions}>
            <Button
              variant="secondary"
              onClick={() => {
                setOpenFailed(false);
                openExternal(url).catch(() => setOpenFailed(true));
              }}
            >
              {t("Export your data…")}
            </Button>
            <span className={styles.meta}>{t("Opens your account page in the browser.")}</span>
          </div>
        ) : null}
        {url && openFailed ? (
          <InlineError>{t("Could not open your browser. Go to {p0}.", { p0: url })}</InlineError>
        ) : null}
      </section>
      <AccountPrivacy />
    </>
  );
}
