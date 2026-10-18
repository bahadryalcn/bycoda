import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale, getLocale } from "../../../shared/i18n";
import { RefreshCw, ListFilter } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import { useEffect, useMemo, useRef, useState } from "react";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import {
  createUsagePricing,
  fetchModelPrices,
  fetchProviderUsage,
  formatUsageCost,
  formatUsageTokens,
  summarizeUsage,
  usageBreakdown,
  usageDays,
  USAGE_MAX_DAYS,
  type AccountUsage,
  type ModelPrices,
  type UsageBreakdown,
  type UsageDay,
} from "../../providers/model/providerUsage";

import { HARNESS_TITLE } from "../../sessions/model/session";

import {
  providerAccounts,
  PROVIDER_ACCOUNT_PROVIDERS,
  subscribeProviderAccounts,
  type ProviderAccount,
} from "../../providers/model/providerAccounts";

import { identityKey } from "../../providers/model/providerAccountIdentity";

import { Group, Segmented } from "./settingsControls";

export type UsageRange = "7d" | "30d";
export type UsageMetric = "tokens" | "cost";
export const USAGE_RANGE_DAYS: Record<UsageRange, number> = {
  "7d": 7,
  "30d": 30,
};
export const ALL_USAGE_ACCOUNTS = "all";

export type UsageLoad =
  | { status: "loading" }
  | { status: "ready"; usage: AccountUsage[]; failed: string[] };

export function usageAccountLabel(account: ProviderAccount): string {
  return `${HARNESS_TITLE[account.provider]} · ${account.label}`;
}

