import { EmptyState } from "../../../shared/ui/EmptyState";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { useMemo, useState, type CSSProperties } from "react";
import { dateTimeFormat, formatDate, formatNumber, t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Heading } from "../../../shared/ui/Heading";
import {
  ActivityHeatmap,
  BarChart,
  DonutChart,
  HeatScale,
  LineChart,
} from "../../../shared/ui/Charts";
import { ChevronLeft, ChevronRight } from "../../../shared/ui/icons";
import { Select } from "../../../shared/ui/Select";
import { Checkbox } from "../../../shared/ui/Checkbox";
import {
  bucketStart,
  effectiveResolution,
  usageBuckets,
  usageTotals,
  type UsageBucket,
  type UsageBreakdown,
  type UsageDimension,
  type UsageMetric,
  type UsageResolution,
  type UsageSample,
  type UsageWindow,
} from "../model/usageAnalytics";
import { usageChartColor } from "../model/usageColors";
import { UsageProviderIdentity, usageProviderLabel } from "./UsageProviderIdentity";
import { ModelLabel } from "../../sessions/public/ModelLabel";
import "./UsageVisualizations.css";
import {
  formatBucket,
  formatMetric,
  formatMetricTick,
  formatUsagePercent,
  metricNames,
  ContinuousUsageTable,
} from "./UsageCharts";

type Colors = ReadonlyMap<string, string>;
const ENGLISH_USAGE_LABELS = ["Unknown folder", "Not in a group", "Other", "Default account"];
/** Labels the usage model emits as English constants; real folder and account names pass through. */
export function usageLabel(label: string): string {
  return ENGLISH_USAGE_LABELS.includes(label) ? t(label) : label;
}

/** A chart series name with its icon: the provider's, or the model's when the series are models. */
function SeriesIdentity({ item, dimension }: { item: UsageBreakdown; dimension?: UsageDimension }) {
  const label = usageProviderLabel(usageLabel(item.label));
  if (dimension === "model")
    return <ModelLabel model={item.key} harness={item.provider} name={label} />;
  return <UsageProviderIdentity provider={item.key} label={label} />;
}

