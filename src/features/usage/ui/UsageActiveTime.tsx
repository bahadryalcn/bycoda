import {
  ActivitySources,
  activitySourceNote,
  formatActiveMinutes,
  useActivityOverview,
} from "../../activity";
import { t, useLocale } from "../../../shared/i18n";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Surface } from "../../../shared/ui/Surface";
import { InfoPopover } from "../../../shared/ui/InfoPopover";

/** Active time (today, week, month, year) with its source scope: this machine, connected machines or all devices. */
export function UsageActiveTime() {
  useLocale();
  const overview = useActivityOverview();
  const summary = overview.summary;
  const value = (minutes: number | undefined) =>
    minutes == null ? "—" : formatActiveMinutes(minutes);
  return (
    <Surface variant="outline" padding="sm" className="usage-active-time">
      <div className="usage-active-heading">
        <SectionLabel>{t("Active time")}</SectionLabel>
        <span className="usage-active-source">{activitySourceNote(overview)}</span>
        <InfoPopover label={t("Active time source")}>
          <ActivitySources overview={overview} />
        </InfoPopover>
      </div>
      <DescriptionList columns="auto" size="sm" className="usage-active-metrics">
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
    </Surface>
  );
}