export function ProviderUsageSettings({
  showSummary = true,
  refresh = 0,
}: {
  showSummary?: boolean;
  refresh?: number;
}) {
  useLocale();
  const [version, setVersion] = useState(0);
  const [reload, setReload] = useState(0);
  const [load, setLoad] = useState<UsageLoad>({ status: "loading" });
  // True while a scan runs, including reloads that keep the last results shown.
  const [refreshing, setRefreshing] = useState(true);
  const [accountKey, setAccountKey] = useState(ALL_USAGE_ACCOUNTS);
  const [range, setRange] = useState<UsageRange>("7d");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterAnchor = useRef<HTMLButtonElement>(null);
  const [metric, setMetric] = useState<UsageMetric>("tokens");
  const [breakdown, setBreakdown] = useState<UsageBreakdown>("model");
  // undefined while loading; null when OpenRouter and the cached copy both fail.
  const [prices, setPrices] = useState<ModelPrices | null | undefined>();

  useEffect(() => subscribeProviderAccounts(() => setVersion((value) => value + 1)), []);

  useEffect(() => {
    let cancelled = false;
    void fetchModelPrices().then((next) => {
      if (!cancelled) setPrices(next);
    });
    return () => {
      cancelled = true;
    };
  }, [reload, refresh]);

  const pricing = useMemo(() => createUsagePricing(prices?.models), [prices]);

  const accounts = useMemo(() => PROVIDER_ACCOUNT_PROVIDERS.flatMap(providerAccounts), [version]);

  useEffect(() => {
    let cancelled = false;
    setRefreshing(true);
    setLoad((current) => (current.status === "ready" ? current : { status: "loading" }));
    const since = usageDays(USAGE_MAX_DAYS, new Date())[0].getTime();
    void Promise.all(
      accounts.map(async (account) => {
        try {
          return {
            account,
            report: await fetchProviderUsage(account.provider, account.id, since),
          };
        } catch {
          return { account, report: null };
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setRefreshing(false);
      setLoad({
        status: "ready",
        usage: results.flatMap(({ account, report }) =>
          report ? [{ account, rows: report.rows }] : [],
        ),
        failed: results
          .filter(({ report }) => !report)
          .map(({ account }) => usageAccountLabel(account)),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [accounts, reload, refresh]);

  const selected = accounts.find((account) => identityKey(account) === accountKey);
  const all = !selected;
  // The Account breakdown only means something across several accounts.
  const shownBreakdown = !all && breakdown === "account" ? "model" : breakdown;
  const dayCount = USAGE_RANGE_DAYS[range];

  const usage = useMemo(() => {
    if (load.status !== "ready") return [];
    return selected
      ? load.usage.filter((entry) => identityKey(entry.account) === identityKey(selected))
      : load.usage;
  }, [load, selected]);

  // Recomputed per render so "today" moves on when Settings stays open overnight.
  const now = new Date();
  const summary = summarizeUsage(usage, dayCount, now, pricing);
  const rows = usageBreakdown(usage, dayCount, now, shownBreakdown, usageAccountLabel, pricing);
  const failedAccounts =
    load.status === "ready"
      ? load.failed.filter((label) => !selected || label === usageAccountLabel(selected))
      : [];
  const noReadableLogs = load.status === "ready" && usage.length === 0 && failedAccounts.length > 0;

  const accountOptions = [
    {
      value: ALL_USAGE_ACCOUNTS,
      get label() {
        return t("All accounts");
      },
    },
    ...accounts.map((account) => ({
      value: identityKey(account),
      label: usageAccountLabel(account),
      icon: <HarnessIcon harness={account.provider} className="size-3.5" />,
    })),
  ];

  const notes = [
    prices
      ? t("Prices from OpenRouter, updated {p0}.", {
          p0: formatUsageDay(new Date(prices.fetchedAt * 1000)),
        })
      : prices === null
        ? t("OpenRouter prices could not be loaded, so built-in prices are used.")
        : null,
    summary.unpricedModels.length
      ? t("No price is known for {p0}, so its cost is left out.", {
          p0: summary.unpricedModels.join(", "),
        })
      : null,
    failedAccounts.length
      ? t("Could not read the logs for {p0}. Reload usage to try again.", {
          p0: failedAccounts.join(", "),
        })
      : null,
  ].filter(Boolean);

  return (
    <Group
      id="provider-usage"
      layout="full"
      title={showSummary ? t("Usage") : t("Usage breakdown")}
      scope={t("This machine · {p0}", {
        p0: selected ? usageAccountLabel(selected) : t("All accounts"),
      })}
      description={t(
        "Estimated from local session logs at API rates. Subscription plans are billed differently.",
      )}
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-xs text-[var(--ui-text-secondary)]">
            {range === "7d" ? t("7 days") : t("30 days")}
          </span>
          <Button
            variant="ghost"
            iconOnly
            label={t("Filters")}
            ref={filterAnchor}
            selected={accountKey !== ALL_USAGE_ACCOUNTS || range !== "7d"}
            aria-haspopup="dialog"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((value) => !value)}
          >
            <ListFilter className="size-3.5" />
          </Button>
          {filtersOpen ? (
            <Popover
              anchor={filterAnchor}
              align="end"
              width={320}
              role="dialog"
              aria-label={t("Filters")}
              autoFocus
              onDismiss={() => setFiltersOpen(false)}
            >
              <div className="grid gap-3 p-3">
                <SearchableSelect
                  label={t("Usage account")}
                  value={selected ? accountKey : ALL_USAGE_ACCOUNTS}
                  options={accountOptions}
                  onChange={setAccountKey}
                />
                <Segmented
                  label={t("Usage range")}
                  value={range}
                  options={[
                    {
                      value: "7d",
                      get label() {
                        return t("7 days");
                      },
                    },
                    {
                      value: "30d",
                      get label() {
                        return t("30 days");
                      },
                    },
                  ]}
                  onChange={setRange}
                />
                <Button
                  variant="ghost"
                  onClick={() => {
                    setAccountKey(ALL_USAGE_ACCOUNTS);
                    setRange("7d");
                  }}
                >
                  {t("Reset")}
                </Button>
              </div>
            </Popover>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            type="button"
            aria-label={t("Reload usage")}
            title={t("Reload usage")}
            disabled={refreshing}
            onClick={() => setReload((value) => value + 1)}
          >
            <RefreshCw
              className={`size-3.5${refreshing ? " animate-spin" : ""}`}
              strokeWidth={1.75}
              aria-hidden
            />
          </Button>
        </div>
      }
    >
      <div aria-busy={refreshing}>
        {refreshing && load.status === "ready" ? (
          <p role="status" className="px-4 py-2 text-[12px] text-content/60">
            {t("Refreshing usage… Previous results remain visible.")}
          </p>
        ) : null}
        {load.status === "loading" ? (
          <div role="status" className="px-4 py-6 text-[12px] text-content/45">
            {t("Reading session logs…")}
          </div>
        ) : noReadableLogs ? (
          <Alert tone="danger" role="alert">
            {t("Usage could not be read for the selected accounts. Reload usage to try again.")}
          </Alert>
        ) : summary.tokens === 0 ? (
          <div className="px-4 py-6 text-[12px] leading-relaxed text-content/45">
            {t("No usage in the last ")}
            {dayCount}
            {t(" days")}
            {selected ? t(" for {p0}", { p0: usageAccountLabel(selected) }) : ""}
            {t(
              ". Usage appears here once a Claude Code or Codex conversation has run on this computer.",
            )}
          </div>
        ) : (
          <>
            {showSummary ? (
              <>
                <div className="grid grid-cols-1 divide-y divide-content/5 border-b border-content/5 @min-[560px]/settings:grid-cols-3 @min-[560px]/settings:divide-x @min-[560px]/settings:divide-y-0">
                  <UsageStat
                    label={t("Estimated cost")}
                    value={formatUsageCost(summary.cost)}
                    detail={t("{p0} per active day", {
                      p0: formatUsageCost(summary.cost / Math.max(1, summary.activeDays)),
                    })}
                  />
                  <UsageStat
                    label={t("Tokens")}
                    value={formatUsageTokens(summary.tokens)}
                    detail={t("{p0} of {p1} days active", {
                      p0: String(summary.activeDays),
                      p1: String(dayCount),
                    })}
                  />
                  <UsageStat
                    label={t("Cache hit rate")}
                    value={`${(summary.cacheHitRate * 100).toFixed(1)}%`}
                    detail={t("Saved about {p0}", { p0: formatUsageCost(summary.cacheSavings) })}
                  />
                </div>

                <div className="border-b border-content/5 px-4 py-3.5">
                  <div className="flex items-center gap-4 pb-3">
                    <div className="min-w-0 flex-1 text-[13px] font-medium text-content">
                      {t("Daily ")}
                      {metric === "cost" ? t("cost") : t("tokens")}
                    </div>
                    <Segmented
                      label={t("Chart metric")}
                      value={metric}
                      options={[
                        {
                          value: "tokens",
                          get label() {
                            return t("Tokens");
                          },
                        },
                        {
                          value: "cost",
                          get label() {
                            return t("Cost");
                          },
                        },
                      ]}
                      onChange={setMetric}
                    />
                  </div>
                  <UsageDailyBars days={summary.days} metric={metric} />
                </div>
              </>
            ) : null}
            <div>
              <div className="flex items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1 text-[13px] font-medium text-content">
                  {t("Breakdown")}
                </div>
                <Segmented
                  label={t("Breakdown")}
                  value={shownBreakdown}
                  options={[
                    {
                      value: "model",
                      get label() {
                        return t("Model");
                      },
                    },
                    {
                      value: "project",
                      get label() {
                        return t("Project");
                      },
                    },
                    ...(all
                      ? [
                          {
                            value: "account" as const,
                            get label() {
                              return t("Account");
                            },
                          },
                        ]
                      : []),
                  ]}
                  onChange={setBreakdown}
                />
              </div>
              <div className="max-h-72 overflow-y-auto border-t border-content/5 bg-content/[0.015]">
                {rows.map((row) => (
                  <div
                    key={row.key}
                    className="flex h-11 items-center gap-4 border-b border-content/5 px-4 last:border-b-0"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2" title={row.title}>
                      {row.provider ? (
                        <HarnessIcon harness={row.provider} className="size-3.5 shrink-0" />
                      ) : null}
                      <span
                        className={`truncate text-[12px] text-content/85 ${shownBreakdown === "model" ? "font-mono" : ""}`}
                      >
                        {row.label}
                      </span>
                    </div>
                    <div
                      className="hidden h-1 w-28 shrink-0 overflow-hidden rounded-full bg-content/[0.07] @min-[560px]/settings:block"
                      aria-hidden
                    >
                      <div
                        className="h-full rounded-full bg-accent/70"
                        style={{ width: `${Math.max(2, row.share * 100)}%` }}
                      />
                    </div>
                    <span className="w-16 shrink-0 text-right text-[12px] tabular-nums text-content/50">
                      {formatUsageTokens(row.tokens)}
                    </span>
                    <span className="w-20 shrink-0 text-right text-[12px] tabular-nums text-content/85">
                      {formatUsageCost(row.cost)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
        {notes.length ? (
          <div className="border-t border-content/5 px-4 py-2.5 text-[11px] leading-relaxed text-content/40">
            {notes.join(" ")}
          </div>
        ) : null}
      </div>
    </Group>
  );
}

export function UsageStat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  useLocale();
  return (
    <div className="min-w-0 px-4 py-3.5">
      <div className="text-[12px] text-content/45">{label}</div>
      <div className="mt-1 text-[20px] font-semibold leading-tight tabular-nums text-content">
        {value}
      </div>
      <div className="mt-1 truncate text-[11px] text-content/40">{detail}</div>
    </div>
  );
}

export function formatUsageDay(date: Date): string {
  return date.toLocaleDateString(getLocale(), { month: "short", day: "numeric" });
}

export function UsageDailyBars({ days, metric }: { days: UsageDay[]; metric: UsageMetric }) {
  useLocale();
  const [hover, setHover] = useState<number | null>(null);
  const values = days.map((day) => (metric === "cost" ? day.cost : day.tokens));
  const max = Math.max(...values, 0);
  const format = metric === "cost" ? formatUsageCost : formatUsageTokens;

  return (
    <div>
      <div className="relative">
        <div className="pointer-events-none absolute inset-x-0 top-0 flex h-28 flex-col justify-between">
          {[0, 1, 2].map((line) => (
            <div key={line} className="border-t border-dashed border-content/[0.06]" />
          ))}
        </div>
        <div className="relative flex h-28 items-end gap-[3px]" onMouseLeave={() => setHover(null)}>
          {days.map((day, index) => {
            const value = values[index];
            return (
              <div
                key={day.date.getTime()}
                className="flex h-full min-w-0 flex-1 items-end"
                onMouseEnter={() => setHover(index)}
              >
                <div
                  className={`mx-auto w-full max-w-8 rounded-t-[3px] transition-colors ${
                    value <= 0
                      ? "h-px bg-content/10"
                      : hover === index
                        ? "bg-accent"
                        : hover != null
                          ? "bg-accent/35"
                          : "bg-accent/60"
                  }`}
                  style={
                    value <= 0 || max <= 0
                      ? undefined
                      : { height: `${Math.max(3, (value / max) * 100)}%` }
                  }
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] tabular-nums text-content/40">
        {hover != null ? (
          <>
            <span className="text-content/70">{formatUsageDay(days[hover].date)}</span>
            <span className="text-content/70">
              {values[hover] <= 0 ? t("No activity") : format(values[hover])}
            </span>
          </>
        ) : (
          <>
            <span>{formatUsageDay(days[0].date)}</span>
            <span>
              {t("Peak ")}
              {format(max)}
            </span>
            <span>{formatUsageDay(days[days.length - 1].date)}</span>
          </>
        )}
      </div>
    </div>
  );
}
