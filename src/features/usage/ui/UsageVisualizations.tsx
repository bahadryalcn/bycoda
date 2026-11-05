import { useMemo, useState } from "react";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ActivityHeatmap, BarChart, DonutChart, LineChart } from "../../../shared/ui/Charts";
import { ChevronLeft, ChevronRight } from "../../../shared/ui/icons";
import { Select } from "../../../shared/ui/Select";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { BadgeList } from "../../../shared/ui/BadgeList";
import {
  bucketStart,
  effectiveResolution,
  usageBuckets,
  usageTotals,
  type UsageBucket,
  type UsageBreakdown,
  type UsageMetric,
  type UsageResolution,
  type UsageSample,
  type UsageWindow,
} from "../model/usageAnalytics";
import { usageChartColor } from "../model/usageColors";
import {
  formatBucket,
  formatMetric,
  formatMetricTick,
  formatUsagePercent,
  metricNames,
  ContinuousUsageTable,
} from "./UsageCharts";

type Colors = ReadonlyMap<string, string>;
export function UsageTrend({
  buckets,
  series,
  metric,
  resolution,
  percent,
  onSelect,
  colors,
}: {
  buckets: UsageBucket[];
  series: UsageBreakdown[];
  metric: UsageMetric;
  resolution: UsageResolution;
  percent: boolean;
  onSelect: (window: UsageWindow) => void;
  colors: Colors;
}) {
  useLocale();
  const [active, setActive] = useState<string | null>(null);
  const [singleSeries, setSingleSeries] = useState<ReadonlySet<string> | null>(null);
  const point = buckets.find((bucket) => bucket.key === active);
  const format = (value: number) =>
    percent ? formatUsagePercent(value) : formatMetric(value, metric);
  const data = useMemo(
    () =>
      buckets.map((bucket, index) => ({
        key: bucket.key,
        label: formatBucket(bucket.start, resolution),
        axisLabel:
          index % Math.max(1, Math.ceil(buckets.length / 6)) === 0
            ? new Date(bucket.start).toLocaleString(
                getLocale(),
                resolution === "hour" || resolution === "15m"
                  ? { hour: "2-digit", minute: "2-digit", hour12: false }
                  : { month: "short", day: "numeric" },
              )
            : undefined,
        values: Object.fromEntries(
          series.map((s) => [
            s.key,
            percent
              ? bucket[metric]
                ? ((bucket.series[s.key]?.[metric] ?? 0) / bucket[metric]) * 100
                : 0
              : (bucket.series[s.key]?.[metric] ?? 0),
          ]),
        ),
      })),
    [buckets, series, resolution, percent, metric],
  );
  return (
    <section className="usage-panel usage-trend" data-usage-chart="trend">
      <div className="usage-section-heading">
        <h3>{t("Usage over time")}</h3>
        <Button
          variant="ghost"
          disabled={!point && buckets.length !== 1}
          onClick={() => {
            const interval = point ?? (buckets.length === 1 ? buckets[0] : undefined);
            if (interval) onSelect({ start: interval.start, end: interval.end });
          }}
        >
          {t("Select interval")}
        </Button>
      </div>
      {buckets.length === 1 ? (
        <div className="usage-single-period">
          <p className="usage-muted">
            {formatBucket(buckets[0].start, resolution)} –{" "}
            {formatBucket(buckets[0].end, resolution)}
          </p>
          {series.map((item) => (
            <p key={item.key}>
              <label className="flex min-w-0 items-center gap-2">
                <Checkbox
                  aria-label={item.label}
                  checked={singleSeries === null || singleSeries.has(item.key)}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setSingleSeries((previous) => {
                      const next = new Set(previous ?? series.map((entry) => entry.key));
                      if (checked) next.add(item.key);
                      else next.delete(item.key);
                      return next;
                    });
                  }}
                />
                {item.label}
              </label>
              <strong hidden={singleSeries !== null && !singleSeries.has(item.key)}>
                {format(data[0]?.values[item.key] ?? 0)}
              </strong>
            </p>
          ))}
        </div>
      ) : (
        <LineChart
          label={t("Usage over time")}
          data={series.length ? data : []}
          emptyLabel={t("No usage recorded in this period.")}
          selectSeriesLabel={t("Choose a series to show")}
          series={series.map((s, index) => ({
            key: s.key,
            label: s.label,
            color: usageChartColor(colors, s.key),
            area: false,
            // Series differ by stroke pattern as well as colour (solid, dash, dot).
            pattern: (["solid", "dash", "dot"] as const)[index % 3],
          }))}
          height={250}
          curve="linear"
          formatValue={format}
          formatTick={percent ? formatUsagePercent : (value) => formatMetricTick(value, metric)}
          onActiveChange={(_, datum) => {
            if (datum) setActive(datum.key);
          }}
        />
      )}
      <details>
        <summary>{t("Show as table")}</summary>
        <ContinuousUsageTable
          caption={t("Usage over time")}
          rows={buckets.map((b) => ({ ...b, label: formatBucket(b.start, resolution) }))}
          metric={metric}
        />
      </details>
    </section>
  );
}

