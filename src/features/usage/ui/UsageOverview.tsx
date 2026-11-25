import { Text } from "../../../shared/ui/Text";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Disclosure } from "../../../shared/ui/Disclosure";
import {
  Activity,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import { dateTimeFormat, formatDate, t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InlineError } from "../../../shared/ui/InlineError";
import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import { TabStrip } from "../../../shared/ui/Tabs";
import { Select } from "../../../shared/ui/Select";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Heading } from "../../../shared/ui/Heading";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { DateTimeRangePicker } from "../../../shared/ui/DateTimeRangePicker";
import { ArrowDownCircle, Calendar, ListFilter, RefreshCw } from "../../../shared/ui/icons";
import {
  PROVIDER_ACCOUNT_PROVIDERS,
  providerAccounts,
  subscribeProviderAccounts,
} from "../../providers/model/providerAccounts";
import {
  createUsagePricing,
  type AccountUsage,
  type ModelPrices,
} from "../../providers/model/providerUsage";
import { loadUsageSources } from "../data/usageSources";
import { usagePresetWindow } from "../model/usageWindows";
import { subscribeUsageViewIntent, takeUsageViewIntent } from "../model/usageViewIntent";
import { useLockSnapshot } from "../../group-lock/hooks/useGroupLock";
import { isProjectLockedIn } from "../../group-lock/model/lockState";
import { RevealedSetting } from "../../../shared/ui/settings";
import { SettingsPageLoading } from "../../settings/public/settingsPageLoading";
import { recallUsageLoad, rememberUsageLoad } from "../model/usageLoadCache";
import { railGroupLookup } from "../model/railGroups";
import { ModelLabel } from "../../sessions/public/ModelLabel";
import { modelDisplayName } from "../../sessions/public/modelDisplayName";
import { searchRows, usageSampleStats } from "./usageOverviewStats";
import { subscribeProjectPathsChanged } from "../../projects/model/recents";
import {
  durationSamples,
  effectiveResolution,
  emptyUsageFilters,
  filterUsage,
  previousUsageWindow,
  sessionUsage,
  usageBreakdown,
  usageBuckets,
  usageCsv,
  usageSamples,
  usageTotals,
  type UsageDimension,
  type UsageFilters,
  type UsageMetric,
  type UsageResolution,
  type UsageTurnReport,
  type UsageWindow,
} from "../model/usageAnalytics";
import {
  ContinuousUsageTable,
  formatMetric,
  formatUsagePercent,
  metricName,
  UsageDataNotes,
} from "./UsageCharts";
import { Contribution, TimeDistribution, UsageShare, UsageTrend } from "./UsageVisualizations";
import { usageColorMap } from "../model/usageColors";
import { QuotaHistory } from "./UsageQuotaHistory";
import { UsageRecordedSessions } from "./UsageRecordedSessions";
import { usageLabel, usageProviderLabel, UsageProviderIdentity } from "./UsageProviderIdentity";
import { useRateLimitHistory } from "../../providers/model/rateLimitHistory";
import "./UsageAnalytics.css";

type Preset = "today" | "yesterday" | "7d" | "30d" | "90d" | "all" | "custom";
const presets: Preset[] = ["today", "yesterday", "7d", "30d", "90d", "all", "custom"];
function presetLabel(preset: Preset): string {
  switch (preset) {
    case "today":
      return t("Today");
    case "yesterday":
      return t("Yesterday");
    case "7d":
      return t("7 days");
    case "30d":
      return t("30 days");
    case "90d":
      return t("90 days");
    case "all":
      return t("All time");
    case "custom":
      return t("Custom date and time");
  }
}
const metricKeys: UsageMetric[] = [
  "cost",
  "tokens",
  "input",
  "output",
  "cacheRead",
  "cacheWrite",
  "duration",
];
type Load = {
  queryKey: string;
  prices?: ModelPrices | null;
  usage: AccountUsage[];
  turns: UsageTurnReport | null;
  failed: number;
  turnsFailed: boolean;
  stale: boolean;
  refreshedAt: number;
  error: string | null;
};
const initialLoad: Load = {
  queryKey: "",
  usage: [],
  turns: null,
  failed: 0,
  turnsFailed: false,
  stale: false,
  refreshedAt: 0,
  error: null,
};
// A custom range keeps its own window; relative presets share their calendar math with the voice report.
const presetWindow = (preset: Preset, now: number): UsageWindow =>
  usagePresetWindow(preset === "custom" ? "today" : preset, now);

function viewForSetting(revealed: string | null, fallback: string) {
  switch (revealed) {
    case "account-limits":
    case "usage-budgets":
    case "show-remaining-usage":
      return "limits";
    case "provider-usage":
      return "projects";
    case "cost-overview":
      return "overview";
    default:
      return fallback;
  }
}

