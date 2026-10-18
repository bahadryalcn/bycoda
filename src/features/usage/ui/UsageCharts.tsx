import { useState } from "react";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { SortableDataTable } from "../../../shared/ui/SortableDataTable";
import { formatUsageCost, formatUsageTokens } from "../../providers/model/providerUsage";

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
  if (metric === "cost") return formatUsageCost(value);
  if (metric === "duration") {
    const minutes = Math.floor(value / 60_000);
    return minutes >= 60
      ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
      : minutes > 0
        ? `${minutes}m`
        : `${Math.round(value / 1000)}s`;
  }
  return formatUsageTokens(value);
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
export function PagedUsageTable({
  rows,
  caption,
  metric,
  onSelect,
}: {
  rows: (Record<string, unknown> & { key: string; label: string })[];
  caption: string;
  metric: UsageMetric;
  onSelect?: (key: string) => void;
}) {
  useLocale();
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState({ key: metric as string, direction: "desc" as "asc" | "desc" });
  const total = rows.reduce((n, row) => n + Number(row[metric] ?? 0), 0);
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
  const lastPage = Math.max(0, Math.ceil(rows.length / 20) - 1);
  const current = Math.min(page, lastPage);
  return (
    <>
      <SortableDataTable
        key={`${current}:${sort.key}:${sort.direction}`}
        caption={caption}
        rowKey="key"
        rows={ordered.slice(current * 20, current * 20 + 20)}
        defaultSort={sort}
        onSortChange={(next) => {
          setSort(next);
          setPage(0);
        }}
        columns={[
          {
            key: "label",
            label: t("Name"),
            sortable: true,
            render: (_, row) =>
              onSelect ? (
                <Button variant="link" onClick={() => onSelect(row.key)} title={row.label}>
                  {t(row.label)}
                </Button>
              ) : (
                <span title={row.label}>{t(row.label)}</span>
              ),
          },
          ...(
            [
              "cost",
              "input",
              "output",
              "cacheRead",
              "cacheWrite",
              "tokens",
              ...(metric === "duration" || rows.some((r) => Number(r.duration) > 0)
                ? ["duration"]
                : []),
            ] as UsageMetric[]
          ).map((key) => ({
            key,
            label: t(metricNames[key]),
            numeric: true,
            sortable: true,
            render: (_: unknown, row: Record<string, unknown>) =>
              row[key] == null ||
              (key === "duration" ? row.timedSamples === 0 : row.logSamples === 0) ||
              (key === "cost" &&
                Number(row.unpricedTokens) > 0 &&
                row.unpricedTokens === row.tokens)
                ? "—"
                : `${key === "cost" && Number(row.unpricedTokens ?? row.unpricedTurns ?? 0) > 0 ? "≥ " : ""}${formatMetric(Number(row[key]), key)}`,
          })),
          {
            key: "share",
            label: t("Share"),
            numeric: true,
            render: (_, row) =>
              `${total ? ((Number(row[metric]) / total) * 100).toFixed(1) : "0"}%`,
          },
        ]}
      />
      <div className="usage-pagination">
        <span>
          {rows.length.toLocaleString(getLocale())} {t("records")} · {current + 1}/{lastPage + 1}
        </span>
        <Button variant="ghost" disabled={current === 0} onClick={() => setPage(current - 1)}>
          {t("Previous")}
        </Button>
        <Button
          variant="ghost"
          disabled={current === lastPage}
          onClick={() => setPage(current + 1)}
        >
          {t("Next")}
        </Button>
      </div>
    </>
  );
}