export function UsageShare({
  rows,
  metric,
  colors,
  onSelect,
}: {
  rows: UsageBreakdown[];
  metric: UsageMetric;
  colors: Colors;
  onSelect: (key: string) => void;
}) {
  useLocale();
  return (
    <section className="usage-panel usage-share" data-usage-chart="share">
      <div className="usage-section-heading">
        <h3>{t("By provider")}</h3>
        <span>{t("Share of selected usage")}</span>
      </div>
      <DonutChart
        label={t("By provider")}
        data={rows
          .filter((row) => row[metric] > 0)
          .map((row) => ({
            key: row.key,
            label: row.label,
            value: row[metric],
            color: usageChartColor(colors, row.key),
          }))}
        size={200}
        thickness={24}
        formatValue={(value) => formatMetric(value, metric)}
        groupBelow={0}
        legendAction="select"
        onActiveChange={(key) => {
          if (key !== null) onSelect(key);
        }}
      />
    </section>
  );
}

export function Contribution({
  rows,
  metric,
  title,
  onSelect,
  colors,
}: {
  rows: UsageBreakdown[];
  metric: UsageMetric;
  title: string;
  onSelect: (key: string) => void;
  colors: Colors;
}) {
  useLocale();
  const total = usageTotals(rows)[metric];
  return (
    <section className="usage-panel">
      <div className="usage-section-heading">
        <h3>{title}</h3>
        <span>{t("Share of selected usage")}</span>
      </div>
      <div className="usage-contributions">
        {rows.slice(0, 5).map((row) => (
          <div className="usage-contribution" key={row.key}>
            <Button variant="link" onClick={() => onSelect(row.key)}>
              {row.label}
            </Button>
            <span>
              {formatMetric(row[metric], metric)}{" "}
              <small>{formatUsagePercent(total ? (row[metric] / total) * 100 : 0)}</small>
            </span>
            <div className="usage-rank-track" aria-hidden="true">
              <span
                style={{
                  inlineSize: `${total ? (row[metric] / total) * 100 : 0}%`,
                  background: usageChartColor(colors, row.key),
                }}
              />
            </div>
          </div>
        ))}
      </div>
      {!rows.length && <p className="usage-muted">{t("No records")}</p>}
      {rows.length > 5 && <p className="usage-muted">{t("Top 5 shown")}</p>}
    </section>
  );
}

