import { useLocale, useT } from "../i18n";
import { LineChart as ArcLineChart, type LineChartProps } from "./arc/line-chart/line-chart";
import { BarChart as ArcBarChart, type BarChartProps } from "./arc/bar-chart/bar-chart";
import { DonutChart as ArcDonutChart, type DonutChartProps } from "./arc/donut-chart/donut-chart";
import {
  ActivityHeatmap as ArcActivityHeatmap,
  type ActivityHeatmapProps,
} from "./arc/activity-heatmap/activity-heatmap";

export type { LineChartDatum, LineChartSeries } from "./arc/line-chart/line-chart";
export type { BarChartDatum } from "./arc/bar-chart/bar-chart";
/**
 * Bounded time-series trends with configured series colours, localized units, series toggles and a table alternative. Wraps the Arc chart with translated empty/series labels.
 * @group data
 * @use Trends over time with one or more series.
 * @avoid Part-of-whole: DonutChart. Category comparison: BarChart. Daily activity grid: ActivityHeatmap.
 * @arc line-chart
 */
export function LineChart(props: LineChartProps) {
  const t = useT();
  return (
    <ArcLineChart
      emptyLabel={t("No records")}
      selectSeriesLabel={t("Choose a series to show")}
      categoryLabel={t("Time")}
      {...props}
      className={["bycoda-arc bycoda-arc-chart", props.className].filter(Boolean).join(" ")}
    />
  );
}
/**
 * Category or time bar chart with average line and a table alternative. Wraps the Arc chart with translated labels and a shrinkable container.
 * @group data
 * @use Comparing values across categories or buckets.
 * @avoid Continuous trend: LineChart. Shares of a whole: DonutChart.
 * @arc bar-chart
 */
export function BarChart(props: BarChartProps) {
  const t = useT();
  return (
    <div className="bycoda-arc bycoda-arc-chart min-w-0">
      <ArcBarChart
        categoryLabel={t("Time")}
        averageLabel={t("Average")}
        valueLabel={t("Value")}
        seriesColumnLabel={t("Series")}
        {...props}
      />
    </div>
  );
}
/**
 * Part-of-whole ring with total, "Other" grouping and empty label. Sizes to its container.
 * @group data
 * @use Shares of a total across a few segments.
 * @avoid Many categories or exact comparison: BarChart. Trend: LineChart.
 * @arc donut-chart
 */
export function DonutChart(props: DonutChartProps) {
  const t = useT();
  return (
    <div style={{ containerType: "inline-size", minInlineSize: 0 }}>
      <ArcDonutChart
        emptyLabel={t("No records")}
        otherLabel={t("Other")}
        totalLabel={t("Total")}
        {...props}
        className={["bycoda-arc bycoda-arc-chart", props.className].filter(Boolean).join(" ")}
      />
    </div>
  );
}
/**
 * Calendar-style grid of daily activity intensity with less/more legend; weeks start Monday and the locale follows the app.
 * @group data
 * @use Per-day activity over weeks or months.
 * @avoid Precise values or series: BarChart or LineChart.
 * @arc activity-heatmap
 */
export function ActivityHeatmap(props: ActivityHeatmapProps) {
  const t = useT();
  const locale = useLocale();
  return (
    <ArcActivityHeatmap
      locale={locale}
      weekStartsOn={1}
      lessLabel={t("Less")}
      moreLabel={t("More")}
      {...props}
      className={["bycoda-arc bycoda-arc-chart", props.className].filter(Boolean).join(" ")}
    />
  );
}
