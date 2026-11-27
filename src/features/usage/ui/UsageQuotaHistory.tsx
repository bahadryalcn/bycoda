import { Tooltip } from "../../../shared/ui/Tooltip";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { useState, type CSSProperties } from "react";
import { formatDate, formatNumber, t, useLocale } from "../../../shared/i18n";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Heading } from "../../../shared/ui/Heading";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Select } from "../../../shared/ui/Select";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { SortableDataTable } from "../../../shared/ui/SortableDataTable";
import {
  accountDisplayLabel,
  providerAccountColorValue,
  type ProviderAccount,
} from "../../providers/public/providerAccounts";
import { useRateLimitHistory } from "../../providers/public/rateLimitHistory";
import {
  formatQuotaPercent,
  formatResetDuration,
  rateLimitWindowNameWith,
  type RateLimitWindowKind,
} from "../../providers/public/rateLimitsCache";
import { useShowRemainingUsage } from "../../settings/model/displayPrefs";
import type { UsageFilters, UsageWindow } from "../model/usageAnalytics";
import { quotaLineSegments, quotaPlotDomain, quotaPlotPoints } from "../model/quotaPlotPoints";
import { useUsageChartKind } from "../model/usageChartKinds";
import { UsageProviderIdentity, usageProviderLabel } from "./UsageProviderIdentity";
import { HarnessIcon } from "../../../shared/ui/identity/HarnessIcon";

const accountKey = (account: ProviderAccount) => `${account.provider}:${account.id}`;
const KINDS: readonly RateLimitWindowKind[] = ["session", "weekly", "monthly"];
const THREE_DAYS = 3 * 86_400_000;
const observationTime = (value: number) =>
  formatDate(value, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  });
/** Axis ticks: the date, plus the time while the span is short. */
const axisTime = (value: number, span: number) =>
  span < THREE_DAYS
    ? formatDate(value, { month: "short", day: "numeric", hour: "numeric", minute: "numeric" })
    : formatDate(value, { dateStyle: "medium" });