const dayKey = (at: number) => {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const addDays = (at: number, days: number) => {
  const date = new Date(at);
  date.setDate(date.getDate() + days);
  return date.getTime();
};

export function TimeDistribution({
  samples,
  metric,
  onSelect,
  window,
}: {
  samples: UsageSample[];
  metric: UsageMetric;
  onSelect: (window: UsageWindow) => void;
  window: UsageWindow;
}) {
  const locale = useLocale();
  const [weekOffset, setWeekOffset] = useState(0);
  const [intervalMode, setIntervalMode] = useState<"clock" | UsageResolution>("clock");
  const [focus, setFocus] = useState("0:0");
  const startDay = bucketStart(window.start, "day");
  const endDay = bucketStart(window.end - 1, "day");
  const weekStarts: number[] = [];
  for (let date = endDay; date >= startDay; date = addDays(date, -7))
    weekStarts.unshift(Math.max(startDay, addDays(date, -6)));
  const page = Math.max(0, weekStarts.length - 1 - Math.min(weekOffset, weekStarts.length - 1));
  const from = weekStarts[page] ?? startDay;
  const dates = Array.from({ length: 7 }, (_, day) => addDays(from, day)).filter(
    (at) => at <= endDay && (page === weekStarts.length - 1 || at < weekStarts[page + 1]),
  );
  const { hours, cells, daily } = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, hour) => ({
      key: String(hour),
      label: `${String(hour).padStart(2, "0")}:00`,
      axisLabel: hour % 3 === 0 ? `${String(hour).padStart(2, "0")}:00` : undefined,
      value: 0,
    }));
    const cells = new Map<string, number>();
    const daily = new Map<string, number>();
    for (const sample of samples) {
      const hour = new Date(sample.at).getHours();
      const day = dayKey(sample.at);
      hours[hour].value += sample[metric];
      cells.set(`${day}:${hour}`, (cells.get(`${day}:${hour}`) ?? 0) + sample[metric]);
      daily.set(day, (daily.get(day) ?? 0) + sample[metric]);
    }
    return { hours, cells, daily };
  }, [samples, metric]);
  const maximum = Math.max(0, ...cells.values());
  const chronologicalResolution = effectiveResolution(
    window,
    intervalMode === "clock" ? "hour" : intervalMode,
  );
  const intervalBars = useMemo(
    () =>
      usageBuckets(samples, window, chronologicalResolution, "provider", metric).buckets.map(
        (bucket, index, all) => ({
          key: bucket.key,
          label: formatBucket(bucket.start, chronologicalResolution),
          axisLabel:
            index % Math.max(1, Math.ceil(all.length / 6)) === 0
              ? new Date(bucket.start).toLocaleString(locale, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })
              : undefined,
          value: bucket[metric],
        }),
      ),
    [samples, window, chronologicalResolution, metric, locale],
  );
  const focusParts = focus.split(":").map(Number);
  const focusDay = dates[focusParts[1]];
  const focusStart = focusDay === undefined ? null : new Date(focusDay);
  focusStart?.setHours(focusParts[0]);
  const effectiveFocus =
    focusStart &&
    focusStart.getTime() < window.end &&
    focusStart.getTime() + 3_600_000 > window.start
      ? focus
      : `${new Date(Math.max(from, window.start)).getHours()}:0`;
  const dateLabel = (at: number) =>
    new Date(at).toLocaleDateString(locale, { month: "short", day: "numeric" });
  const calendarDays = [];
  for (let date = Math.max(startDay, addDays(endDay, -89)); date <= endDay; date = addDays(date, 1))
    calendarDays.push({ date: dayKey(date), count: daily.get(dayKey(date)) ?? 0 });
  return (
    <div className="usage-time-layout">
      <section className="usage-panel usage-week-panel" data-usage-chart="week">
        <div className="usage-section-heading">
          <div>
            <h3>{t("Day and hour activity")}</h3>
            <p className="usage-muted">
              {dateLabel(from)} – {dateLabel(dates[dates.length - 1])}
            </p>
          </div>
          <div className="usage-controls">
            <Button
              variant="ghost"
              iconOnly
              label={t("Previous week")}
              disabled={page === 0}
              onClick={() => setWeekOffset((value) => value + 1)}
            >
              <ChevronLeft className="icon-sm" />
            </Button>
            <Button
              variant="ghost"
              iconOnly
              label={t("Next week")}
              disabled={page === weekStarts.length - 1}
              onClick={() => setWeekOffset((value) => Math.max(0, value - 1))}
            >
              <ChevronRight className="icon-sm" />
            </Button>
          </div>
        </div>
        <div
          className="usage-week-grid"
          data-single-day={dates.length === 1 || undefined}
          role="grid"
          aria-label={t("Day and hour activity")}
          style={{
            gridTemplateColumns:
              dates.length === 1
                ? "repeat(2, minmax(0, 1fr))"
                : `3.5rem repeat(${dates.length}, minmax(0, 1fr))`,
          }}
        >
          <div role="row" className="usage-week-row">
            <span role="columnheader">{t("Time")}</span>
            {dates.map((date) => (
              <span key={date} role="columnheader">
                <b>{new Date(date).toLocaleDateString(locale, { weekday: "short" })}</b>
                {new Date(date).toLocaleDateString(locale, { day: "numeric" })}
              </span>
            ))}
          </div>
          {hours.map((hour, rowIndex) => (
            <div role="row" className="usage-week-row" key={hour.key}>
              <span role="rowheader">{hour.label}</span>
              {dates.map((day, columnIndex) => {
                const amount = cells.get(`${dayKey(day)}:${rowIndex}`) ?? 0;
                const start = new Date(day);
                start.setHours(rowIndex);
                const end = new Date(day);
                end.setHours(rowIndex + 1);
                const key = `${rowIndex}:${columnIndex}`;
                const outside = end.getTime() <= window.start || start.getTime() >= window.end;
                return (
                  <Button
                    role="gridcell"
                    key={day}
                    variant="item"
                    motion="none"
                    className="usage-hour-cell"
                    disabled={outside}
                    tabIndex={effectiveFocus === key ? 0 : -1}
                    data-level={
                      amount === 0
                        ? 0
                        : amount / maximum <= 0.25
                          ? 1
                          : amount / maximum <= 0.5
                            ? 2
                            : amount / maximum <= 0.75
                              ? 3
                              : 4
                    }
                    aria-label={`${formatBucket(start.getTime(), "hour")}: ${formatMetric(amount, metric)}`}
                    tooltip={`${formatBucket(start.getTime(), "hour")}: ${formatMetric(amount, metric)}`}
                    onFocus={() => setFocus(key)}
                    onClick={() =>
                      onSelect({
                        start: Math.max(start.getTime(), window.start),
                        end: Math.min(end.getTime(), window.end),
                      })
                    }
                    onKeyDown={(event) => {
                      const delta =
                        dates.length === 1
                          ? {
                              ArrowLeft: [-1, 0],
                              ArrowRight: [1, 0],
                              ArrowUp: [-2, 0],
                              ArrowDown: [2, 0],
                            }[event.key]
                          : {
                              ArrowLeft: [0, -1],
                              ArrowRight: [0, 1],
                              ArrowUp: [-1, 0],
                              ArrowDown: [1, 0],
                            }[event.key];
                      if (!delta) return;
                      event.preventDefault();
                      const row = Math.max(0, Math.min(23, rowIndex + delta[0]));
                      const column = Math.max(
                        0,
                        Math.min(dates.length - 1, columnIndex + delta[1]),
                      );
                      const grid = event.currentTarget.closest('[role="grid"]');
                      const target =
                        grid?.querySelectorAll<HTMLButtonElement>('[role="gridcell"]')[
                          row * dates.length + column
                        ];
                      target?.focus();
                    }}
                  >
                    <span aria-hidden>{amount > 0 ? formatMetric(amount, metric) : ""}</span>
                  </Button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="usage-heat-legend">
          <span>{t("Less")}</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <i key={level} data-level={level} />
          ))}
          <span>{t("More")}</span>
          <span>{t("Select an hour to inspect")}</span>
        </div>
      </section>
      <div className="usage-time-secondary">
        <section className="usage-panel usage-hourly-chart" data-usage-chart="hourly">
          <div className="usage-section-heading">
            <h3>{t(intervalMode === "clock" ? "Hour of day" : "Usage over time")}</h3>
            <Select
              label={t("Time grouping")}
              value={intervalMode}
              onValueChange={(value) => setIntervalMode(value as "clock" | UsageResolution)}
              options={[
                { value: "clock", label: t("Hour of day") },
                { value: "15m", label: t("15 minutes") },
                { value: "hour", label: t("Hourly") },
                { value: "day", label: t("Daily") },
                { value: "week", label: t("Weekly") },
              ]}
            />
          </div>
          <BarChart
            label={`${t(intervalMode === "clock" ? "Hour of day" : "Usage over time")} · ${t(metricNames[metric])}`}
            period={`${dateLabel(window.start)} – ${dateLabel(window.end - 1)}`}
            data={intervalMode === "clock" ? hours : intervalBars}
            height={190}
            formatValue={(value) => formatMetric(value, metric)}
          />
        </section>
        {calendarDays.length >= 56 && (
          <section className="usage-panel" data-usage-chart="calendar">
            <div className="usage-section-heading">
              <h3>{t("Daily activity")}</h3>
              <span>{t("Latest 90 days within the selected interval")}</span>
            </div>
            <ActivityHeatmap
              days={calendarDays}
              thresholds={(() => {
                const maximum = Math.max(0, ...calendarDays.map((day) => day.count));
                return [maximum * 0.25, maximum * 0.5, maximum * 0.75];
              })()}
              label={t("Daily activity")}
              period={`${calendarDays[0].date} – ${calendarDays[calendarDays.length - 1].date}`}
              unit={{ one: "", other: "" }}
              formatValue={(value) => formatMetric(value, metric)}
              onSelectDate={(date) => {
                const start = new Date(`${date}T00:00:00`).getTime();
                onSelect({
                  start: Math.max(start, window.start),
                  end: Math.min(addDays(start, 1), window.end),
                });
              }}
            />
          </section>
        )}
      </div>
    </div>
  );
}

export function UsageDataNotes({
  unpriced,
  pricedCoverage,
  pricesUnavailable,
  sessionDurationUnavailable,
  timedTurns,
  turns,
  truncated,
}: {
  unpriced: string[];
  pricedCoverage: string;
  pricesUnavailable: boolean;
  sessionDurationUnavailable: boolean;
  timedTurns: number;
  turns: number;
  truncated: boolean;
}) {
  return (
    <details className="usage-data-notes">
      <summary>
        {t("Data sources and coverage")}
        {unpriced.length
          ? ` · ${unpriced.length} ${t("Models without prices")}`
          : ""}
      </summary>
      <p>
        {t(
          "API-equivalent estimates from local session logs, not what a subscription plan bills.",
        )}{" "}
        {t("Priced token coverage")}: {pricedCoverage}.
      </p>
      {unpriced.length > 0 && (
        <>
          <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
            <span className="shrink-0">{t("Models without prices")}:</span>
            <BadgeList
              label={t("Models without prices")}
              size="xs"
              className="min-w-0 flex-1"
              items={unpriced.map((model, index) => ({
                id: `${index}:${model}`,
                label: model,
              }))}
            />
          </div>
          <p>{t("Their tokens are included; their cost is unavailable.")}</p>
        </>
      )}
      {pricesUnavailable && (
        <p>{t("OpenRouter prices could not be loaded, so built-in prices are used.")}</p>
      )}
      {sessionDurationUnavailable ? (
        <p>
          {t(
            "Session duration data is unavailable on this app version or could not be read.",
          )}
        </p>
      ) : (
        <p>
          {t(
            "Agent time sums recorded completed turn intervals and may include waiting. Parallel sessions can exceed wall-clock time.",
          )}{" "}
          {timedTurns}/{turns} {t("turns with duration")}.
        </p>
      )}
      {truncated && (
        <p>
          {t("Session data is limited to the latest 50,000 turns. Select a shorter interval.")}
        </p>
      )}
      <p>{t("Token timestamps have 15-minute precision. End time is exclusive.")}</p>
    </details>
  );
}
