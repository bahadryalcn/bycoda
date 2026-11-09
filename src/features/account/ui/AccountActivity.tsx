import { t, useLocale } from "../../../shared/i18n";
import { formatDuration } from "../../../shared/i18n/format";
import { BarChart } from "../../../shared/ui/Charts";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { useActivitySummary } from "../hooks/useAccountData";
import styles from "./account.module.css";

const minutes = (value: number) => formatDuration(value * 60_000);

/** Active time summed over every device of the account, from the service. */
export function AccountActivity() {
  useLocale();
  const query = useActivitySummary();
  const summary = query.data;
  return (
    <section className={styles.section} aria-labelledby="account-activity">
      <SectionLabel labelId="account-activity">{t("Active time on all devices")}</SectionLabel>
      {query.isPending ? <LoadingText>{t("Loading active time…")}</LoadingText> : null}
      {query.isError ? (
        <InlineError retry={{ onRetry: () => query.refetch(), pending: query.isFetching }}>
          {t("Could not load your active time.")}
        </InlineError>
      ) : null}
      {summary ? (
        <>
          <DescriptionList columns={2} size="sm">
            <DescriptionItem term={t("Today")}>{minutes(summary.today)}</DescriptionItem>
            <DescriptionItem term={t("This week")}>{minutes(summary.week)}</DescriptionItem>
            <DescriptionItem term={t("This month")}>{minutes(summary.month)}</DescriptionItem>
            <DescriptionItem term={t("This year")}>{minutes(summary.year)}</DescriptionItem>
          </DescriptionList>
          <BarChart
            label={t("Active minutes")}
            period={t("Last 7 days")}
            unit={t("min")}
            height={96}
            data={summary.last7Days.map((day) => ({
              key: day.date,
              label: day.date,
              axisLabel: day.date.slice(8),
              value: day.minutes,
            }))}
          />
        </>
      ) : null}
    </section>
  );
}
