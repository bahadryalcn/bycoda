import { Tooltip } from "../../../shared/ui/Tooltip";
import { Text } from "../../../shared/ui/Text";
import { useId, useMemo, useState, type ReactNode } from "react";
import {
  ActivitySources,
  activityBars,
  formatActiveMinutes,
  localDay,
  useActivityOverview,
} from "../../activity";
import { formatDate, t, useLocale } from "../../../shared/i18n";
import { formatDuration } from "../../../shared/i18n/format";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { BarChart, DonutChart, type BarChartDatum } from "../../../shared/ui/Charts";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { RefreshCw } from "../../../shared/ui/icons";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { SortableDataTable } from "../../../shared/ui/SortableDataTable";
import { Surface } from "../../../shared/ui/Surface";
import { formatUsageCost } from "../../providers/public/providerUsage";
import { useTodayData } from "../hooks/useTodayData";
import type { TodayData, TodayPeriod, TodayTotals } from "../model/todayAggregate";
import { SummaryPanel } from "./TodaySummaryPanel";
import styles from "./today.module.css";

const cost = (totals: Pick<TodayTotals, "cost" | "unpricedTokens">) =>
  `${totals.unpricedTokens > 0 ? "≥ " : ""}${formatUsageCost(totals.cost)}`;
const runMinutes = (ms: number) => ms / 60_000;
/** Whole minutes for figures and charts; a run shorter than a minute keeps its seconds. */
const run = (ms: number) => (ms < 60_000 ? formatDuration(ms) : formatActiveMinutes(ms / 60_000));
const range = (from: Date, to: Date) =>
  `${formatDate(from, { month: "short", day: "numeric" })} - ${formatDate(to, { month: "short", day: "numeric", year: "numeric" })}`;

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Surface variant="outline" padding="md" className={styles.stat}>
      <Text size="caption" tone="secondary" leading="inherit">
        {label}
      </Text>
      <Text
        as="strong"
        size="title"
        tone="inherit"
        weight="medium"
        leading="tight"
        className={styles.statValue}
      >
        {value}
      </Text>
      {hint ? (
        <Text size="caption" tone="muted" leading="inherit">
          {hint}
        </Text>
      ) : null}
    </Surface>
  );
}

/**
 * Sessions touched, agent run time, active time and cost for today or this week on this computer:
 * figures, run time by project and by day, and the project table. "Summarize" is the only action
 * that leaves it, and only on click.
 */
export function TodayView() {
  const locale = useLocale();
  const titleId = useId();
  const [period, setPeriod] = useState<TodayPeriod>("today");
  const { data, pricing, loading, refreshing, failed, reload } = useTodayData(period);
  const overview = useActivityOverview();
  const { summary: activity, failed: activityFailed } = overview;
  const activeMinutes = activity ? (period === "today" ? activity.today : activity.week) : null;
  const activeStat = (
    <Stat
      label={t("Active time")}
      value={activeMinutes == null ? "—" : formatActiveMinutes(activeMinutes)}
      hint={
        activity
          ? t("This month {p0} · This year {p1}", {
              p0: formatActiveMinutes(activity.month),
              p1: formatActiveMinutes(activity.year),
            })
          : activityFailed
            ? t("Active time is unavailable right now.")
            : null
      }
    />
  );
  const empty =
    !!data && data.totals.sessions === 0 && data.totals.cost === 0 && data.totals.runMs === 0;
  return (
    <section aria-labelledby={titleId} className={styles.root}>
      <div className={styles.header}>
        <SectionLabel labelId={titleId}>{t("Activity")}</SectionLabel>
        <div className={styles.controls}>
          <SegmentedControl
            label={t("Period")}
            value={period}
            onValueChange={(value) => setPeriod(value as TodayPeriod)}
            options={[
              { value: "today", label: t("Today") },
              { value: "week", label: t("This week") },
            ]}
          />
          <Button
            variant="ghost"
            iconOnly
            label={t("Refresh")}
            loading={loading || refreshing}
            onClick={reload}
          >
            <RefreshCw aria-hidden className="icon-sm" strokeWidth={1.75} />
          </Button>
        </div>
      </div>
      {failed ? (
        <Alert tone="warning">
          {t("Some usage could not be read. Figures may be incomplete.")}
        </Alert>
      ) : null}
      {!data ? (
        <LoadingText>{t("Loading activity")}</LoadingText>
      ) : empty ? (
        <>
          <div className={styles.stats}>{activeStat}</div>
          <ActivitySources overview={overview} />
          <Surface variant="outline" padding="md" className={styles.chart}>
            <TodayBars bars={activity ? activityBars(activity) : null} />
          </Surface>
          <EmptyState
            title={t("No agent activity yet")}
            description={t("Sessions you run will show up here.")}
          />
        </>
      ) : (
        <>
          <div className={styles.stats}>
            <Stat label={t("Sessions")} value={data.totals.sessions} />
            <Stat label={t("Agent run time")} value={run(data.totals.runMs)} />
            {activeStat}
            <Stat
              label={t("Cost")}
              value={cost(data.totals)}
              hint={t("API-equivalent, not billed")}
            />
          </div>
          <ActivitySources overview={overview} />
          <TodayCharts data={data} activity={activity ? activityBars(activity) : null} />
          <ProjectTable data={data} />
          <div className={styles.summary}>
            <SummaryPanel
              key={`${period}:${locale}`}
              data={data}
              pricing={pricing}
              activeMinutes={activeMinutes}
              language={locale}
            />
          </div>
        </>
      )}
    </section>
  );
}

