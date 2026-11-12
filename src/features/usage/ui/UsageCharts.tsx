import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { useState } from "react";
import { formatNumber, getLocale, t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Text } from "../../../shared/ui/Text";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { SortableDataTable } from "../../../shared/ui/SortableDataTable";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { UsageProviderIdentity } from "./UsageProviderIdentity";

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
    return formatNumber(value, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  if (metric === "duration") {
    const minutes = Math.floor(value / 60_000);
    return minutes >= 60
      ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
      : minutes > 0
        ? `${minutes}m`
        : `${Math.round(value / 1000)}s`;
  }
  return formatNumber(value, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
}
export function formatUsagePercent(value: number): string {
  return formatNumber(value / 100, {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}
/** Axis space is bounded; tooltips and tables keep the exact formatted value. */
export function formatMetricTick(value: number, metric: UsageMetric): string {
  if (metric !== "cost") return formatMetric(value, metric);
  return formatNumber(value, {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  });
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
  // A share needs a complete denominator; unpriced cost rows make every share unknown.
  const shareKnown = (row: Record<string, unknown>) =>
    available(row, metric) &&
    !(
      metric === "cost" &&
      rows.some((entry) => Number(entry.unpricedTokens ?? entry.unpricedTurns ?? 0) > 0)
    );
  const showShare = rows.some(shareKnown);
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
  const name = (row: (typeof rows)[number]) => {
    const providers = Array.isArray(row.providers)
      ? row.providers.filter((provider): provider is string => typeof provider === "string")
      : typeof row.provider === "string"
        ? row.provider.split("·")
        : [];
    if (providers.length === 1 && row.label === providers[0])
      return <UsageProviderIdentity provider={providers[0]} />;
    return (
      <span className="flex min-w-0 items-center gap-2">
        {providers.map((provider) => (
          <UsageProviderIdentity key={provider} provider={provider} label="" />
        ))}
        <span>{t(row.label)}</span>
      </span>
    );
  };
  return (
    <>
      <div className="usage-section-heading">
        <Text as="span" leading="inherit" className="usage-muted">
          {rows.length.toLocaleString(getLocale())} {t("records")}
        </Text>
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
                  {name(row)}
                </Button>
              ) : (
                name(row)
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
          ...(showShare
            ? [
                {
                  key: "share",
                  label: t("Share"),
                  numeric: true,
                  render: (_: unknown, row: Record<string, unknown>) =>
                    shareKnown(row)
                      ? formatUsagePercent(total ? (Number(row[metric]) / total) * 100 : 0)
                      : "—",
                },
              ]
            : []),
        ]}
      />
    </>
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
    <Text as="div" leading="relaxed" className="usage-data-notes flex items-center gap-2">
      <InfoPopover label={t("Data sources and coverage")}>
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
            {t("Session duration data is unavailable on this app version or could not be read.")}
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
      </InfoPopover>
      {unpriced.length > 0 && (
        <Text as="span" leading="inherit" className="usage-muted">
          {t("Models without prices")}: {unpriced.length}
        </Text>
      )}
    </Text>
  );
}
