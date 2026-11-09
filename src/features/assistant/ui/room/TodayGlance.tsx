import type { ReactNode } from "react";
import type {
  AssistantActivity,
  AssistantJob,
} from "../../../../shared/model/host-contracts/assistant";
import { formatDate, formatNumber, t } from "../../../../shared/i18n";
import { BarChart, DonutChart } from "../../../../shared/ui/Charts";
import { Button } from "../../../../shared/ui/Button";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { Surface } from "../../../../shared/ui/Surface";
import { statusLabel } from "./assistantRoomHelpers";
import {
  activityPerDay,
  assistantJobCounts,
  jobStatusCounts,
  updatesSince,
} from "./todayGlanceData";
import styles from "./TodayTab.module.css";

const CHART_HEIGHT = 120;

function Tile({ value, caption, onOpen }: { value: number; caption: string; onOpen?: () => void }) {
  const body = (
    <>
      <span className={styles.tileValue}>{value}</span>
      <span className={styles.tileCaption}>{caption}</span>
    </>
  );
  return (
    <Surface variant="outline" padding="none" className={styles.tile}>
      {onOpen ? (
        <Button variant="item" layout="stacked" align="start" onClick={onOpen}>
          {body}
        </Button>
      ) : (
        <div className={styles.tileBody}>{body}</div>
      )}
    </Surface>
  );
}

function ChartBlock({
  title,
  caption,
  children,
}: {
  title: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.chart}>
      <h3 className={styles.chartTitle}>{title}</h3>
      <p className={styles.muted}>{caption}</p>
      <div className={styles.chartBody}>{children}</div>
    </div>
  );
}

/**
 * "Today at a glance": stat tiles, a seven-day activity bar chart and a jobs-by-status donut.
 * `jobs` are the visible jobs; the activity feed is bounded, so the chart is titled "Recent activity".
 */
export function TodayGlance({
  jobs,
  activity,
  onOpenJobs,
  onOpenHistory,
}: {
  jobs: ReadonlyArray<AssistantJob>;
  activity: ReadonlyArray<AssistantActivity>;
  /** Opens the Jobs tab filtered to a status. */
  onOpenJobs?: (status: AssistantJob["status"]) => void;
  onOpenHistory?: () => void;
}) {
  const now = Date.now();
  const dayStart = new Date(now).setHours(0, 0, 0, 0);
  const counts = assistantJobCounts(jobs, dayStart);
  const days = activityPerDay(activity, now);
  const slices = jobStatusCounts(jobs);
  const hasActivity = days.some((day) => day.count > 0);
  const range = (at: number) => formatDate(at, { month: "short", day: "numeric" });
  return (
    <section className={styles.glance} aria-label={t("Today at a glance")}>
      <SectionLabel as="h2">{t("Today at a glance")}</SectionLabel>
      <div className={styles.tiles}>
        <Tile
          value={counts.waiting}
          caption={t("Waiting for you")}
          onOpen={onOpenJobs && (() => onOpenJobs("waiting"))}
        />
        {/* shortcut: the Jobs filter takes one status, so Working opens "running"; add multi-status filters if this misleads. */}
        <Tile
          value={counts.working}
          caption={t("Working")}
          onOpen={onOpenJobs && (() => onOpenJobs("running"))}
        />
        <Tile
          value={counts.doneToday}
          caption={t("Done today")}
          onOpen={onOpenJobs && (() => onOpenJobs("done"))}
        />
        <Tile
          value={updatesSince(activity, dayStart)}
          caption={t("Updates today")}
          onOpen={onOpenHistory}
        />
      </div>
      <div className={styles.charts}>
        <ChartBlock title={t("Recent activity")} caption={t("Last 7 days")}>
          {hasActivity ? (
            <BarChart
              label={t("Updates per day")}
              period={`${range(days[0]!.start)} – ${range(days[days.length - 1]!.start)}`}
              height={CHART_HEIGHT}
              formatValue={(value) => formatNumber(value, { maximumFractionDigits: 1 })}
              data={days.map((day) => ({
                key: day.key,
                label: formatDate(day.start, { weekday: "long", month: "short", day: "numeric" }),
                axisLabel: formatDate(day.start, { weekday: "short" }),
                value: day.count,
              }))}
            />
          ) : (
            <p className={styles.muted}>{t("No updates in the last 7 days")}</p>
          )}
        </ChartBlock>
        <ChartBlock title={t("Jobs by status")} caption={t("Jobs you can see")}>
          {slices.length ? (
            <DonutChart
              label={t("Jobs by status")}
              size={120}
              thickness={14}
              data={slices.map((slice) => ({
                key: slice.status,
                label: statusLabel(slice.status),
                value: slice.count,
              }))}
            />
          ) : (
            <p className={styles.muted}>{t("No jobs yet")}</p>
          )}
        </ChartBlock>
      </div>
    </section>
  );
}