/** The aggregate emits "Unknown folder" as an English constant; real project names pass through. */
const todayLabel = (label: string) => (label === "Unknown folder" ? t("Unknown folder") : label);

/** Run time by project as a ring; run time by day (week) or active minutes of the last 7 days. */
function TodayCharts({ data, activity }: { data: TodayData; activity: BarChartDatum[] | null }) {
  const projects = data.projects
    .filter((project) => project.runMs > 0)
    .map((project) => ({
      key: project.key,
      label: todayLabel(project.label),
      value: project.runMs,
    }));
  const days = useMemo(
    () =>
      data.days.map((day) => ({
        key: day.key,
        label: formatDate(new Date(day.start), { weekday: "long", month: "short", day: "numeric" }),
        axisLabel: formatDate(new Date(day.start), { weekday: "narrow" }),
        value: runMinutes(day.runMs),
      })),
    [data.days],
  );
  const week = data.period === "week";
  const bars = week ? days : activity;
  return (
    <div className={styles.charts}>
      <Surface variant="outline" padding="md" className={styles.chart}>
        <SectionLabel>{t("Agent run time by project")}</SectionLabel>
        {projects.length ? (
          <DonutChart
            data={projects}
            label={t("Agent run time by project")}
            formatValue={run}
            totalLabel={t("Total")}
            size={148}
            maxSegments={6}
          />
        ) : (
          <EmptyState size="inline" description={t("No recorded run time")} />
        )}
      </Surface>
      <Surface variant="outline" padding="md" className={styles.chart}>
        <TodayBars
          bars={bars}
          agentPeriod={
            week ? range(new Date(data.window.start), new Date(data.window.end)) : undefined
          }
        />
      </Surface>
    </div>
  );
}

/** Keep the active-time history visible even before this computer has agent runs. */
function TodayBars({ bars, agentPeriod }: { bars: BarChartDatum[] | null; agentPeriod?: string }) {
  return (
    <>
      <SectionLabel>
        {agentPeriod ? t("Agent run time by day") : t("Active time, last 7 days")}
      </SectionLabel>
      {bars?.length ? (
        <BarChart
          data={bars}
          label={agentPeriod ? t("Agent run time by day") : t("Active minutes")}
          period={
            agentPeriod ?? range(localDay(bars[0]!.key), localDay(bars[bars.length - 1]!.key))
          }
          formatValue={formatActiveMinutes}
          height={120}
        />
      ) : (
        <LoadingText>{t("Loading active time")}</LoadingText>
      )}
    </>
  );
}

/** One sortable row per project: sessions, run time and cost. Empty figures read "—". */
function ProjectTable({ data }: { data: TodayData }) {
  const rows = data.projects.map((project) => ({ ...project }));
  return (
    <SortableDataTable
      caption={t("By project")}
      rowKey="key"
      rows={rows}
      defaultSort={{ key: "runMs", direction: "desc" }}
      columns={[
        {
          key: "label",
          label: t("Project"),
          sortable: true,
          render: (_, row) => (
            <Tooltip label={row.path || todayLabel(row.label)} asChild>
              <span>{todayLabel(row.label)}</span>
            </Tooltip>
          ),
        },
        {
          key: "sessions",
          label: t("Sessions"),
          sortable: true,
          numeric: true,
          hideBelow: "sm",
          render: (value) => (Number(value) ? String(value) : "—"),
        },
        {
          key: "runMs",
          label: t("Agent run time"),
          sortable: true,
          numeric: true,
          render: (value) => (Number(value) ? run(Number(value)) : "—"),
        },
        {
          key: "cost",
          label: t("Cost"),
          sortable: true,
          numeric: true,
          render: (_, row) => cost(row),
        },
      ]}
    />
  );
}
