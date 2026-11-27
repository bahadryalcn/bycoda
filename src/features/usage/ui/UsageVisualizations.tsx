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
import { useUsageChartKind } from "../model/usageChartKinds";
import { trendSeriesValues } from "../model/usageChartSeries";
import { UsageChartKindControl } from "./UsageChartKindControl";
import { hourCellState } from "../model/hourCell";
import { UsageProviderIdentity, usageLabel, usageProviderLabel } from "./UsageProviderIdentity";
import { ModelLabel } from "../../sessions/public/ModelLabel";
import "./UsageVisualizations.css";
import {
  formatBucket,
  formatMetric,
  formatMetricTick,
  formatUsagePercent,
  metricName,
  ContinuousUsageTable,
} from "./UsageCharts";

type Colors = ReadonlyMap<string, string>;
/** The bar chart adds a readout header above its plot; its plot is shorter by that much so switching chart type keeps the panel height. */
const BAR_HEADER_HEIGHT = 92;
const TREND_LINE_HEIGHT = 250;
const TREND_BAR_HEIGHT = TREND_LINE_HEIGHT - BAR_HEADER_HEIGHT;
const HOURLY_BAR_HEIGHT = 190;
const HOURLY_LINE_HEIGHT = HOURLY_BAR_HEIGHT + BAR_HEADER_HEIGHT;
/** A chart series name with its icon: the provider's, or the model's when the series are models. */
const SERIES_DASH = { solid: undefined, dash: "5 3", dot: "1.5 3" } as const;
/** Legend line sample in the series colour and stroke pattern, so the key survives without colour. */
function SeriesSwatch({ color, pattern }: { color: string; pattern: keyof typeof SERIES_DASH }) {
  return (
    <svg
      className="usage-series-swatch"
      width="18"
      height="8"
      viewBox="0 0 18 8"
      aria-hidden="true"
    >
      <line
        x1="1"
        y1="4"
        x2="17"
        y2="4"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={SERIES_DASH[pattern]}
      />
    </svg>
  );
}
/** Stacked-bar key: a filled square in the series colour with the bar's surface pattern, so it differs by more than colour. */
const BAR_PATTERNS = ["solid", "diagonal", "dots", "cross"] as const;
function BarSwatch({ color, index }: { color: string; index: number }) {
  const pattern = BAR_PATTERNS[index % BAR_PATTERNS.length];
  return (
    <svg
      className="usage-series-swatch"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
    >
      <rect width="12" height="12" rx="2" fill={color} />
      <g className="usage-bar-swatch-mark">
        {(pattern === "diagonal" || pattern === "cross") && (
          <path d="M-1 5 L5 -1 M-1 11 L11 -1 M5 13 L13 5 M11 13 L13 11" fill="none" />
        )}
        {pattern === "cross" && <path d="M13 1 L1 13 M7 -1 L-1 7 M13 7 L7 13" fill="none" />}
        {pattern === "dots" && (
          <>
            <circle cx="3" cy="3" r="1" stroke="none" />
            <circle cx="9" cy="3" r="1" stroke="none" />
            <circle cx="3" cy="9" r="1" stroke="none" />
            <circle cx="9" cy="9" r="1" stroke="none" />
          </>
        )}
      </g>
    </svg>
  );
}
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
  const [kind, setKind] = useUsageChartKind("trend");
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
  const data = useMemo(() => {
    const perBucket = trendSeriesValues(
      buckets,
      series.map((s) => s.key),
      metric,
      { percent, cumulative: kind === "cumulative" },
    );
    return buckets.map((bucket, index) => ({
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
      values: perBucket[index]!,
    }));
  }, [buckets, series, resolution, percent, metric, locale, kind]);
  const stacked = kind === "stacked-bar";
  // Hidden series keep their lane (and pattern) but draw nothing and leave the total.
  const barData = data.map((datum) => {
    const values = series.map((s) => (hiddenSeries.includes(s.key) ? 0 : datum.values[s.key]!));
    return {
      key: datum.key,
      label: datum.label,
      axisLabel: datum.axisLabel,
      value: values.reduce((sum, value) => sum + value, 0),
      values,
    };
  });
  const subtitle =
    kind === "cumulative" ? `${metricName(metric)} · ${t("Cumulative")}` : metricName(metric);
  return (
    <section
      {...surfaceAttributes(
        { frame: "card", edge: "all", radius: "card", variant: "card" },
        "usage-panel usage-trend",
      )}
      data-usage-chart="trend"
    >
      <div className="usage-section-heading">
        <div>
          <Heading size="item" level={3}>
            {t("Usage over time")}
          </Heading>
          <Text as="p" leading="inherit" className="usage-muted">
            {subtitle}
          </Text>
        </div>
        <div className="usage-controls">
          <UsageChartKindControl panel="trend" kind={kind} onChange={setKind} />
        </div>
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
            {series.map((item, index) => (
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
                {stacked ? (
                  <BarSwatch color={usageChartColor(colors, item.key)} index={index} />
                ) : (
                  <SeriesSwatch
                    color={usageChartColor(colors, item.key)}
                    pattern={(["solid", "dash", "dot"] as const)[index % 3]}
                  />
                )}
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
            {stacked ? (
              <BarChart
                label={`${t("Usage over time")} · ${metricName(metric)}`}
                period={`${formatBucket(buckets[0].start, resolution)} – ${formatBucket(buckets[buckets.length - 1].end, resolution)}`}
                data={series.length ? barData : []}
                stacked
                legend={false}
                seriesLabels={series.map((s) => usageProviderLabel(usageLabel(s.label)))}
                seriesColors={series.map((s) => usageChartColor(colors, s.key))}
                height={TREND_BAR_HEIGHT}
                formatValue={format}
                formatTick={
                  percent ? formatUsagePercent : (value) => formatMetricTick(value, metric)
                }
                averageLabel={t("Average per interval")}
                valueLabel={metricName(metric)}
                onActiveChange={(datum) => setActive(datum?.key ?? null)}
              />
            ) : (
              <LineChart
                label={
                  kind === "cumulative"
                    ? `${t("Usage over time")} · ${t("Cumulative")}`
                    : t("Usage over time")
                }
                data={series.length ? data : []}
                emptyLabel={t("No usage recorded in this period.")}
                selectSeriesLabel={t("Choose a series to show")}
                series={series.map((s, index) => ({
                  key: s.key,
                  label: usageProviderLabel(usageLabel(s.label)),
                  color: usageChartColor(colors, s.key),
                  // Area fills each series with a translucent tint of its own colour.
                  area: kind === "area",
                  // Series differ by stroke pattern as well as colour (solid, dash, dot).
                  pattern: (["solid", "dash", "dot"] as const)[index % 3],
                }))}
                height={TREND_LINE_HEIGHT}
                curve="linear"
                legend={false}
                hiddenSeries={hiddenSeries}
                onHiddenSeriesChange={setHiddenSeries}
                formatValue={format}
                formatTick={
                  percent ? formatUsagePercent : (value) => formatMetricTick(value, metric)
                }
                // The chart reports null when the pointer leaves, focus leaves or the data changes; clear the selection with it.
                onActiveChange={(_, datum) => setActive(datum?.key ?? null)}
              />
            )}
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
  activeKey,
  onClear,
}: {
  rows: UsageBreakdown[];
  metric: UsageMetric;
  colors: Colors;
  onSelect: (key: string) => void;
  /** The provider the page is filtered to; keeps the donut slice pinned in sync with the filter. */
  activeKey?: string | null;
  /** Called when the pinned slice is clicked again. */
  onClear?: () => void;
}) {
  useLocale();
  const [kind, setKind] = useUsageChartKind("share");
  const totals = usageTotals(rows);
  const shown = rows.filter((row) => row[metric] > 0);
  return (
    <section
      {...surfaceAttributes(
        { frame: "card", edge: "all", radius: "card", variant: "card" },
        "usage-panel usage-share",
      )}
      data-usage-chart="share"
    >
      <div className="usage-section-heading">
        <Heading size="item" level={4}>
          {t("By provider")}
        </Heading>
        <div className="usage-controls">
          <UsageChartKindControl panel="share" kind={kind} onChange={setKind} />
        </div>
      </div>
      {kind === "donut" ? (
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
          activeKey={activeKey}
          onActiveChange={(key) => {
            if (key !== null) onSelect(key);
            else onClear?.();
          }}
        />
      ) : null}
      <div
        className="usage-provider-shares"
        data-kind={kind}
        role={kind === "bar" ? "group" : undefined}
        aria-label={kind === "bar" ? t("By provider") : undefined}
      >
        {shown.map((row) => (
          <div key={row.key} className="usage-share-row">
            <Button
              variant="ghost"
              align="start"
              pressed={activeKey === row.key}
              onClick={() => onSelect(row.key)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <svg
                  className="flex-none"
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  aria-hidden="true"
                >
                  <circle cx="5" cy="5" r="5" fill={usageChartColor(colors, row.key)} />
                </svg>
                <UsageProviderIdentity provider={row.key} />
              </span>
              <Text as="span" size="caption" tone="primary" weight="medium" leading="inherit">
                {formatMetric(row[metric], metric)}
              </Text>
              <Text as="span" size="caption" tone="secondary" leading="inherit">
                {formatUsagePercent((row[metric] / totals[metric]) * 100)}
              </Text>
            </Button>
            {kind === "bar" ? (
              <span className="usage-rank-track" aria-hidden="true">
                <span
                  {...surfaceAttributes({ variant: "user-color" })}
                  style={
                    {
                      "--usage-rank-share": `${(row[metric] / totals[metric]) * 100}%`,
                      "--surface-user-color": usageChartColor(colors, row.key),
                    } as CSSProperties
                  }
                />
              </span>
            ) : null}
          </div>
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
  total: fullTotal,
}: {
  rows: (UsageBreakdown & { providers?: string[] })[];
  metric: UsageMetric;
  title: string;
  onSelect: (key: string) => void;
  colors: Colors;
  /** Total of the unfiltered list, so a search narrows the rows without rescaling their shares. */
  total?: number;
}) {
  useLocale();
  const [expanded, setExpanded] = useState(false);
  // Shares are against the whole list, so rows revealed below keep the same percentages.
  const total = fullTotal ?? usageTotals(rows)[metric];
  const renderRow = (row: (typeof rows)[number]) => (
    <div className="usage-contribution" key={row.key}>
      <Button
        variant="link"
        truncate
        tooltip={usageLabel(row.label)}
        onClick={() => onSelect(row.key)}
      >
        {row.providers?.length === 1 && (
          <UsageProviderIdentity provider={row.providers[0]} label="" />
        )}
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
        <Heading size="item" level={4}>
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
          {expanded && (
            <div className="usage-contributions usage-contributions-scroll">
              {rows.slice(5).map(renderRow)}
            </div>
          )}
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
        <span>{t("+{p0} records", { p0: formatNumber(sorted.length - 6) })}</span>
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
  const [hourlyKind, setHourlyKind] = useUsageChartKind("hourly");
  const [weekOffset, setWeekOffset] = useState(0);
  // Week paging counts back from the period end, so a new period starts on its latest week.
  const [pagedWindow, setPagedWindow] = useState(window);
  if (pagedWindow.start !== window.start || pagedWindow.end !== window.end) {
    setPagedWindow(window);
    setWeekOffset(0);
  }
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
  const { hours, cells, daily, details, unpricedHours } = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, hour) => ({
      key: String(hour),
      label: `${String(hour).padStart(2, "0")}:00`,
      axisLabel: hour % 3 === 0 ? `${String(hour).padStart(2, "0")}:00` : undefined,
      value: 0,
    }));
    const cells = new Map<string, number>();
    const daily = new Map<string, number>();
    const details = new Map<string, Map<string, { sample: UsageSample; value: number }>>();
    // Hours holding tokens without a price: their cost is unknown, not zero.
    const unpricedHours = new Set<string>();
    for (const sample of samples) {
      const hour = new Date(sample.at).getHours();
      const day = dayKey(sample.at);
      hours[hour].value += sample[metric];
      cells.set(`${day}:${hour}`, (cells.get(`${day}:${hour}`) ?? 0) + sample[metric]);
      daily.set(day, (daily.get(day) ?? 0) + sample[metric]);
      if (metric === "cost" && !sample.priced && sample.tokens > 0)
        unpricedHours.add(`${day}:${hour}`);
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
    return { hours, cells, daily, details, unpricedHours };
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
  const resolutionOptions = (["15m", "hour", "day", "week"] as const).map((value) => ({
    value,
    label: { "15m": t("15 minutes"), hour: t("Hourly"), day: t("Daily"), week: t("Weekly") }[value],
    // A long period is drawn at a coarser step; offer only the steps that are really drawn.
    disabled: effectiveResolution(window, value) !== value,
    disabledReason: t("Too many intervals for this period; pick a coarser step."),
  }));
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
  const hourlyData = intervalMode === "clock" ? hours : intervalBars;
  const hourlyAverage = hourlyData.length
    ? hourlyData.reduce((sum, datum) => sum + datum.value, 0) / hourlyData.length
    : 0;
  const hourlyAverageLabel =
    intervalMode === "clock" ? t("Average per hour of day") : t("Average per interval");
  const hourlyChartLabel = `${intervalMode === "clock" ? t("Hour of day") : t("Usage over time")} · ${metricName(metric)}`;
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
            <div>
              {/* The grouping select beside it names the bars, so the title does not repeat it. */}
              <Heading size="item" level={3}>
                {t("Usage over time")}
              </Heading>
              <Text as="p" leading="inherit" className="usage-muted">
                {metricName(metric)}
                {/* The line chart has no average readout of its own, so the header carries it. */}
                {hourlyKind === "line"
                  ? ` · ${hourlyAverageLabel} ${formatMetric(hourlyAverage, metric)}`
                  : ""}
              </Text>
            </div>
            <div className="usage-controls">
              <UsageChartKindControl panel="hourly" kind={hourlyKind} onChange={setHourlyKind} />
              <Select
                hideLabel
                label={t("Time grouping")}
                value={intervalMode === "clock" ? "clock" : chronologicalResolution}
                onValueChange={(value) => setIntervalMode(value as "clock" | UsageResolution)}
                options={[{ value: "clock", label: t("Hour of day") }, ...resolutionOptions]}
              />
            </div>
          </div>
          {hourlyKind === "line" ? (
            <LineChart
              label={hourlyChartLabel}
              data={hourlyData.map((datum) => ({
                key: datum.key,
                label: datum.label,
                axisLabel: datum.axisLabel,
                values: { value: datum.value },
              }))}
              series={[
                { key: "value", label: metricName(metric), color: "var(--accent)", area: true },
              ]}
              height={HOURLY_LINE_HEIGHT}
              curve="linear"
              legend={false}
              formatValue={(value) => formatMetric(value, metric)}
              formatTick={(value) => formatMetricTick(value, metric)}
            />
          ) : (
            <BarChart
              label={hourlyChartLabel}
              period={`${dateLabel(window.start)} – ${dateLabel(window.end - 1)}`}
              data={hourlyData}
              height={HOURLY_BAR_HEIGHT}
              formatValue={(value) => formatMetric(value, metric)}
              formatTick={(value) => formatMetricTick(value, metric)}
              averageLabel={hourlyAverageLabel}
              valueLabel={metricName(metric)}
            />
          )}
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
              {t("Week {p0} of {p1}", {
                p0: formatNumber(page + 1),
                p1: formatNumber(weekStarts.length),
              })}
              {" · "}
              {metricName(metric)}
            </Text>
          </div>
          <div className="usage-week-nav">
            <Button
              variant="ghost"
              iconOnly
              label={t("Previous week")}
              disabled={page === 0}
              disabledReason={t("This is the first week of the period.")}
              onClick={() => setWeekOffset((value) => value + 1)}
            >
              <ChevronLeft className="icon-sm" />
            </Button>
            <Text as="span" size="caption" tone="secondary" leading="inherit">
              {formatDate(from, { month: "short", day: "numeric", weekday: "short" })} –{" "}
              {formatDate(dates[dates.length - 1], {
                month: "short",
                day: "numeric",
                weekday: "short",
              })}
            </Text>
            <Button
              variant="ghost"
              iconOnly
              label={t("Next week")}
              disabled={page === weekStarts.length - 1}
              disabledReason={t("This is the last week of the period.")}
              onClick={() => setWeekOffset((value) => Math.max(0, value - 1))}
            >
              <ChevronRight className="icon-sm" />
            </Button>
          </div>
        </div>
        <HeatScale className="mt-2" />
        <Text as="p" size="caption" tone="secondary" leading="inherit" className="mt-1">
          {t("Colors are relative to the busiest hour of the period.")}
        </Text>
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
                aria-label={formatDate(date, { weekday: "long", day: "numeric", month: "long" })}
              >
                <Text as="b" size="inherit" tone="primary" weight="medium">
                  {formatDate(date, { weekday: "short" })}
                </Text>
                <span aria-hidden="true">
                  {new Date(date).getDate() === 1 || date === dates[0]
                    ? formatDate(date, { day: "numeric", month: "short" })
                    : formatDate(date, { day: "numeric" })}
                </span>
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
                const state = hourCellState({
                  amount,
                  outside,
                  unpriced: unpricedHours.has(`${dayKey(day)}:${rowIndex}`),
                });
                const when = formatBucket(start.getTime(), "hour");
                const reading =
                  state === "outside"
                    ? t("Outside the selected period.")
                    : state === "unavailable"
                      ? t("Unavailable")
                      : `${state === "partial" ? "≥ " : ""}${formatMetric(amount, metric)}`;
                return (
                  <Button
                    role="gridcell"
                    key={day}
                    variant="item"
                    motion="none"
                    className="usage-hour-cell"
                    textTone={amount > 0 && amount / maximum > 0.75 ? "on-solid" : "primary"}
                    disabled={outside}
                    disabledReason={t("Outside the selected period.")}
                    tabIndex={effectiveFocus === key ? 0 : -1}
                    data-state={state}
                    data-level={
                      state === "outside" || state === "unavailable" || amount === 0
                        ? 0
                        : amount / maximum <= 0.25
                          ? 1
                          : amount / maximum <= 0.5
                            ? 2
                            : amount / maximum <= 0.75
                              ? 3
                              : 4
                    }
                    aria-label={`${when}: ${reading}${outside ? "" : `. ${t("Select to filter to this hour.")}`}`}
                    tooltip={`${when}: ${reading}`}
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
                      // Home/End jump along the row; with Ctrl they jump along the column.
                      const edge = event.ctrlKey || event.metaKey;
                      const rows = hours.length;
                      const columns = dates.length;
                      const move: Record<
                        string,
                        { from: { row: number; column: number }; step: [number, number] }
                      > = {
                        ArrowLeft: { from: { row: rowIndex, column: columnIndex }, step: [0, -1] },
                        ArrowRight: { from: { row: rowIndex, column: columnIndex }, step: [0, 1] },
                        ArrowUp: { from: { row: rowIndex, column: columnIndex }, step: [-1, 0] },
                        ArrowDown: { from: { row: rowIndex, column: columnIndex }, step: [1, 0] },
                        Home: edge
                          ? { from: { row: -1, column: columnIndex }, step: [1, 0] }
                          : { from: { row: rowIndex, column: -1 }, step: [0, 1] },
                        End: edge
                          ? { from: { row: rows, column: columnIndex }, step: [-1, 0] }
                          : { from: { row: rowIndex, column: columns }, step: [0, -1] },
                      };
                      const action = move[event.key];
                      if (!action) return;
                      event.preventDefault();
                      const next = nextSelectableCell(
                        action.from,
                        action.step[0],
                        action.step[1],
                        { rows, columns },
                        (row, column) => !isHourOutside(dates[column], row, window),
                      );
                      if (next === action.from) return;
                      const grid = event.currentTarget.closest('[role="grid"]');
                      const target =
                        grid?.querySelectorAll<HTMLButtonElement>('[role="gridcell"]')[
                          next.row * dates.length + next.column
                        ];
                      target?.focus();
                    }}
                  >
                    <Text size="caption" tone="inherit" leading="inherit" aria-hidden>
                      {state === "unavailable"
                        ? "—"
                        : amount > 0
                          ? `${state === "partial" ? "≥ " : ""}${formatMetricTick(amount, metric)}`
                          : ""}
                    </Text>
                  </Button>
                );
              })}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