export function UsageTrend({
  buckets,
  series: allSeries,
  metric,
  resolution,
  percent,
  onSelect,
  colors,
  dimension,
}: {
  buckets: UsageBucket[];
  series: UsageBreakdown[];
  metric: UsageMetric;
  resolution: UsageResolution;
  percent: boolean;
  onSelect: (window: UsageWindow) => void;
  colors: Colors;
  /** What the series are; models get the model icon in the legend. */
  dimension?: UsageDimension;
}) {
  const locale = useLocale();
  const [active, setActive] = useState<string | null>(null);
  const [singleSeries, setSingleSeries] = useState<ReadonlySet<string> | null>(null);
  const [hiddenSeries, setHiddenSeries] = useState<string[]>([]);
  // The shared Disclosure keeps closed bodies mounted, so the table is only built while open.
  const [tableOpen, setTableOpen] = useState(false);
  // Series without any value in the interval only add flat lines and $0 tooltip rows.
  const series = useMemo(() => allSeries.filter((entry) => entry[metric] > 0), [allSeries, metric]);
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
            ? dateTimeFormat(
                locale,
                resolution === "hour" || resolution === "15m"
                  ? { hour: "2-digit", minute: "2-digit", hour12: false }
                  : { month: "short", day: "numeric" },
              ).format(bucket.start)
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
    [buckets, series, resolution, percent, metric, locale],
  );
  return (
    <section
      {...surfaceAttributes(
        { frame: "card", edge: "all", radius: "card", variant: "card" },
        "usage-panel usage-trend",
      )}
      data-usage-chart="trend"
    >
      <div className="usage-section-heading">
        <Heading size="item" level={3}>
          {t("Usage over time")}
        </Heading>
      </div>
      {buckets.length === 1 ? (
        <div className="usage-single-period">
          <Text as="p" leading="inherit" className="usage-muted">
            {formatBucket(buckets[0].start, resolution)} –{" "}
            {formatBucket(buckets[0].end, resolution)}
          </Text>
          {series.map((item) => (
            <p key={item.key}>
              <Checkbox
                className="min-w-0 items-center"
                label={<SeriesIdentity item={item} dimension={dimension} />}
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
              <strong hidden={singleSeries !== null && !singleSeries.has(item.key)}>
                {format(data[0]?.values[item.key] ?? 0)}
              </strong>
            </p>
          ))}
        </div>
      ) : (
        <>
          <div className="usage-provider-legend">
            {series.map((item) => (
              <Button
                key={item.key}
                variant="ghost"
                size="sm"
                aria-pressed={!hiddenSeries.includes(item.key)}
                textTone={hiddenSeries.includes(item.key) ? "secondary" : undefined}
                onClick={() =>
                  setHiddenSeries((hidden) =>
                    hidden.includes(item.key)
                      ? hidden.filter((key) => key !== item.key)
                      : [...hidden, item.key],
                  )
                }
              >
                <SeriesIdentity item={item} dimension={dimension} />
              </Button>
            ))}
          </div>
          {/* Clicking (or Enter on) the hovered or focused point selects its interval. */}
          {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Enter handler for the chart's own focusable points; pointer click on the active point. */}
          <div
            onClick={() => {
              if (point) onSelect({ start: point.start, end: point.end });
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !point) return;
              event.preventDefault();
              onSelect({ start: point.start, end: point.end });
            }}
          >
            <LineChart
              label={t("Usage over time")}
              data={series.length ? data : []}
              emptyLabel={t("No usage recorded in this period.")}
              selectSeriesLabel={t("Choose a series to show")}
              series={series.map((s, index) => ({
                key: s.key,
                label: usageProviderLabel(usageLabel(s.label)),
                color: usageChartColor(colors, s.key),
                area: false,
                // Series differ by stroke pattern as well as colour (solid, dash, dot).
                pattern: (["solid", "dash", "dot"] as const)[index % 3],
              }))}
              height={250}
              curve="linear"
              legend={false}
              hiddenSeries={hiddenSeries}
              onHiddenSeriesChange={setHiddenSeries}
              formatValue={format}
              formatTick={percent ? formatUsagePercent : (value) => formatMetricTick(value, metric)}
              // The chart reports null when the pointer leaves, focus leaves or the data changes; clear the selection with it.
              onActiveChange={(_, datum) => setActive(datum?.key ?? null)}
            />
          </div>
        </>
      )}
      <Disclosure
        size="sm"
        summary={t("Show as table")}
        open={tableOpen}
        onOpenChange={setTableOpen}
      >
        {tableOpen ? (
          <Text as="div" leading="inherit">
            <ContinuousUsageTable
              caption={t("Usage over time")}
              rows={buckets.map((b) => ({ ...b, label: formatBucket(b.start, resolution) }))}
              metric={metric}
            />
          </Text>
        ) : null}
      </Disclosure>
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
  const totals = usageTotals(rows);
  return (
    <section
      {...surfaceAttributes(
        { frame: "card", edge: "all", radius: "card", variant: "card" },
        "usage-panel usage-share",
      )}
      data-usage-chart="share"
    >
      <div className="usage-section-heading">
        <Heading size="item" level={3}>
          {t("By provider")}
        </Heading>
      </div>
      <DonutChart
        label={t("By provider")}
        data={rows
          .filter((row) => row[metric] > 0)
          .map((row) => ({
            key: row.key,
            label: usageProviderLabel(usageLabel(row.label)),
            value: row[metric],
            color: usageChartColor(colors, row.key),
          }))}
        size={200}
        thickness={24}
        formatValue={(value) => formatMetric(value, metric)}
        groupBelow={0}
        legendAction="select"
        legend={false}
        onActiveChange={(key) => {
          if (key !== null) onSelect(key);
        }}
      />
      <div className="usage-provider-shares">
        {rows
          .filter((row) => row[metric] > 0)
          .map((row) => (
            <Button key={row.key} variant="ghost" onClick={() => onSelect(row.key)}>
              <UsageProviderIdentity provider={row.key} />
              <strong>{formatMetric(row[metric], metric)}</strong>
              <span>{formatUsagePercent((row[metric] / totals[metric]) * 100)}</span>
            </Button>
          ))}
      </div>
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
  rows: (UsageBreakdown & { providers?: string[] })[];
  metric: UsageMetric;
  title: string;
  onSelect: (key: string) => void;
  colors: Colors;
}) {
  useLocale();
  const [expanded, setExpanded] = useState(false);
  // Shares are against the whole list, so rows revealed below keep the same percentages.
  const total = usageTotals(rows)[metric];
  const renderRow = (row: (typeof rows)[number]) => (
    <div className="usage-contribution" key={row.key}>
      <Button variant="link" truncate onClick={() => onSelect(row.key)}>
        {row.providers?.map((provider) => (
          <UsageProviderIdentity key={provider} provider={provider} label="" />
        ))}
        {usageLabel(row.label)}
      </Button>
      <Text size="caption" tone="primary" leading="inherit">
        {formatMetric(row[metric], metric)}{" "}
        <Text as="small" size="inherit" tone="secondary">
          {formatUsagePercent(total ? (row[metric] / total) * 100 : 0)}
        </Text>
      </Text>
      <div className="usage-rank-track" aria-hidden="true">
        <span
          {...surfaceAttributes({ variant: "user-color" })}
          style={
            {
              "--usage-rank-share": `${total ? (row[metric] / total) * 100 : 0}%`,
              "--surface-user-color": usageChartColor(colors, row.key),
            } as CSSProperties
          }
        />
      </div>
    </div>
  );
  return (
    <section
      {...surfaceAttributes(
        { frame: "card", edge: "all", radius: "card", variant: "card" },
        "usage-panel",
      )}
    >
      <div className="usage-section-heading">
        <Heading size="item" level={3}>
          {title}
        </Heading>
      </div>
      <div className="usage-contributions">{rows.slice(0, 5).map(renderRow)}</div>
      {!rows.length && (
        <EmptyState
          size="inline"
          kind="empty"
          className="usage-muted"
          description={t("No records")}
        />
      )}
      {rows.length > 5 && (
        <Disclosure
          size="sm"
          summary={t("Show all")}
          count={rows.length - 5}
          open={expanded}
          onOpenChange={setExpanded}
        >
          {/* Rows past the first five mount only while open, so long tails stay cheap. */}
          {expanded && <div className="usage-contributions">{rows.slice(5).map(renderRow)}</div>}
        </Disclosure>
      )}
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
// An hour cell is unselectable when its local hour lies entirely outside the usage window.
export const isHourOutside = (day: number, hour: number, window: UsageWindow) => {
  const start = new Date(day);
  start.setHours(hour);
  const end = new Date(day);
  end.setHours(hour + 1);
  return end.getTime() <= window.start || start.getTime() >= window.end;
};
// Walks from a cell in the arrow direction and returns the first selectable cell on the way,
// or the origin when none exists before the grid edge. Never wraps and never lands on a
// disabled cell, because disabled buttons cannot receive focus.
export function nextSelectableCell(
  from: { row: number; column: number },
  rowStep: number,
  columnStep: number,
  size: { rows: number; columns: number },
  isSelectable: (row: number, column: number) => boolean,
) {
  let row = from.row + rowStep;
  let column = from.column + columnStep;
  while (row >= 0 && row < size.rows && column >= 0 && column < size.columns) {
    if (isSelectable(row, column)) return { row, column };
    row += rowStep;
    column += columnStep;
  }
  return from;
}

type HourEntries = ReadonlyMap<string, { sample: UsageSample; value: number }>;

// Hour-cell tooltip body. Cells only pass this element as a tooltip line, so the sort and the
// ModelLabel rows are built when the shared Tooltip renders it (open), not for all 168 cells on
// every grid render. Every model/project entry stays in the data; the list is capped at six rows
// with an explicit "+N records" remainder.
export function HourDetails({
  entries,
  metric,
}: {
  entries: HourEntries | undefined;
  metric: UsageMetric;
}) {
  const sorted = [...(entries?.values() ?? [])].sort((a, b) => b.value - a.value);
  if (!sorted.length) return <>{t("No usage recorded in this period.")}</>;
  return (
    <span className="usage-hour-details">
      {sorted.slice(0, 6).map(({ sample, value }) => (
        <span
          key={JSON.stringify([sample.provider, sample.model, sample.project, sample.priced])}
          className="usage-hour-detail"
        >
          <ModelLabel model={sample.model} harness={sample.provider} />
          <span>· {usageLabel(sample.projectLabel)}</span>
          <strong>
            {metric === "cost" && !sample.priced ? t("Unavailable") : formatMetric(value, metric)}
          </strong>
        </span>
      ))}
      {sorted.length > 6 ? (
        <span>{`+${formatNumber(sorted.length - 6)} ${t("records")}`}</span>
      ) : null}
    </span>
  );
}

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
  const { hours, cells, daily, details } = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, hour) => ({
      key: String(hour),
      label: `${String(hour).padStart(2, "0")}:00`,
      axisLabel: hour % 3 === 0 ? `${String(hour).padStart(2, "0")}:00` : undefined,
      value: 0,
    }));
    const cells = new Map<string, number>();
    const daily = new Map<string, number>();
    const details = new Map<string, Map<string, { sample: UsageSample; value: number }>>();
    for (const sample of samples) {
      const hour = new Date(sample.at).getHours();
      const day = dayKey(sample.at);
      hours[hour].value += sample[metric];
      cells.set(`${day}:${hour}`, (cells.get(`${day}:${hour}`) ?? 0) + sample[metric]);
      daily.set(day, (daily.get(day) ?? 0) + sample[metric]);
      if (sample[metric] > 0 || (metric === "cost" && !sample.priced && sample.tokens > 0)) {
        const key = `${day}:${hour}`;
        const entries = details.get(key) ?? new Map();
        const identity = JSON.stringify([
          sample.provider,
          sample.model,
          sample.project,
          sample.priced,
        ]);
        const entry = entries.get(identity);
        entries.set(identity, { sample, value: (entry?.value ?? 0) + sample[metric] });
        details.set(key, entries);
      }
    }
    return { hours, cells, daily, details };
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
              ? dateTimeFormat(locale, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                }).format(bucket.start)
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
  const dateLabel = (at: number) => formatDate(at, { month: "short", day: "numeric" });
  const calendarDays = [];
  for (let date = Math.max(startDay, addDays(endDay, -89)); date <= endDay; date = addDays(date, 1))
    calendarDays.push({ date: dayKey(date), count: daily.get(dayKey(date)) ?? 0 });
  return (
    <div className="usage-time-layout">
      <div className="usage-time-secondary">
        <section
          {...surfaceAttributes(
            { frame: "card", edge: "all", radius: "card", variant: "card" },
            "usage-panel usage-hourly-chart",
          )}
          data-usage-chart="hourly"
        >
          <div className="usage-section-heading">
            <Heading size="item" level={3}>
              {t(metricNames[metric])}
            </Heading>
            <Select
              hideLabel
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
          <section
            {...surfaceAttributes(
              { frame: "card", edge: "all", radius: "card", variant: "card" },
              "usage-panel",
            )}
            data-usage-chart="calendar"
          >
            <div className="usage-section-heading">
              <Heading size="item" level={3}>
                {t("Daily activity")}
              </Heading>
              <Text as="span" leading="inherit">
                {t("Latest 90 days within the selected interval")}
              </Text>
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
      <section
        {...surfaceAttributes(
          { frame: "card", edge: "all", radius: "card", variant: "card" },
          "usage-panel usage-week-panel",
        )}
        data-usage-chart="week"
      >
        <div className="usage-section-heading">
          <div>
            <Heading size="item" level={3}>
              {t("Day and hour activity")}
            </Heading>
            <Text as="p" leading="inherit" className="usage-muted">
              {dateLabel(from)} – {dateLabel(dates[dates.length - 1])}
            </Text>
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
          role="grid"
          aria-label={t("Day and hour activity")}
          style={
            {
              "--usage-week-columns": dates.length,
            } as CSSProperties
          }
        >
          <div role="row" className="usage-week-row">
            <Text size="caption" tone="secondary" leading="inherit" role="columnheader">
              {t("Time")}
            </Text>
            {dates.map((date) => (
              <Text
                size="caption"
                tone="secondary"
                leading="inherit"
                key={date}
                role="columnheader"
              >
                <Text as="b" size="inherit" tone="primary" weight="medium">
                  {formatDate(date, { weekday: "short" })}
                </Text>
                {formatDate(date, { day: "numeric" })}
              </Text>
            ))}
          </div>
          {hours.map((hour, rowIndex) => (
            <div role="row" className="usage-week-row" key={hour.key}>
              <Text size="caption" tone="secondary" leading="inherit" role="rowheader">
                {hour.label}
              </Text>
              {dates.map((day, columnIndex) => {
                const amount = cells.get(`${dayKey(day)}:${rowIndex}`) ?? 0;
                const start = new Date(day);
                start.setHours(rowIndex);
                const end = new Date(day);
                end.setHours(rowIndex + 1);
                const key = `${rowIndex}:${columnIndex}`;
                const outside = isHourOutside(day, rowIndex, window);
                return (
                  <Button
                    role="gridcell"
                    key={day}
                    variant="item"
                    motion="none"
                    className="usage-hour-cell"
                    textTone={amount > 0 && amount / maximum > 0.75 ? "on-solid" : "primary"}
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
                    tooltipWide
                    tooltipDetails={[
                      <HourDetails
                        key="details"
                        entries={details.get(`${dayKey(day)}:${rowIndex}`)}
                        metric={metric}
                      />,
                    ]}
                    onFocus={() => setFocus(key)}
                    onClick={() =>
                      onSelect({
                        start: Math.max(start.getTime(), window.start),
                        end: Math.min(end.getTime(), window.end),
                      })
                    }
                    onKeyDown={(event) => {
                      const delta = {
                        ArrowLeft: [0, -1],
                        ArrowRight: [0, 1],
                        ArrowUp: [-1, 0],
                        ArrowDown: [1, 0],
                      }[event.key];
                      if (!delta) return;
                      event.preventDefault();
                      const next = nextSelectableCell(
                        { row: rowIndex, column: columnIndex },
                        delta[0],
                        delta[1],
                        { rows: hours.length, columns: dates.length },
                        (row, column) => !isHourOutside(dates[column], row, window),
                      );
                      const grid = event.currentTarget.closest('[role="grid"]');
                      const target =
                        grid?.querySelectorAll<HTMLButtonElement>('[role="gridcell"]')[
                          next.row * dates.length + next.column
                        ];
                      target?.focus();
                    }}
                  >
                    <Text size="caption" tone="inherit" leading="inherit" aria-hidden>
                      {amount > 0 ? formatMetric(amount, metric) : ""}
                    </Text>
                  </Button>
                );
              })}
            </div>
          ))}
        </div>
        <HeatScale className="mt-3" />
      </section>
    </div>
  );
}
