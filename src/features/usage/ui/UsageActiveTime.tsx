import { Text } from "../../../shared/ui/Text";
import { formatActiveMinutes, useActivityOverview } from "../../activity";
import { t, useLocale } from "../../../shared/i18n";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { SectionLabel } from "../../../shared/ui/SectionLabel";

/** Active time (today, week, month, year) over this computer and its connected machines (all devices when signed in). */
export function UsageActiveTime() {
  useLocale();
  const overview = useActivityOverview();
  const summary = overview.summary;
  const value = (minutes: number | undefined) =>
    minutes == null ? "—" : formatActiveMinutes(minutes);
  return (
    <section className="usage-active-time" aria-label={t("Active time")}>
      <SectionLabel>{t("Active time")}</SectionLabel>
      <DescriptionList columns="auto" size="sm" className="usage-active-metrics">
        <DescriptionItem term={t("Today")}>{value(summary?.today)}</DescriptionItem>
        <DescriptionItem term={t("This week")}>{value(summary?.week)}</DescriptionItem>
        <DescriptionItem term={t("This month")}>{value(summary?.month)}</DescriptionItem>
        <DescriptionItem term={t("This year")}>{value(summary?.year)}</DescriptionItem>
      </DescriptionList>
      {overview.failed && !summary ? (
        <Text as="p" size="secondary" tone="muted">
          {t("Active time is unavailable right now.")}
        </Text>
      ) : null}
    </section>
  );
}
