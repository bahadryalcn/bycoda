import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { ModelLabel } from "../../sessions/public/ModelLabel";
import { modelDisplayName } from "../../sessions/public/modelDisplayName";
import { useState, type ReactNode } from "react";
import { formatDate, formatNumber, getLocale, t, useLocale } from "../../../shared/i18n";
import { compactNumberDisplay, formatUnambiguousCompact } from "../../../shared/i18n/format";
import { Button } from "../../../shared/ui/Button";
import { Text } from "../../../shared/ui/Text";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { SortableDataTable } from "../../../shared/ui/SortableDataTable";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { UsageProviderIdentity, usageLabel } from "./UsageProviderIdentity";

import type { UsageMetric, UsageResolution } from "../model/usageAnalytics";

export function metricName(metric: UsageMetric): string {
  switch (metric) {
    case "cost":
      return t("Estimated cost");
    case "tokens":
      return t("Total tokens");
    case "input":
      return t("Uncached input");
    case "output":
      return t("Output");
    case "cacheRead":
      return t("Cache read");
    case "cacheWrite":
      return t("Cache write");
    case "duration":
      return t("Agent time");
  }
}
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
    const integer = (count: number) =>
      formatNumber(count, { maximumFractionDigits: 0, useGrouping: false });
    return minutes >= 60
      ? t("{p0}h {p1}m", { p0: integer(Math.floor(minutes / 60)), p1: integer(minutes % 60) })
      : minutes > 0
        ? t("{p0}m", { p0: integer(minutes) })
        : t("{p0}s", { p0: integer(Math.round(value / 1000)) });
  }
  return formatUnambiguousCompact(value);
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
  // Currency compact notation ignores the long form, so ambiguous locales add the symbol themselves.
  if (compactNumberDisplay() === "long") return "$" + formatUnambiguousCompact(value);
  return formatNumber(value, {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  });
}
export function formatBucket(at: number, resolution: UsageResolution): string {
  return formatDate(
    at,
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
  heading,
  actions,
}: {
  rows: (Record<string, unknown> & { key: string; label: string })[];
  caption: string;
  metric: UsageMetric;
  onSelect?: (key: string) => void;
  stateKey?: string;
  /** Leading content of the single header row (a title), before the record count. */
  heading?: ReactNode;
  /** Trailing actions of the header row, before "Show all metrics". */
  actions?: ReactNode;
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
  const allKeys = [
    "cost",
    "input",
    "output",
    "cacheRead",
    "cacheWrite",
    "tokens",
    ...(metric === "duration" || rows.some((r) => Number(r.duration) > 0) ? ["duration"] : []),
  ] as UsageMetric[];
  // The default view omits a column no row has a value for (every cell would read "—").
  const visibleKeys = [...new Set<UsageMetric>([metric, "cost", "tokens"])].filter(
    (key) => key === metric || rows.some((row) => available(row, key)),
  );
  const columnKeys = allMetrics ? allKeys : visibleKeys;
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
    // Several providers on one row (a project used by both) say nothing about the row itself.
    return (
      <span className="flex min-w-0 items-center gap-2">
        {providers.length === 1 && (
          <UsageProviderIdentity key={providers[0]} provider={providers[0]} label="" />
        )}
        <span>{usageLabel(row.label)}</span>
      </span>
    );
  };
  return (
    <>
      <div className="usage-section-heading">
        <div className="flex min-w-0 items-center gap-2">
          {heading}
          <Text as="span" leading="inherit" className="usage-muted">
            {rows.length === 1
              ? t("1 record")
              : t("{p0} records", { p0: formatNumber(rows.length) })}
          </Text>
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={allMetrics}
            onClick={() => {
              setAllMetrics(!allMetrics);
              // Hiding the extra columns must not leave the table sorted by a column that is gone.
              if (allMetrics && !visibleKeys.includes(sort.key as UsageMetric))
                setSort({ key: metric, direction: "desc" });
            }}
          >
            {allMetrics ? t("Show fewer metrics") : t("Show all metrics")}
          </Button>
        </div>
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
          ...columnKeys.map((key) => ({
            key,
            label: metricName(key),
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
                  label: t("Share of total"),
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
                  label: modelDisplayName(model),
                  icon: <ModelLabel model={model} iconOnly size="xs" />,
                }))}
              />
            </div>
            <p>{t("Their tokens are included; their cost is unavailable.")}</p>
          </>
        )}
        {pricesUnavailable && (
          <p>{t("OpenRouter prices could not be loaded, so built-in prices are used.")}</p>
        )}
        {/* A failed read of the session logs is reported once, in the notice above the results. */}
        {sessionDurationUnavailable ? null : (
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
      {/* The trigger never stands alone: a visible name says what the icon opens. */}
      <Text as="span" leading="inherit" className="usage-muted">
        {t("Data sources and coverage")}
        {unpriced.length > 0 && ` · ${t("Models without prices")}: ${unpriced.length}`}
      </Text>
    </Text>
  );
}