/** Exact reading for tooltips and the table; rows and the legend use `formatQuotaPercent`. */
const exactPercent = (value: number) =>
  `${formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

export function QuotaHistory({
  window,
  filters,
  accounts,
}: {
  window: UsageWindow;
  filters: UsageFilters;
  accounts: ProviderAccount[];
}) {
  useLocale();
  const history = useRateLimitHistory();
  const showRemaining = useShowRemainingUsage();
  const [selectedKind, setKind] = useState<string | null>(null);
  const [account, setAccount] = useState("");
  const [chartKind, setChartKind] = useUsageChartKind("quotaHistory");
  // The shared Disclosure keeps closed bodies mounted, so the table is only built while open.
  const [tableOpen, setTableOpen] = useState(false);
  const knownAccounts = accounts.filter(
    (a) =>
      (!filters.provider.length || filters.provider.includes(a.provider)) &&
      (!filters.account.length || filters.account.includes(`${a.provider}:${a.id}`)),
  );
  const accountLabel = (account: ProviderAccount) =>
    `${usageProviderLabel(account.provider)} · ${accountDisplayLabel(account, accounts)}`;
  // Samples are used-based; the remaining toggle only changes what is shown.
  const shownValue = (used: number) => (showRemaining ? 100 - used : used);
  const unitLabel = showRemaining ? t("Remaining (%)") : t("Used (%)");
  const key = knownAccounts.some((a) => accountKey(a) === account) ? account : "";
  const visibleAccounts = knownAccounts.filter((a) => !key || accountKey(a) === key);
  const accountMap = new Map(visibleAccounts.map((a) => [accountKey(a), a]));
  const samples = history.filter(
    (sample) =>
      accountMap.has(sample.account) && sample.at >= window.start && sample.at < window.end,
  );
  const counts = new Map<string, number>();
  for (const sample of samples) counts.set(sample.kind, (counts.get(sample.kind) ?? 0) + 1);
  // Default to the weekly window, else the one with most readings; a pick without readings yields to it.
  const defaultKind = counts.has("weekly")
    ? "weekly"
    : ([...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "session");
  const kind = selectedKind && counts.has(selectedKind) ? selectedKind : defaultKind;
  const kindOptions = KINDS.filter((k) => counts.has(k) || k === kind);
  const rows = samples.filter((s) => s.kind === kind);
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (row.at >= (latest.get(row.account)?.at ?? -Infinity)) latest.set(row.account, row);
  }
  // The axis starts at the first reading: history only exists since collection began.
  const domain = quotaPlotDomain(rows, window);
  const span = domain.end - domain.start;
  const axisTicks = [domain.start, domain.start + span / 2, domain.end];
  // The plot is bounded to one reading per account and column; the table and legend keep every sample.
  const plotted = quotaPlotPoints(rows, domain);
  // Lines join only real consecutive readings; resets and long gaps break them.
  const segments = chartKind === "line" ? quotaLineSegments(plotted) : [];
  const timePercent = (at: number) => (span > 0 ? ((at - domain.start) / span) * 100 : 0);
  const latestSummary = visibleAccounts
    .flatMap((a) => {
      const sample = latest.get(accountKey(a));
      return sample ? [`${accountLabel(a)} ${formatQuotaPercent(shownValue(sample.used))}`] : [];
    })
    .join(", ");
  return (
    <section
      {...surfaceAttributes(
        { frame: "card", edge: "all", radius: "card", variant: "card" },
        "usage-panel",
      )}
    >
      <div className="usage-section-heading">
        <div className="flex items-center gap-2">
          <Heading size="item" level={2}>
            {t("Limit history")}
          </Heading>
          <InfoPopover label={t("About limit history")}>
            {t(
              "Actual account-wide readings, collected when limits refresh. History starts with collection; gaps and resets are not interpolated. Project and model filters do not apply to account quotas.",
            )}
          </InfoPopover>
        </div>
        <div className="usage-controls">
          <SegmentedControl
            size="sm"
            label={t("Chart type")}
            value={chartKind}
            onValueChange={(next) => setChartKind(next === "line" ? "line" : "points")}
            options={[
              { value: "points", label: t("Points") },
              { value: "line", label: t("Line") },
            ]}
          />
          <SearchableSelect
            hideLabel
            label={t("Account")}
            value={key}
            onChange={setAccount}
            options={[
              { value: "", label: t("All accounts") },
              ...knownAccounts.map((a) => ({
                value: accountKey(a),
                label: accountLabel(a),
                icon: <HarnessIcon harness={a.provider} size="sm" />,
              })),
            ]}
          />
          <Select
            hideLabel
            label={t("Limit window")}
            value={kind}
            onValueChange={setKind}
            options={kindOptions.map((k) => ({
              value: k,
              label: rateLimitWindowNameWith(k, t),
            }))}
          />
        </div>
      </div>
      <Text as="div" size="caption" tone="inherit" leading="inherit" className="usage-quota-legend">
        {visibleAccounts.map((a) => {
          const sample = latest.get(accountKey(a));
          return (
            <div
              className="usage-quota-legend-item"
              key={accountKey(a)}
              data-account={accountKey(a)}
            >
              <span
                aria-hidden
                {...surfaceAttributes(
                  { radius: "pill", variant: "user-color" },
                  "usage-quota-legend-dot",
                )}
                style={{ "--surface-user-color": providerAccountColorValue(a) } as CSSProperties}
              />
              <UsageProviderIdentity provider={a.provider} label={accountLabel(a)} />
              <Text size="inherit" tone="secondary" className="usage-quota-legend-value">
                {sample ? formatQuotaPercent(shownValue(sample.used)) : t("No records")}
              </Text>
              <Text size="inherit" tone="muted" className="usage-quota-legend-time">
                {sample ? observationTime(sample.at) : null}
              </Text>
            </div>
          );
        })}
      </Text>
      {rows.length ? (
        <>
          <div
            {...surfaceAttributes({ frame: "pane", edge: "block" }, "usage-quota-plot")}
            role="img"
            aria-label={`${t("Limit history")} (${unitLabel}): ${rows.length} ${t("recorded samples")}${latestSummary ? `. ${latestSummary}` : ""}`}
          >
            <Text size="caption" tone="secondary" leading="inherit" className="usage-quota-max">
              100%
            </Text>
            <Text size="caption" tone="secondary" leading="inherit" className="usage-quota-zero">
              0%
            </Text>
            {segments.length ? (
              <svg
                aria-hidden
                className="usage-quota-lines"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                {segments.map((segment) => {
                  const segmentAccount = accountMap.get(segment[0]!.account)!;
                  return (
                    <polyline
                      key={`${segment[0]!.account}:${segment[0]!.at}`}
                      className="usage-quota-line"
                      style={
                        {
                          "--usage-line-color": providerAccountColorValue(segmentAccount),
                        } as CSSProperties
                      }
                      points={segment
                        .map((r) => `${timePercent(r.at)},${100 - shownValue(r.used)}`)
                        .join(" ")}
                    />
                  );
                })}
              </svg>
            ) : null}
            {plotted.map((row) => {
              const rowAccount = accountMap.get(row.account)!;
              return (
                <Tooltip
                  key={`${row.account}:${row.kind}:${row.at}`}
                  label={`${accountLabel(rowAccount)} · ${observationTime(row.at)}: ${exactPercent(shownValue(row.used))}`}
                  asChild
                >
                  <span
                    {...surfaceAttributes({ variant: "user-color" }, "usage-quota-point")}
                    style={
                      {
                        "--surface-user-color": providerAccountColorValue(rowAccount),
                        "--usage-point-time": `${timePercent(row.at)}%`,
                        "--usage-point-value": `${shownValue(row.used)}%`,
                      } as CSSProperties
                    }
                  />
                </Tooltip>
              );
            })}
          </div>
          <Text as="p" leading="inherit" className="usage-quota-axis usage-muted">
            {axisTicks.map((tick, index) => (
              <span key={index}>{axisTime(tick, span)}</span>
            ))}
          </Text>
          <Text as="p" size="caption" tone="muted" leading="inherit" className="usage-quota-unit">
            {unitLabel}
          </Text>
          <Disclosure
            size="sm"
            summary={t("Show as table")}
            open={tableOpen}
            onOpenChange={setTableOpen}
          >
            {tableOpen ? (
              <Text as="div" leading="inherit">
                <div
                  className="usage-history-table"
                  role="region"
                  aria-label={t("Limit history")}
                  tabIndex={0}
                >
                  <SortableDataTable
                    caption={t("Limit history")}
                    rowKey="key"
                    rows={rows
                      .slice(-100)
                      .reverse()
                      .map((s) => ({
                        key: `${s.account}:${s.kind}:${s.at}`,
                        account: accountLabel(accountMap.get(s.account)!),
                        at: s.at,
                        time: s.at,
                        used: shownValue(s.used),
                        minutes: s.minutes,
                        reset: s.resetsAt ?? null,
                      }))}
                    columns={[
                      { key: "account", label: t("Account") },
                      {
                        key: "time",
                        label: t("Time"),
                        render: (v) => observationTime(Number(v)),
                      },
                      {
                        key: "used",
                        label: unitLabel,
                        numeric: true,
                        render: (v) => exactPercent(Number(v)),
                      },
                      {
                        key: "minutes",
                        label: t("Window"),
                        numeric: true,
                        render: (value) => formatResetDuration(Number(value) * 60_000),
                      },
                      {
                        key: "reset",
                        label: t("Reset"),
                        render: (v) =>
                          v == null ? t("Reset time unavailable") : observationTime(Number(v)),
                      },
                    ]}
                  />
                </div>
                {rows.length > 100 ? (
                  <Text as="p" size="caption" tone="muted" leading="inherit">
                    {t("Showing the latest {p0} of {p1} readings.", { p0: 100, p1: rows.length })}
                  </Text>
                ) : null}
              </Text>
            ) : null}
          </Disclosure>
        </>
      ) : (
        <EmptyState size="inline" description={t("No limit history yet")} />
      )}
    </section>
  );
}
