import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { SlotText } from "../../../shared/ui/SlotText";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { useDecorativeMotionPreference } from "../../settings/model/decorativeMotion";
import { t, useLocale, getLocale } from "../../../shared/i18n";
import { RefreshCw } from "../../../shared/ui/icons";
import { useEffect, useMemo, useState } from "react";
import {
  PROVIDER_ACCOUNT_PROVIDERS,
  providerAccounts,
  subscribeProviderAccounts,
} from "../../providers/model/providerAccounts";
import {
  createUsagePricing,
  fetchModelPrices,
  fetchProviderUsage,
  formatUsageCost,
  formatUsageTokens,
  type AccountUsage,
  type ModelPrices,
} from "../../providers/model/providerUsage";
import { DateRangePicker, type DateRange } from "../../../shared/ui/DateRangePicker";
import { SortableDataTable } from "../../../shared/ui/SortableDataTable";
import { railGroupLookup } from "../model/railGroups";
import { useLockSnapshot } from "../../group-lock/hooks/useGroupLock";
import { isProjectLockedIn } from "../../group-lock/model/lockState";
import {
  USAGE_RANGES,
  summarizeUsageOverview,
  usageRangeSince,
  usageSeriesColor,
  type UsageDayBucket,
  type UsageOverviewData,
  type UsageRangeId,
  type UsageStackBy,
} from "../model/usageOverview";

type Metric = "cost" | "tokens";

type Load = { status: "loading" } | { status: "ready"; usage: AccountUsage[]; failed: number };

function formatDay(date: Date): string {
  return date.toLocaleDateString(getLocale(), { month: "short", day: "numeric" });
}

/**
 * Estimated API-equivalent cost by day and by project. Reads the same local
 * session logs as the Usage card above it; the backend caches parsed
 * transcripts, so switching range or reopening Settings stays quick.
 */
