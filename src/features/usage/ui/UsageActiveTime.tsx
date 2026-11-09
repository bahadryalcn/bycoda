import { ActivitySources, formatActiveMinutes, useActivityOverview } from "../../activity";
import { t, useLocale } from "../../../shared/i18n";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Surface } from "../../../shared/ui/Surface";

/** Active time (today, week, month, year) with its source scope: this machine, connected machines or all devices. */
export function UsageActiveTime() {
  useLocale();
  const overview = useActivityOverview();
  const summary = overview.summary;
  const value = (minutes: number | undefined) =>
    minutes == null ? "—" : formatActiveMinutes(minutes);
  return (
    <Surface variant="outline" padding="md" className="grid min-w-0 gap-3">
      <SectionLabel>{t("Active time")}</SectionLabel>
      <DescriptionList columns={2} size="sm">
        <DescriptionItem term={t("Today")}>{value(summary?.today)}</DescriptionItem>
        <DescriptionItem term={t("This week")}>{value(summary?.week)}</DescriptionItem>
        <DescriptionItem term={t("This month")}>{value(summary?.month)}</DescriptionItem>
        <DescriptionItem term={t("This year")}>{value(summary?.year)}</DescriptionItem>
      </DescriptionList>
      {overview.failed && !summary ? (
        <p className="text-ui-secondary text-(--ui-text-muted)">
          {t("Active time is unavailable right now.")}
        </p>
      ) : null}
      <ActivitySources overview={overview} />
    </Surface>
  );
}
