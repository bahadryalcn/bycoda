import { createLibrary, defineComponent, Renderer } from "@openuidev/react-lang";
import { createContext, useContext, useState } from "react";
import { z } from "zod";
import { formatNumber, useT } from "../../../shared/i18n";
import { BarChart } from "../../../shared/ui/Charts";
import { Button } from "../../../shared/ui/Button";
import { Heading } from "../../../shared/ui/Heading";
import { StatRow, StatTile } from "../../../shared/ui/StatTile";
import { StatusText } from "../../../shared/ui/StatusText";
import { Text } from "../../../shared/ui/Text";
import { openUsageDashboard } from "../data/openUsageDashboard";
import type { UsageReport, UsageReportRow } from "../model/usageReport";
import { usageIntentFor } from "../model/usageViewIntent";
import { formatMetric } from "./UsageCharts";

const ReportContext = createContext<UsageReport | undefined>(undefined);

/** One bar per row; the aggregated tail says how many rows it stands for. */
function ReportChart({
  report,
  rows,
  title,
  category,
}: {
  report: UsageReport;
  rows: readonly { key: string; label: string; value: number; grouped?: number }[];
  title: string;
  category: string;
}) {
  const t = useT();
  if (rows.length === 0) return null;
  const data = rows.map((row) => {
    const label =
      row.key === "other"
        ? `${t("Other")} · ${formatNumber(row.grouped ?? 0)}`
        : row.key.trim()
          ? row.label
          : t("Unknown");
    return { key: row.key, axisLabel: label, label, value: row.value };
  });
  return (
    <section>
      <Heading as="h4" size="section">
        {title}
      </Heading>
      <BarChart
        data={data}
        label={title}
        period=""
        categoryLabel={category}
        showAverage={false}
        formatValue={(value) => formatMetric(value, report.metric)}
        height={168}
      />
    </section>
  );
}

const values = (report: UsageReport, rows: readonly UsageReportRow[]) =>
  rows.map((row) => ({
    key: row.key,
    label: row.label,
    value: row[report.metric],
    grouped: row.grouped,
  }));

const UsageReportLayout = defineComponent({
  name: "UsageReport",
  description:
    "Real usage totals for one dashboard window: providers, models and, for a history, months.",
  props: z.object({}),
  component: function UsageReportLayoutView() {
    const report = useContext(ReportContext);
    const [openFailed, setOpenFailed] = useState(false);
    const t = useT();
    if (!report) return null;
    const periodNames = {
      "month-to-date": t("This month"),
      "last-30-days": t("Last 30 days"),
      "monthly-history": t("Monthly"),
    };
    const { totals } = report;
    return (
      <article className="grid min-w-0 gap-3 [overflow-wrap:anywhere]">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <Heading as="h3" size="section">
            {`${t("Usage")} · ${periodNames[report.period]}`}
          </Heading>
          <div className="flex items-center gap-2">
            {report.coverage.partial ? (
              <StatusText tone="needs-you">{t("Partial")}</StatusText>
            ) : null}
            {/* The dashboard opens with this report's window, filters, metric and granularity. */}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setOpenFailed(false);
                void openUsageDashboard(usageIntentFor(report))
                  .then(({ filtersApplied }) => setOpenFailed(!filtersApplied))
                  .catch(() => setOpenFailed(true));
              }}
            >
              {t("Open")}
            </Button>
          </div>
        </div>
        <StatRow label={t("Usage")}>
          <StatTile
            label={t("Estimated cost")}
            value={`${totals.unpricedTokens > 0 ? "≥ " : ""}${formatMetric(totals.cost, "cost")}`}
          />
          <StatTile label={t("Tokens")} value={formatMetric(totals.tokens, "tokens")} />
        </StatRow>
        {openFailed ? (
          <StatusText tone="needs-you">{t("Could not show this report in Usage.")}</StatusText>
        ) : null}
        {report.months ? (
          <ReportChart
            report={report}
            rows={report.months.map((month) => ({
              key: month.key,
              label: month.key,
              value: month[report.metric],
            }))}
            title={t("Monthly")}
            category={t("Month")}
          />
        ) : null}
        <ReportChart
          report={report}
          rows={values(report, report.providers).filter((row) => row.value > 0)}
          title={t("Providers")}
          category={t("Provider")}
        />
        <ReportChart
          report={report}
          rows={values(report, report.models).filter((row) => row.value > 0)}
          title={t("Models")}
          category={t("Model")}
        />
        {report.providers.length === 0 && report.models.length === 0 ? (
          <Text tone="secondary">{t("No records")}</Text>
        ) : null}
      </article>
    );
  },
});

const library = createLibrary({ components: [UsageReportLayout], root: "UsageReport" });

/** The program carries no data: every figure enters through React context, never model text. */
export default function UsageReportView({ report }: { report: UsageReport }) {
  return (
    <ReportContext.Provider value={report}>
      <Renderer library={library} response="root = UsageReport()" />
    </ReportContext.Provider>
  );
}
