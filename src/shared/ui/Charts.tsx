import { useLocale, useT } from "../i18n";
import { LineChart as ArcLineChart, type LineChartProps } from "./arc/line-chart/line-chart";
import { BarChart as ArcBarChart, type BarChartProps } from "./arc/bar-chart/bar-chart";
import { DonutChart as ArcDonutChart, type DonutChartProps } from "./arc/donut-chart/donut-chart";
import {
  ActivityHeatmap as ArcActivityHeatmap,
  type ActivityHeatmapProps,
} from "./arc/activity-heatmap/activity-heatmap";

export type { LineChartDatum, LineChartSeries } from "./arc/line-chart/line-chart";
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
export function BarChart(props: BarChartProps) {
  const t = useT();
  return (
    <div className="bycoda-arc bycoda-arc-chart">
      <ArcBarChart
        categoryLabel={t("Time")}
        averageLabel={t("Average")}
        valueLabel={t("Value")}
        {...props}
      />
    </div>
  );
}
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