export function UsageOverview({
  refresh = 0,
  limits,
  limitsOnly = false,
}: {
  refresh?: number;
  limits?: (filters: UsageFilters) => ReactNode;
  limitsOnly?: boolean;
}) {
  const locale = useLocale();
  const revealed = useContext(RevealedSetting);
  const [selection, setSelection] = useState(() => ({
    view: viewForSetting(revealed, "overview"),
    revealed,
  }));
  const view = limitsOnly ? "limits" : selection.view;
  const [limitsVisited, setLimitsVisited] = useState(view === "limits");
  if (view === "limits" && !limitsVisited) setLimitsVisited(true);
  const setView = (next: string) => {
    setSelection({ view: next, revealed });
  };
  if (selection.revealed !== revealed) {
    setSelection({ revealed, view: viewForSetting(revealed, view) });
  }
  const [preset, setPreset] = useState<Preset>("30d");
  const [interval, setInterval] = useState<UsageWindow>(() => presetWindow("30d", Date.now()));
  const [appliedRefresh, setAppliedRefresh] = useState(refresh);
  // Update before committing effects, so a workspace refresh never queries the
  // expired interval before moving a relative preset forward.
  if (appliedRefresh !== refresh) {
    setAppliedRefresh(refresh);
    if (preset !== "custom") setInterval(presetWindow(preset, Date.now()));
  }
  const [filters, setFilters] = useState<UsageFilters>(emptyUsageFilters);
  const [metric, setMetric] = useState<UsageMetric>("cost");
  const [overviewDimension, setOverviewDimension] = useState<UsageDimension>("provider");
  const [projectDimension, setProjectDimension] = useState<UsageDimension>("project");
  const dimension = view === "projects" ? projectDimension : overviewDimension;
  const setDimension = view === "projects" ? setProjectDimension : setOverviewDimension;
  const [resolution, setResolution] = useState<UsageResolution>("day");
  const [openFilters, setOpenFilters] = useState(false);
  // The date range has one owner: the preset Select. Its picker opens from there.
  const [openDateRange, setOpenDateRange] = useState(false);
  const dateAnchor = useRef<HTMLDivElement>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showProjectTable, setShowProjectTable] = useState(false);
  const [reload, setReload] = useState(0);
  const [version, setVersion] = useState(0);
  const [load, setLoad] = useState<Load>(() => recallUsageLoad(interval, initialLoad));
  useEffect(() => rememberUsageLoad(load), [load]);
  const { prices } = load;
  const [search, setSearch] = useState("");
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const filterAnchor = useRef<HTMLButtonElement>(null);
  useEffect(() => subscribeProviderAccounts(() => setVersion((v) => v + 1)), []);
  // A requested view (for example from a voice report) applies the report's exact window, filters and metric.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- listens to the usage view request store while the dashboard is mounted
  useEffect(() => {
    if (limitsOnly) return;
    const apply = () => {
      const intent = takeUsageViewIntent();
      if (!intent) return;
      setPreset(intent.preset);
      setInterval(intent.window);
      setFilters(intent.filters);
      setMetric(intent.metric);
      setResolution(intent.resolution);
      setSelectedSession(null);
      setSelection({ view: "overview", revealed });
    };
    apply();
    return subscribeUsageViewIntent(apply);
  }, [limitsOnly, revealed]);
  const accounts = useMemo(() => PROVIDER_ACCOUNT_PROVIDERS.flatMap(providerAccounts), [version]);
  const quotaHistory = useRateLimitHistory(view === "limits" && preset === "all");
  const pricing = useMemo(() => createUsagePricing(prices?.models), [prices]);
  const since = preset === "all" ? 0 : Math.max(0, previousUsageWindow(interval).start);
  const queryKey = `${since}:${interval.end}:${reload}:${refresh}:${version}`;
  const refreshing = !limitsOnly && load.queryKey !== queryKey;
  useEffect(() => {
    if (limitsOnly) return;
    let cancelled = false;
    const sources = loadUsageSources(accounts, since, interval.end);
    void sources.prices.then((nextPrices) => {
      if (!cancelled) setLoad((previous) => ({ ...previous, prices: nextPrices }));
    });
    void Promise.all([sources.reports, sources.turns]).then(([reports, turns]) => {
      if (cancelled) return;
      const failed = reports.filter((r) => r.failed).length;
      setLoad((previousLoad) => ({
        queryKey,
        prices: previousLoad.prices,
        usage: reports.map(({ account, rows, failed: unavailable }) => ({
          account,
          rows: unavailable
            ? (previousLoad.usage.find(
                (r) => r.account.id === account.id && r.account.provider === account.provider,
              )?.rows ?? [])
            : rows,
        })),
        turns: turns ?? previousLoad.turns,
        failed,
        turnsFailed: turns === null,
        stale:
          (turns === null && previousLoad.turns !== null) ||
          reports.some(
            ({ account, failed }) =>
              failed &&
              previousLoad.usage.some(
                (report) =>
                  report.account.id === account.id &&
                  report.account.provider === account.provider &&
                  report.rows.length > 0,
              ),
          ),
        refreshedAt: Date.now(),
        error:
          accounts.length > 0 && failed === accounts.length
            ? "Usage could not be read for the selected accounts. Reload usage to try again."
            : null,
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [accounts, since, interval.end, queryKey, limitsOnly]);
  const lock = useLockSnapshot();
  const [groupRevision, setGroupRevision] = useState(0);
  useEffect(() => subscribeProjectPathsChanged(() => setGroupRevision((value) => value + 1)), []);
  const groupFor = useMemo(() => railGroupLookup(), [load, lock, groupRevision]);
  const samples = useMemo(
    () =>
      usageSamples(
        load.usage.map(({ account, rows }) => ({
          account,
          rows: rows.filter((row) => !row.project || !isProjectLockedIn(lock, row.project)),
        })),
        pricing,
        groupFor,
      ),
    [load.usage, lock, pricing, groupFor],
  );
  const turns = useMemo(
    () =>
      load.turns?.turns.filter((turn) => !turn.project || !isProjectLockedIn(lock, turn.project)) ??
      [],
    [load.turns, lock],
  );
  const window = useMemo(
    () =>
      preset === "all"
        ? {
            start:
              view === "limits"
                ? quotaHistory.reduce(
                    (first, sample) => Math.min(first, sample.at),
                    interval.end - 86_400_000,
                  )
                : samples.reduce(
                    (n, s) => Math.min(n, s.at),
                    turns.reduce(
                      (n, turn) => Math.min(n, turn.startedAt),
                      interval.end - 86_400_000,
                    ),
                  ),
            end: interval.end,
          }
        : interval,
    [interval, preset, samples, turns, quotaHistory, view],
  );
  const filtered = useMemo(() => filterUsage(samples, filters, window), [samples, filters, window]);
  const previous = useMemo(
    () => filterUsage(samples, filters, previousUsageWindow(window)),
    [samples, filters, window],
  );
  const runtime = useMemo(
    () =>
      durationSamples(turns, window, filters, groupFor).map((sample) => ({
        ...sample,
        accountLabel:
          accounts.find((account) => `${account.provider}:${account.id}` === sample.account)
            ?.label ?? sample.accountLabel,
      })),
    [turns, window, filters, groupFor, accounts],
  );
  const sessions = useMemo(
    () => sessionUsage(turns, window, filters, pricing, groupFor),
    [turns, window, filters, pricing, groupFor],
  );
  const chartSamples = useMemo(() => [...filtered, ...runtime], [filtered, runtime]);
  const actualResolution = effectiveResolution(window, resolution);
  const chart = useMemo(
    () => usageBuckets(chartSamples, window, actualResolution, dimension, metric),
    [chartSamples, window, actualResolution, dimension, metric],
  );
  const totals = useMemo(
    () => ({ ...usageTotals(filtered), duration: usageTotals(runtime).duration }),
    [filtered, runtime],
  );
  const previousTotals = useMemo(() => usageTotals(previous), [previous]);
  const breakdown = useMemo(
    () => usageBreakdown(chartSamples, dimension, metric),
    [chartSamples, dimension, metric],
  );
  const providers = useMemo(
    () => usageBreakdown(chartSamples, "provider", metric),
    [chartSamples, metric],
  );
  const projects = useMemo(
    () => usageBreakdown(chartSamples, "project", metric),
    [chartSamples, metric],
  );
  const models = useMemo(
    () =>
      usageBreakdown(chartSamples, "model", metric).map((row) => ({
        ...row,
        providers: row.provider ? [row.provider] : [],
      })),
    [chartSamples, metric],
  );
  const colors = useMemo(
    () => usageColorMap(accounts, chartSamples, dimension),
    [accounts, chartSamples, dimension],
  );
  const providerColors = useMemo(
    () => usageColorMap(accounts, chartSamples, "provider"),
    [accounts, chartSamples],
  );
  const projectColors = useMemo(
    () => usageColorMap(accounts, chartSamples, "project"),
    [accounts, chartSamples],
  );
  const modelColors = useMemo(
    () => usageColorMap(accounts, chartSamples, "model"),
    [accounts, chartSamples],
  );
  const options = useMemo(() => {
    const result = Object.fromEntries(
      (Object.keys(filters) as (keyof UsageFilters)[]).map((key) => [
        key,
        new Map<string, string>(),
      ]),
    ) as Record<keyof UsageFilters, Map<string, string>>;
    for (const s of [...samples, ...runtime]) {
      result.provider.set(s.provider, usageProviderLabel(s.provider));
      result.account.set(s.account, `${usageProviderLabel(s.provider)} · ${s.accountLabel}`);
      result.model.set(s.model, modelDisplayName(s.model, s.provider));
      result.project.set(s.project, s.projectLabel);
      result.group.set(s.group, s.groupLabel);
    }
    if (view === "limits") {
      result.provider.clear();
      result.account.clear();
    }
    for (const account of accounts) {
      if (view === "limits" && account.provider !== "codex" && account.provider !== "claude")
        continue;
      result.provider.set(account.provider, usageProviderLabel(account.provider));
      result.account.set(
        `${account.provider}:${account.id}`,
        `${usageProviderLabel(account.provider)} · ${account.label}`,
      );
    }
    if (view === "limits") {
      result.provider.set("grok", "Grok");
      result.account.set("grok:default", "Grok");
    }
    return result;
  }, [samples, runtime, accounts, view]);
  // The provider each model was used through, for its icon in the filter.
  const modelProviders = useMemo(() => {
    const result = new Map<string, string>();
    for (const s of [...samples, ...runtime]) result.set(s.model, s.provider);
    return result;
  }, [samples, runtime]);
  const quotaFilters = {
    ...emptyUsageFilters(),
    provider: filters.provider.filter(
      (provider) =>
        provider === "grok" ||
        accounts.some(
          (account) =>
            account.provider === provider && (provider === "codex" || provider === "claude"),
        ),
    ),
    account: filters.account.filter(
      (key) =>
        key === "grok:default" ||
        accounts.some(
          (account) =>
            `${account.provider}:${account.id}` === key &&
            (account.provider === "codex" || account.provider === "claude"),
        ),
    ),
  };
  const effectiveFilters = view === "limits" ? quotaFilters : filters;
  const filterKeys: (keyof UsageFilters)[] =
    view === "limits" ? ["provider", "account"] : (Object.keys(filters) as (keyof UsageFilters)[]);
  const activeFilterCount = filterKeys.filter((key) => effectiveFilters[key].length > 0).length;
  const activeFilters = Object.entries(effectiveFilters)
    .filter(([key]) => filterKeys.includes(key as keyof UsageFilters))
    .flatMap(([key, values]) =>
      values.map((value: string) => ({ key: key as keyof UsageFilters, value })),
    );
  const names: Record<keyof UsageFilters, string> = {
    provider: t("Provider"),
    account: t("Account"),
    project: t("Project"),
    model: t("Model"),
    group: t("Workspace"),
  };
  const chooseFilter = (key: keyof UsageFilters, value: string) => {
    setFilters((f) => ({ ...f, [key]: [value] }));
    setSelectedSession(null);
  };
  const chooseInterval = (next: UsageWindow) => {
    setPreset("custom");
    setInterval({ start: Math.max(next.start, window.start), end: Math.min(next.end, window.end) });
    setSelectedSession(null);
  };
  const { unpriced, pricedTokens, activeDays, cacheSavings } = useMemo(
    () => usageSampleStats(filtered, pricing),
    [filtered, pricing],
  );
  const inputTotal = totals.input + totals.cacheRead + totals.cacheWrite;
  // The search box stays responsive; the rows filter in a later render.
  const deferredSearch = useDeferredValue(search);
  const matchedRows = useMemo(() => {
    const providersByRow = new Map<string, Set<string>>();
    for (const sample of chartSamples) {
      const key = sample[dimension];
      const providers = providersByRow.get(key) ?? new Set<string>();
      providers.add(sample.provider);
      providersByRow.set(key, providers);
    }
    return searchRows(
      breakdown,
      // A model is found by its readable name and by its raw id.
      (row) => (dimension === "model" ? `${row.label} ${row.key}` : row.label),
      deferredSearch,
      locale,
    ).map((row) => ({
      ...row,
      providers: [...(providersByRow.get(row.key) ?? [])],
    }));
  }, [breakdown, chartSamples, dimension, deferredSearch, locale]);
  const sessionRows = useMemo(
    () =>
      searchRows(sessions, (row) => `${row.title} ${row.project}`, deferredSearch, locale).filter(
        (row) => !selectedSession || row.key === selectedSession,
      ),
    [sessions, deferredSearch, locale, selectedSession],
  );
  const turnRows = useMemo(
    () =>
      selectedSession
        ? turns
            .filter((turn) => turn.sessionId === selectedSession)
            .flatMap((turn, index) => {
              const row = sessionUsage([turn], window, filters, pricing, groupFor)[0];
              return row
                ? [
                    {
                      ...row,
                      key: `${row.key}:${turn.startedAt}:${index}`,
                      label: dateTimeFormat(locale, {
                        dateStyle: "short",
                        timeStyle: "medium",
                      }).format(turn.startedAt),
                      duration: row.timedTurns ? row.duration : null,
                      cost: row.meteredTurns > row.unpricedTurns ? row.cost : null,
                      tokens: row.meteredTurns ? row.tokens : null,
                      input: row.meteredTurns ? row.input : null,
                      output: row.meteredTurns ? row.output : null,
                      cacheRead: row.meteredTurns ? row.cacheRead : null,
                      cacheWrite: row.meteredTurns ? row.cacheWrite : null,
                    },
                  ]
                : [];
            })
        : [],
    [selectedSession, turns, window, filters, pricing, groupFor, locale],
  );
  const hasCachedUsage = load.usage.some(({ rows }) => rows.length > 0);
  const firstLoad = !load.refreshedAt;
  const unavailable =
    !firstLoad &&
    ((!!load.error && !hasCachedUsage) || (!accounts.length && load.turnsFailed && !load.turns));
  const stale = load.stale;
  const partial = !unavailable && (load.failed > 0 || load.turnsFailed || !!load.turns?.truncated);
  const hasFilteredData = filtered.length > 0 || runtime.length > 0;
  const showAnalytics = !firstLoad && !unavailable;
  // True zero usage or an empty filter result: one empty state stands in for every panel.
  const isEmptyPeriod = showAnalytics && !refreshing && !hasFilteredData && !partial;
  const metricUnavailable = metric === "duration" && load.turns === null;
  const refreshData = () => {
    if (refreshing) return;
    if (preset !== "custom") setInterval(presetWindow(preset, Date.now()));
    setReload((v) => v + 1);
  };
  const exportCsv = () => {
    const url = URL.createObjectURL(
      new Blob(["\uFEFF", usageCsv(matchedRows)], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "bycoda-usage.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section
      id="setting-cost-overview"
      data-setting-id="cost-overview"
      className="usage-analytics bycoda-chart-colors"
      style={
        {
          "--ui-chart-color": providerColors.get(providers[0]?.key ?? "") ?? "var(--color-accent)",
        } as CSSProperties
      }
      aria-busy={refreshing}
    >
      {view === "projects" && (!showAnalytics || metricUnavailable || isEmptyPeriod) && (
        <div id="setting-provider-usage" data-setting-id="provider-usage" />
      )}
      <div className="usage-band">
        {!limitsOnly && (
          <TabStrip
            label={t("Usage views")}
            value={view}
            onValueChange={setView}
            items={[
              { value: "overview", label: t("Overview") },
              { value: "projects", label: t("Projects") },
              { value: "time", label: t("Time analysis") },
              ...(limits ? [{ value: "limits", label: t("Limits") }] : []),
            ]}
          />
        )}
        <div className="usage-analytics-actions">
          <div className="usage-band-scope">
            <InfoPopover label={t("Data sources and coverage")}>
              <p>{limitsOnly ? t("This machine") : t("This machine · Local session logs")}</p>
              {/* shortcut: the zone id is shown as the platform reports it; no i18n formatter returns only the zone. */}
              <p>{Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
              {view !== "limits" && load.refreshedAt > 0 && !partial && !unavailable && (
                <p>
                  {t("Updated")}{" "}
                  {formatDate(load.refreshedAt, {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })}
                </p>
              )}
              {view === "limits" ? (
                <p>
                  {t(
                    "Provider and account filters apply to account limits and history. Local budget rules keep their own scope.",
                  )}
                </p>
              ) : null}
            </InfoPopover>
          </div>
          <div className="usage-controls" ref={dateAnchor}>
            <Select
              hideLabel
              label={t("Date range")}
              value={preset}
              options={presets.map((value) => ({
                value,
                label: presetLabel(value),
              }))}
              onValueChange={(v) => {
                if (v === "custom") {
                  // Keeps the current interval; the picker edits it.
                  setPreset("custom");
                  setOpenDateRange(true);
                  return;
                }
                setOpenDateRange(false);
                setPreset(v as Preset);
                setInterval(presetWindow(v as Preset, Date.now()));
              }}
            />
            {preset === "custom" && (
              <Button
                variant="ghost"
                iconOnly
                label={t("Edit date range")}
                selected={openDateRange}
                aria-haspopup="dialog"
                aria-expanded={openDateRange}
                onClick={() => setOpenDateRange(!openDateRange)}
              >
                <Calendar aria-hidden className="icon-sm" strokeWidth={1.75} />
              </Button>
            )}
          </div>
          <Button
            ref={filterAnchor}
            variant="ghost"
            iconOnly
            label={`${t("Filters")}${activeFilterCount ? ` (${activeFilterCount})` : ""}`}
            selected={!!activeFilters.length}
            aria-haspopup="dialog"
            aria-expanded={openFilters}
            onClick={() => setOpenFilters(!openFilters)}
          >
            <ListFilter aria-hidden className="icon-sm" strokeWidth={1.75} />
          </Button>
          {!limitsOnly && view !== "limits" && (
            <Button
              variant="ghost"
              iconOnly
              label={t("Refresh usage")}
              loading={refreshing}
              onClick={refreshData}
            >
              <RefreshCw aria-hidden className="icon-sm" strokeWidth={1.75} />
            </Button>
          )}
        </div>
      </div>
      {openDateRange && preset === "custom" && (
        <Popover
          anchor={dateAnchor}
          align="start"
          width={350}
          kind="dialog"
          aria-label={t("Custom date and time")}
          variant="panel"
          onDismiss={() => setOpenDateRange(false)}
        >
          <div className="usage-filter-panel">
            <DateTimeRangePicker
              required
              minuteStep={15}
              min={new Date(0)}
              max={new Date(new Date().setHours(24, 0, 0, 0))}
              value={{ start: new Date(window.start), end: new Date(window.end) }}
              onChange={(range) => {
                setPreset("custom");
                setInterval({ start: range.start.getTime(), end: range.end.getTime() });
                setSelectedSession(null);
              }}
            />
          </div>
        </Popover>
      )}
      {openFilters && (
        <Popover
          anchor={filterAnchor}
          align="end"
          width={350}
          kind="dialog"
          aria-label={t("Filters")}
          variant="panel"
          onDismiss={() => setOpenFilters(false)}
        >
          <div className="usage-filter-panel">
            <SectionLabel>{t("Filters")}</SectionLabel>
            {filterKeys.map((key) => (
              <SearchableSelect
                key={key}
                multiple
                label={names[key]}
                placeholder={t("All")}
                value={effectiveFilters[key]}
                options={[...options[key]].map(([value, label]) => ({
                  value,
                  label: key === "model" ? label : usageLabel(label),
                  ...(key === "provider" || key === "account"
                    ? {
                        icon: (
                          <UsageProviderIdentity
                            provider={key === "provider" ? value : value.split(":")[0]}
                            label=""
                          />
                        ),
                      }
                    : {}),
                  ...(key === "model"
                    ? {
                        icon: (
                          <ModelLabel model={value} harness={modelProviders.get(value)} iconOnly />
                        ),
                        keywords: value,
                      }
                    : {}),
                }))}
                onChange={(values) => {
                  setFilters((f) => ({ ...f, [key]: values }));
                  setSelectedSession(null);
                }}
              />
            ))}
            <Button
              variant="ghost"
              onClick={() => {
                setFilters((current) =>
                  view === "limits"
                    ? { ...current, provider: [], account: [] }
                    : emptyUsageFilters(),
                );
                setSelectedSession(null);
              }}
            >
              {t("Reset filters")}
            </Button>
          </div>
        </Popover>
      )}
      {view !== "limits" && firstLoad && <SettingsPageLoading label={t("Loading usage…")} />}
      {view !== "limits" && unavailable && (
        <InlineError retry={{ onRetry: refreshData, pending: refreshing }}>
          {load.error
            ? t("Usage could not be read for the selected accounts. Reload usage to try again.")
            : t(
                "Recorded session logs could not be read. Duration and session totals may be incomplete.",
              )}
        </InlineError>
      )}
      {view !== "limits" && partial && (
        <Alert tone="warning">
          {(load.failed > 0 || stale) &&
            (stale
              ? t("Previous usage remains visible. Some sources could not be refreshed.")
              : t("Some account logs could not be read. Totals are partial."))}
          {load.turnsFailed && (
            <p>
              {t(
                "Recorded session logs could not be read. Duration and session totals may be incomplete.",
              )}
            </p>
          )}
          {load.turns?.truncated ? (
            <p>
              {t("Session data is limited to the latest 50,000 turns. Select a shorter interval.")}
            </p>
          ) : null}
        </Alert>
      )}
      {view !== "limits" && showAnalytics && (
        <>
          {prices === undefined && !isEmptyPeriod && (
            <Text as="p" size="caption" tone="secondary" leading="inherit">
              {t("Using built-in prices while model prices load.")}
            </Text>
          )}
          {/* One empty state replaces every tile, chart and panel; refreshing is shown by aria-busy. */}
          {isEmptyPeriod ? (
            <EmptyState
              size="inline"
              kind={activeFilters.length ? "filtered" : "empty"}
              description={
                activeFilters.length
                  ? t("No usage matches these filters.")
                  : t("No usage recorded in this period.")
              }
              {...(activeFilters.length
                ? {
                    onReset: () => {
                      setFilters(emptyUsageFilters());
                      setSelectedSession(null);
                    },
                    resetLabel: t("Reset filters"),
                  }
                : {})}
            />
          ) : null}
          {isEmptyPeriod
            ? null
            : view === "overview" && (
                <>
                  <div className="usage-metrics">
                    {(
                      [
                        "cost",
                        "tokens",
                        "duration",
                        ...(showDetails ? ["input", "output", "cacheRead", "cacheWrite"] : []),
                      ] as UsageMetric[]
                    ).map((key) => {
                      const previousValue = previousTotals[key];
                      const change =
                        key !== "duration" &&
                        preset !== "all" &&
                        previousValue > 0 &&
                        !load.failed &&
                        (key !== "cost" || (!unpriced.length && previous.every((s) => s.priced)))
                          ? ((totals[key] - previousValue) / previousValue) * 100
                          : null;
                      return (
                        <div key={key}>
                          <Button
                            variant="link"
                            selected={metric === key}
                            onClick={() => setMetric(key)}
                          >
                            {metricName(key)}
                          </Button>
                          <Text
                            as="strong"
                            size="heading"
                            tone="primary"
                            weight="medium"
                            leading="inherit"
                          >
                            {!load.refreshedAt ||
                            (key !== "duration" && !!load.error && !filtered.length) ||
                            (key === "duration" && load.turns === null) ||
                            (key === "cost" && unpriced.length > 0 && pricedTokens === 0)
                              ? "—"
                              : `${key === "cost" && unpriced.length ? "≥ " : ""}${formatMetric(totals[key], key)}`}
                          </Text>
                          {/* One subline at most: the change against the previous period. What the numbers
                          are ("API-equivalent, not billed", elapsed time) is stated in the data notes. */}
                          {key === "cost" && (!totals.tokens || pricedTokens < totals.tokens) ? (
                            <Text as="small" size="caption" tone="secondary" leading="inherit">
                              {`${t("Priced token coverage")}: ${
                                totals.tokens
                                  ? formatUsagePercent((pricedTokens / totals.tokens) * 100)
                                  : "—"
                              }`}
                            </Text>
                          ) : change != null ? (
                            <Text as="small" size="caption" tone="secondary" leading="inherit">
                              {t("{p0} vs previous period", {
                                p0: `${change >= 0 ? "+" : ""}${formatUsagePercent(change)}`,
                              })}
                            </Text>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  <Disclosure
                    size="sm"
                    className="usage-details-disclosure"
                    summary={t("Usage details")}
                    open={showDetails}
                    onOpenChange={setShowDetails}
                  >
                    <Text
                      as="div"
                      size="caption"
                      tone="secondary"
                      leading="inherit"
                      className="usage-facts"
                    >
                      <span>
                        {t("Cache hit rate")}{" "}
                        <Text as="b" size="inherit" tone="primary" weight="medium">
                          {inputTotal
                            ? formatUsagePercent((totals.cacheRead / inputTotal) * 100)
                            : "—"}
                        </Text>
                      </span>
                      <span>
                        {t("Cache savings")}{" "}
                        <Text as="b" size="inherit" tone="primary" weight="medium">
                          {unpriced.length ? "≥ " : ""}
                          {formatMetric(cacheSavings, "cost")}
                        </Text>
                      </span>
                      <span>
                        {t("Active days")}{" "}
                        <Text as="b" size="inherit" tone="primary" weight="medium">
                          {activeDays}
                        </Text>
                      </span>
                      <span>
                        {t("Cost per active day")}{" "}
                        <Text as="b" size="inherit" tone="primary" weight="medium">
                          {activeDays
                            ? `${unpriced.length ? "≥ " : ""}${formatMetric(totals.cost / activeDays, "cost")}`
                            : "—"}
                        </Text>
                      </span>
                    </Text>
                  </Disclosure>
                </>
              )}
          {!isEmptyPeriod && view === "overview" && actualResolution !== resolution && (
            <Text as="p" leading="inherit" className="usage-muted">
              {t(
                "The chart uses a coarser resolution to show the entire interval. Select a shorter range for more detail.",
              )}
            </Text>
          )}
          {!isEmptyPeriod && !limitsOnly && view !== "limits" && (
            <div className="usage-controls usage-chart-options">
              {/* The metric tiles choose the metric on Overview; the other views have no tiles. */}
              {view !== "overview" && (
                <Select
                  hideLabel
                  label={t("Chart metric")}
                  value={metric}
                  onValueChange={(v) => setMetric(v as UsageMetric)}
                  options={metricKeys.map((value) => ({
                    value,
                    label: metricName(value),
                  }))}
                />
              )}
              {view !== "time" && (
                <Select
                  hideLabel
                  label={t("Group by")}
                  value={dimension}
                  onValueChange={(v) => setDimension(v as UsageDimension)}
                  options={(["provider", "account", "model", "project"] as const).map((value) => ({
                    value,
                    label: names[value],
                  }))}
                />
              )}
              {view === "overview" && (
                <Select
                  hideLabel
                  label={t("Resolution")}
                  value={resolution}
                  onValueChange={(v) => setResolution(v as UsageResolution)}
                  options={[
                    { value: "15m", label: t("15 minutes") },
                    { value: "hour", label: t("Hourly") },
                    { value: "day", label: t("Daily") },
                    { value: "week", label: t("Weekly") },
                  ]}
                />
              )}
            </div>
          )}
          {!isEmptyPeriod && view === "overview" && !metricUnavailable && (
            <>
              <div className="usage-overview-main">
                <UsageTrend
                  {...chart}
                  metric={metric}
                  resolution={actualResolution}
                  percent={false}
                  onSelect={chooseInterval}
                  colors={colors}
                  dimension={dimension}
                />
                <UsageShare
                  rows={providers}
                  metric={metric}
                  colors={providerColors}
                  onSelect={(value) => chooseFilter("provider", value)}
                />
              </div>
              <div className="usage-analysis-grid">
                <Contribution
                  title={t("Leading projects")}
                  rows={projects}
                  metric={metric}
                  colors={projectColors}
                  onSelect={(value) => {
                    chooseFilter("project", value);
                    setView("projects");
                  }}
                />
                <Contribution
                  title={t("By model")}
                  rows={models}
                  metric={metric}
                  colors={modelColors}
                  onSelect={(value) => chooseFilter("model", value)}
                />
              </div>
            </>
          )}
          {!isEmptyPeriod && view === "time" && !metricUnavailable && (
            <TimeDistribution
              samples={chartSamples}
              metric={metric}
              window={window}
              onSelect={chooseInterval}
            />
          )}
          {!isEmptyPeriod && view === "projects" && !metricUnavailable && (
            <>
              <div
                className="usage-section-heading"
                id="setting-provider-usage"
                data-setting-id="provider-usage"
              >
                <Heading size="item" level={3}>
                  {t("Usage breakdown")}
                </Heading>
                <div className="usage-controls usage-search-actions">
                  <SearchInput
                    appearance="field"
                    aria-label={t("Search usage")}
                    placeholder={t("Search usage")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("Export CSV")}
                    onClick={exportCsv}
                  >
                    <ArrowDownCircle aria-hidden className="icon-sm" strokeWidth={1.75} />
                    {t("Export CSV")}
                  </Button>
                </div>
              </div>
              <div className="usage-overview-main">
                <Contribution
                  title={names[dimension]}
                  rows={matchedRows}
                  metric={metric}
                  colors={colors}
                  onSelect={(value) => chooseFilter(dimension, value)}
                />
                {/* Grouped by provider, the breakdown already is the provider share. */}
                {dimension === "provider" ? null : (
                  <UsageShare
                    rows={providers}
                    metric={metric}
                    colors={providerColors}
                    onSelect={(value) => chooseFilter("provider", value)}
                  />
                )}
              </div>
              <Disclosure
                summary={t("Show as table")}
                size="sm"
                open={showProjectTable}
                onOpenChange={setShowProjectTable}
              >
                <ContinuousUsageTable
                  stateKey={JSON.stringify(["usage-breakdown", dimension, filters, search, preset])}
                  caption={t("Usage breakdown")}
                  rows={matchedRows}
                  metric={metric}
                  onSelect={(value) => chooseFilter(dimension, value)}
                />
              </Disclosure>
              <UsageRecordedSessions
                unavailable={load.turns === null}
                stateKey={JSON.stringify(["usage-sessions", selectedSession, filters, preset])}
                sessionRows={sessionRows}
                turnRows={turnRows}
                selectedSession={selectedSession}
                onSelectSession={setSelectedSession}
              />
            </>
          )}
          {isEmptyPeriod ? null : (
            <UsageDataNotes
              unpriced={unpriced}
              pricedCoverage={
                totals.tokens ? formatUsagePercent((pricedTokens / totals.tokens) * 100) : "—"
              }
              pricesUnavailable={prices === null}
              sessionDurationUnavailable={load.turns === null}
              timedTurns={sessions.reduce((n, s) => n + s.timedTurns, 0)}
              turns={sessions.reduce((n, s) => n + s.turns, 0)}
              truncated={Boolean(load.turns?.truncated)}
            />
          )}
        </>
      )}
      {limits && limitsVisited && (
        <Activity mode={view === "limits" ? "visible" : "hidden"}>
          <div hidden={view !== "limits"} className="usage-limits-view">
            {limits(quotaFilters)}
            <QuotaHistory window={window} filters={quotaFilters} accounts={accounts} />
          </div>
        </Activity>
      )}
    </section>
  );
}