export function UsageOverview({ refresh = 0 }: { refresh?: number }) {
  useLocale();
  const [version, setVersion] = useState(0);
  const [reload, setReload] = useState(0);
  const [range, setRange] = useState<UsageRangeId>("30d");
  const [customRange, setCustomRange] = useState<DateRange | null>(null);
  const [stackBy, setStackBy] = useState<UsageStackBy>("provider");
  const [metric, setMetric] = useState<Metric>("cost");
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(true);
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
    const since = customRange?.start.getTime() ?? usageRangeSince(range, new Date());
    void Promise.all(
      accounts.map(async (account) => {
        try {
          const report = await fetchProviderUsage(account.provider, account.id, since);
          return { account, rows: report.rows, ok: true };
        } catch {
          return { account, rows: [], ok: false };
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setRefreshing(false);
      setLoad({
        status: "ready",
        usage: results.map(({ account, rows }) => ({ account, rows })),
        failed: results.filter(({ ok }) => !ok).length,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [accounts, range, customRange, reload, refresh]);

  // "Today" and the rail groups are read whenever the logs, range or prices
  // change, which is also when the window should move on.
  // Usage of projects in a locked group is left out, names and costs both.
  const lock = useLockSnapshot();
  const data = useMemo(
    () =>
      load.status === "ready"
        ? summarizeUsageOverview(
            load.usage.map(({ account, rows }) => ({
              account,
              rows: rows.filter((row) => !row.project || !isProjectLockedIn(lock, row.project)),
            })),
            range,
            new Date(),
            stackBy,
            railGroupLookup(),
            pricing,
            customRange,
          )
        : null,
    [load, lock, range, customRange, stackBy, pricing],
  );

  const rangeLabel = customRange
    ? `${formatDay(customRange.start)} – ${formatDay(customRange.end)}`
    : (USAGE_RANGES.find((entry) => entry.id === range)?.label ?? "");

  return (
    <section
      id="setting-cost-overview"
      data-setting-id="cost-overview"
      tabIndex={-1}
      className="pt-8"
    >
      <div className="flex flex-wrap items-end gap-4 pb-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold text-content">{t("Cost by project and day")}</h2>
          <p className="mt-1 text-[11px] text-content/60">{t("This machine · All accounts")}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-content/45">
            {t(
              "API-equivalent estimates from local session logs, not what a subscription plan bills.",
            )}
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 pb-0.5">
          <Choice
            label={t("Cost range")}
            value={customRange ? "custom" : range}
            options={[
              ...USAGE_RANGES.map(({ id, label }) => ({
                value: id,
                label,
              })),
              ...(customRange ? [{ value: "custom", label: t("Custom date range") }] : []),
            ]}
            onChange={(next) => {
              if (next !== "custom") {
                setRange(next as UsageRangeId);
                setCustomRange(null);
              }
            }}
          />
          <DateRangePicker value={customRange} onChange={setCustomRange} maxDate={new Date()} />
          <Button
            variant="ghost"
            size="sm"
            type="button"
            iconOnly
            label={t("Reload cost by project and day")}
            title={t("Reload")}
            disabled={refreshing}
            onClick={() => setReload((value) => value + 1)}
          >
            <RefreshCw
              className={`size-3.5${refreshing ? " motion-safe:animate-spin" : ""}`}
              strokeWidth={1.75}
              aria-hidden
            />
          </Button>
        </div>
      </div>
      <div
        className="overflow-hidden rounded-xl border border-content/10 bg-content/3"
        aria-busy={refreshing}
      >
        {refreshing && data ? (
          <Alert tone="info" role="status">
            {t("Refreshing usage… Previous results remain visible.")}
          </Alert>
        ) : null}
        {!data ? (
          <div role="status" className="px-4 py-6 text-[12px] text-content/45">
            {t("Reading session logs…")}
          </div>
        ) : load.status === "ready" && load.failed > 0 && load.failed === accounts.length ? (
          <Alert tone="danger" role="alert">
            {t("Usage could not be read for the selected accounts. Reload usage to try again.")}
          </Alert>
        ) : data.totals.tokens === 0 ? (
          <div className="px-4 py-6 text-[12px] leading-relaxed text-content/45">
            {t("No usage in the selected range (")}
            {rangeLabel.toLowerCase()}).
          </div>
        ) : (
          <>
            <Totals data={data} />
            <DailyChart
              data={data}
              metric={metric}
              stackBy={stackBy}
              onMetric={setMetric}
              onStackBy={setStackBy}
            />
            <ProjectTable data={data} />
          </>
        )}
        <Notes data={data} failed={load.status === "ready" ? load.failed : 0} prices={prices} />
      </div>
    </section>
  );
}

function Totals({ data }: { data: UsageOverviewData }) {
  useLocale();
  const { totals } = data;
  return (
    <div className="grid grid-cols-1 divide-y divide-content/5 border-b border-content/5 @min-[560px]/settings:grid-cols-4 @min-[560px]/settings:divide-x @min-[560px]/settings:divide-y-0">
      <Stat
        label={t("Estimated cost")}
        value={formatUsageCost(totals.cost)}
        detail="API-equivalent, not billed"
      />
      <Stat label={t("Input")} value={formatUsageTokens(totals.input)} detail="uncached tokens" />
      <Stat label={t("Output")} value={formatUsageTokens(totals.output)} detail="tokens" />
      <Stat
        label={t("Cache")}
        value={formatUsageTokens(totals.cacheRead + totals.cacheWrite)}
        detail={`${formatUsageTokens(totals.cacheRead)} read · ${formatUsageTokens(totals.cacheWrite)} written`}
      />
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  useLocale();
  const decorativeMotion = useDecorativeMotionPreference();
  return (
    <div className="min-w-0 px-4 py-3.5">
      <div className="text-[12px] text-content/45">{label}</div>
      <div className="mt-1 text-[20px] font-semibold leading-tight tabular-nums text-content">
        <SlotText value={value} align="end" motion={decorativeMotion ? "auto" : "none"} />
      </div>
      <div className="mt-1 truncate text-[11px] text-content/40">{detail}</div>
    </div>
  );
}

function amountText(amount: { cost: number; tokens: number }, metric: Metric) {
  return metric === "cost"
    ? `${formatUsageCost(amount.cost)} est.`
    : `${formatUsageTokens(amount.tokens)} tokens`;
}

function dayLabel(day: UsageDayBucket, data: UsageOverviewData, metric: Metric) {
  const total = metric === "cost" ? day.cost : day.tokens;
  if (total <= 0) return `${formatDay(day.date)}: no activity`;
  const parts = data.series
    .filter((series) => day.series[series.key])
    .map((series) => `${series.label} ${amountText(day.series[series.key], metric)}`);
  return `${formatDay(day.date)}: ${amountText(day, metric)} (${parts.join(", ")})`;
}

function DailyChart({
  data,
  metric,
  stackBy,
  onMetric,
  onStackBy,
}: {
  data: UsageOverviewData;
  metric: Metric;
  stackBy: UsageStackBy;
  onMetric: (metric: Metric) => void;
  onStackBy: (by: UsageStackBy) => void;
}) {
  useLocale();
  const [active, setActive] = useState<number | null>(null);
  const { days, series } = data;
  const value = (amount: { cost: number; tokens: number }) =>
    metric === "cost" ? amount.cost : amount.tokens;
  const max = Math.max(...days.map(value), 0);
  const colors = new Map(
    series.map((entry, index) => [entry.key, usageSeriesColor(index, entry.key)]),
  );
  return (
    <div className="border-b border-content/5 px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-3">
        <div className="min-w-0 flex-1 text-[13px] font-medium text-content">
          {t("Daily ")}
          {metric === "cost" ? t("estimated cost") : t("tokens")}
        </div>
        <Choice
          label={t("Chart metric")}
          value={metric}
          options={[
            {
              value: "cost",
              get label() {
                return t("Cost");
              },
            },
            {
              value: "tokens",
              get label() {
                return t("Tokens");
              },
            },
          ]}
          onChange={onMetric}
        />
        <Choice
          label={t("Stack by")}
          value={stackBy}
          options={[
            {
              value: "provider",
              get label() {
                return t("Provider");
              },
            },
            {
              value: "model",
              get label() {
                return t("Model");
              },
            },
          ]}
          onChange={onStackBy}
        />
      </div>
      <ul
        aria-label={t(metric === "cost" ? "Daily estimated cost" : "Daily tokens")}
        className="relative m-0 flex h-28 list-none items-end gap-px p-0"
        onMouseLeave={() => setActive(null)}
      >
        {days.map((day, index) => {
          const total = value(day);
          const height = max > 0 ? (total / max) * 100 : 0;
          return (
            <li
              key={day.key}
              tabIndex={0}
              aria-label={dayLabel(day, data, metric)}
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
              className="flex h-full min-w-0 flex-1 items-end rounded-t-[3px] outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              {total <= 0 ? (
                <div className="h-px w-full bg-content/10" />
              ) : (
                <div
                  className={`mx-auto flex w-full max-w-8 flex-col-reverse overflow-hidden rounded-t-[3px] transition-opacity ${
                    active != null && active !== index ? "opacity-40" : ""
                  }`}
                  style={{ height: `${Math.max(3, height)}%` }}
                >
                  {series.map((entry) => {
                    const slice = day.series[entry.key];
                    const share = slice ? value(slice) / total : 0;
                    return share > 0 ? (
                      <div
                        key={entry.key}
                        style={{
                          flexGrow: share,
                          flexBasis: 0,
                          backgroundColor: colors.get(entry.key),
                        }}
                      />
                    ) : null;
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div aria-live="polite" className="mt-2 min-h-4 text-[11px] tabular-nums text-content/60">
        {active != null ? (
          dayLabel(days[active], data, metric)
        ) : (
          <span className="flex justify-between text-content/40">
            <span>{formatDay(days[0].date)}</span>
            <span>
              {t("Peak")} {metric === "cost" ? formatUsageCost(max) : formatUsageTokens(max)}
            </span>
            <span>{formatDay(days[days.length - 1].date)}</span>
          </span>
        )}
      </div>
      <ul className="m-0 mt-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[11px] text-content/60">
        {series.map((entry) => (
          <li key={entry.key} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2 rounded-sm"
              style={{ backgroundColor: colors.get(entry.key) }}
            />
            <span className={stackBy === "model" ? "font-mono" : ""}>{entry.label}</span>
          </li>
        ))}
      </ul>
      <details className="mt-3 text-[11px] text-content/60">
        <summary className="cursor-pointer select-none text-content/50 hover:text-content">
          {t("Show as table")}
        </summary>
        <div className="mt-2 max-h-56 overflow-auto">
          <table className="w-full border-collapse text-left tabular-nums">
            <caption className="sr-only">{t("Estimated cost and tokens per day")}</caption>
            <thead>
              <tr className="text-content/45">
                <th scope="col" className="py-1 pr-3 font-normal">
                  {t("Day")}
                </th>
                {series.map((entry) => (
                  <th key={entry.key} scope="col" className="py-1 pr-3 text-right font-normal">
                    {entry.label}
                  </th>
                ))}
                <th scope="col" className="py-1 text-right font-normal">
                  {t("Total")}
                </th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((day) => (
                <tr key={day.key} className="border-t border-content/5">
                  <th scope="row" className="py-1 pr-3 font-normal">
                    {formatDay(day.date)}
                  </th>
                  {series.map((entry) => (
                    <td key={entry.key} className="py-1 pr-3 text-right">
                      {day.series[entry.key] ? amountText(day.series[entry.key], metric) : "–"}
                    </td>
                  ))}
                  <td className="py-1 text-right text-content/85">{dayTotalText(day, metric)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function dayTotalText(day: UsageDayBucket, metric: Metric): string {
  return day.tokens > 0 ? amountText(day, metric) : "–";
}

function ProjectTable({ data }: { data: UsageOverviewData }) {
  useLocale();
  const grouped = data.groups.some((section) => section.name !== null);
  return (
    <div className="max-h-80 overflow-auto">
      {data.groups.map((section) => (
        <section key={section.key}>
          {grouped ? (
            <div className="flex justify-between gap-3 px-4 py-2 text-xs text-content/70">
              <span>{section.name ?? t("Not in a group")}</span>
              <span>{formatUsageCost(section.cost)}</span>
            </div>
          ) : null}
          <SortableDataTable
            caption={
              grouped ? (section.name ?? t("Not in a group")) : t("Projects by estimated cost")
            }
            rowKey="key"
            rows={section.projects.map((project) => ({
              ...project,
              cache: project.cacheRead + project.cacheWrite,
            }))}
            defaultSort={{ key: "cost", direction: "desc" }}
            columns={[
              {
                key: "label",
                label: t("Project"),
                sortable: true,
                render: (_, project) => (
                  <span title={project.title}>
                    {project.label}
                    <span aria-hidden className="mt-1 block h-0.5 rounded-full bg-content/10">
                      <span
                        className="block h-full rounded-full bg-accent/70"
                        style={{ width: `${Math.max(2, project.share * 100)}%` }}
                      />
                    </span>
                  </span>
                ),
              },
              {
                key: "input",
                label: t("Input"),
                sortable: true,
                numeric: true,
                render: (_, project) => formatUsageTokens(project.input),
              },
              {
                key: "output",
                label: t("Output"),
                sortable: true,
                numeric: true,
                render: (_, project) => formatUsageTokens(project.output),
              },
              {
                key: "cache",
                label: t("Cache"),
                sortable: true,
                numeric: true,
                render: (_, project) => (
                  <span
                    title={t("{p0} read · {p1} written", {
                      p0: formatUsageTokens(project.cacheRead),
                      p1: formatUsageTokens(project.cacheWrite),
                    })}
                  >
                    {formatUsageTokens(project.cache)}
                  </span>
                ),
              },
              {
                key: "cost",
                label: t("Est. cost"),
                sortable: true,
                numeric: true,
                render: (_, project) => (
                  <>
                    {formatUsageCost(project.cost)}
                    {project.partlyUnpriced ? (
                      <span title={t("Some models here have no known price, so this is a minimum")}>
                        {" "}
                        +
                      </span>
                    ) : null}
                  </>
                ),
              },
            ]}
          />
        </section>
      ))}
    </div>
  );
}

function Notes({
  data,
  failed,
  prices,
}: {
  data: UsageOverviewData | null;
  failed: number;
  prices: ModelPrices | null | undefined;
}) {
  useLocale();
  const notes = [
    prices === null ? "OpenRouter prices could not be loaded, so built-in prices are used." : null,
    data?.unpricedModels.length
      ? `No price is known for ${data.unpricedModels.join(", ")}, so its cost is left out.`
      : null,
    failed ? `Could not read the logs for ${failed} account${failed === 1 ? "" : "s"}.` : null,
  ].filter(Boolean);
  if (!notes.length) return null;
  return (
    <div className="border-t border-content/5 px-4 py-2.5 text-[11px] leading-relaxed text-content/40">
      {notes.join(" ")}
    </div>
  );
}

/** Exclusive metric/range/group modes; domain values stay with the caller. */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <SegmentedControl
      label={label}
      value={value}
      options={options}
      onValueChange={(next) => onChange(next as T)}
    />
  );
}
