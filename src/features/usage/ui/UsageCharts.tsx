import { useState } from "react";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { SortableDataTable } from "../../../shared/ui/SortableDataTable";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";

import type { UsageMetric, UsageResolution } from "../model/usageAnalytics";

export const metricNames: Record<UsageMetric, string> = {
  cost: "Estimated cost",
  tokens: "Total tokens",
  input: "Uncached input",
  output: "Output",
  cacheRead: "Cache read",
  cacheWrite: "Cache write",
  duration: "Agent time",
};
export function formatMetric(value: number, metric: UsageMetric): string {
  if (metric === "cost")
    return new Intl.NumberFormat(getLocale(), {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  if (metric === "duration") {
    const minutes = Math.floor(value / 60_000);
    return minutes >= 60
      ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
      : minutes > 0
        ? `${minutes}m`
        : `${Math.round(value / 1000)}s`;
  }
  return new Intl.NumberFormat(getLocale(), {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
export function formatUsagePercent(value: number): string {
  return new Intl.NumberFormat(getLocale(), {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value / 100);
}
/** Axis space is bounded; tooltips and tables keep the exact formatted value. */
export function formatMetricTick(value: number, metric: UsageMetric): string {
  if (metric !== "cost") return formatMetric(value, metric);
  return new Intl.NumberFormat(getLocale(), {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
export function formatBucket(at: number, resolution: UsageResolution): string {
  return new Date(at).toLocaleString(
    getLocale(),
    resolution === "15m" || resolution === "hour"
      ? {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZoneName: "shortOffset",
        }
      : { month: "short", day: "numeric", year: "numeric" },
  );
}
export function ContinuousUsageTable({
  rows,
  caption,
  metric,
  onSelect,
  stateKey,
}: {
  rows: (Record<string, unknown> & { key: string; label: string })[];
  caption: string;
  metric: UsageMetric;
  onSelect?: (key: string) => void;
  stateKey?: string;
}) {
  useLocale();
  const tableKey = stateKey ?? `usage:${caption}`;
  const [allMetrics, setAllMetrics] = useState(false);
  const [sort, setSort] = useRetainedState(`${tableKey}:sort`, {
    key: metric as string,
    direction: "desc" as "asc" | "desc",
  });
  const available = (row: Record<string, unknown>, key: UsageMetric) =>
    row[key] != null &&
    Number.isFinite(Number(row[key])) &&
    !(key === "duration"
      ? row.timedSamples === 0 || row.timedTurns === 0
      : row.logSamples === 0 || row.meteredTurns === 0) &&
    !(key === "cost" && Number(row.unpricedTokens) > 0 && row.unpricedTokens === row.tokens);
  const total = rows.reduce((n, row) => n + (available(row, metric) ? Number(row[metric]) : 0), 0);
  const ordered = [...rows].sort((a, b) => {
    const av = a[sort.key],
      bv = b[sort.key];
    return (
      (typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av ?? "").localeCompare(String(bv ?? ""), getLocale())) *
      (sort.direction === "asc" ? 1 : -1)
    );
  });
  return (
    <>
      <div className="usage-section-heading">
        <span className="usage-muted">
          {rows.length.toLocaleString(getLocale())} {t("records")}
        </span>
        <Button
          variant="ghost"
          aria-expanded={allMetrics}
          onClick={() => {
            setAllMetrics(!allMetrics);
            if (allMetrics) setSort({ key: metric, direction: "desc" });
          }}
        >
          {t(allMetrics ? "Show fewer metrics" : "Show all metrics")}
        </Button>
      </div>
      <SortableDataTable
        key={tableKey}
        scrollKey={tableKey}
        caption={caption}
        rowKey="key"
        rows={ordered}
        defaultSort={sort}
        sortState={sort}
        onSortChange={setSort}
        columns={[
          {
            key: "label",
            label: t("Name"),
            sortable: true,
            render: (_, row) =>
              onSelect ? (
                <Button variant="link" onClick={() => onSelect(row.key)}>
                  {t(row.label)}
                </Button>
              ) : (
                <span>{t(row.label)}</span>
              ),
          },
          ...(
            (allMetrics
              ? [
                  "cost",
                  "input",
                  "output",
                  "cacheRead",
                  "cacheWrite",
                  "tokens",
                  ...(metric === "duration" || rows.some((r) => Number(r.duration) > 0)
                    ? ["duration"]
                    : []),
                ]
              : [...new Set([metric, "cost", "tokens"])]) as UsageMetric[]
          ).map((key) => ({
            key,
            label: t(metricNames[key]),
            numeric: true,
            sortable: true,
            render: (_: unknown, row: Record<string, unknown>) =>
              !available(row, key)
                ? "—"
                : `${key === "cost" && Number(row.unpricedTokens ?? row.unpricedTurns ?? 0) > 0 ? "≥ " : ""}${formatMetric(Number(row[key]), key)}`,
          })),
          {
            key: "share",
            label: t("Share"),
            numeric: true,
            render: (_, row) =>
              available(row, metric) &&
              !(
                metric === "cost" &&
                rows.some((entry) => Number(entry.unpricedTokens ?? entry.unpricedTurns ?? 0) > 0)
              )
                ? formatUsagePercent(total ? (Number(row[metric]) / total) * 100 : 0)
                : "—",
          },
        ]}
      />
    </>
  );
}
