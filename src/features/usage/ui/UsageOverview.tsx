import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Select } from "../../../shared/ui/Select";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { SlotText } from "../../../shared/ui/SlotText";
import { useDecorativeMotionPreference } from "../../settings/model/decorativeMotion";
import { DateTimeRangePicker } from "../../../shared/ui/DateTimeRangePicker";
import { ArrowDownCircle, ListFilter, RefreshCw } from "../../../shared/ui/icons";
import {
  PROVIDER_ACCOUNT_PROVIDERS,
  providerAccounts,
  subscribeProviderAccounts,
} from "../../providers/model/providerAccounts";
import {
  createUsagePricing,
  fetchModelPrices,
  fetchProviderUsage,
  type AccountUsage,
  type ModelPrices,
} from "../../providers/model/providerUsage";
import { useLockSnapshot } from "../../group-lock/hooks/useGroupLock";
import { isProjectLockedIn } from "../../group-lock/model/lockState";
import { RevealedSetting } from "../../settings/ui/settingsControls";
import { railGroupLookup } from "../model/railGroups";
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
import { formatMetric, formatUsagePercent, metricNames, PagedUsageTable } from "./UsageCharts";
import { Contribution, TimeDistribution, UsageShare, UsageTrend } from "./UsageVisualizations";
import { usageColorMap } from "../model/usageColors";
import { QuotaHistory } from "./UsageQuotaHistory";
import "./UsageAnalytics.css";

type Preset = "today" | "yesterday" | "7d" | "30d" | "90d" | "all" | "custom";
const presetLabels: Record<Preset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  all: "All time",
  custom: "Custom date and time",
};
type Load = {
  queryKey: string;
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
function presetWindow(preset: Preset, now: number): UsageWindow {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (preset === "yesterday") {
    const end = start.getTime();
    start.setDate(start.getDate() - 1);
    return { start: start.getTime(), end };
  }
  if (["7d", "30d", "90d"].includes(preset))
    start.setDate(start.getDate() - Number(preset.slice(0, -1)) + 1);
  return { start: preset === "all" ? 0 : start.getTime(), end: Math.ceil(now / 900_000) * 900_000 };
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
  const decorativeMotion = useDecorativeMotionPreference();
  const revealed = useContext(RevealedSetting);
  const [selection, setSelection] = useState({ view: "overview", revealed });
  const view = limitsOnly ? "limits" : selection.view;
  const setView = (next: string) => {
    setSelection({ view: next, revealed });
    if (next === "projects") setDimension("project");
  };
  if (selection.revealed !== revealed) {
    setSelection({
      revealed,
      view:
        revealed === "account-limits" ||
        revealed === "usage-budgets" ||
        revealed === "show-remaining-usage"
          ? "limits"
          : revealed === "provider-usage"
            ? "projects"
            : revealed === "cost-overview"
              ? "overview"
              : view,
    });
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
  const [dimension, setDimension] = useState<UsageDimension>("provider");
  const [resolution, setResolution] = useState<UsageResolution>("day");
  const [openFilters, setOpenFilters] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [reload, setReload] = useState(0);
  const [version, setVersion] = useState(0);
  const [load, setLoad] = useState<Load>(initialLoad);
  const [prices, setPrices] = useState<ModelPrices | null | undefined>();
  const [search, setSearch] = useState("");
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const filterAnchor = useRef<HTMLButtonElement>(null);
  useEffect(() => subscribeProviderAccounts(() => setVersion((v) => v + 1)), []);
  const accounts = useMemo(() => PROVIDER_ACCOUNT_PROVIDERS.flatMap(providerAccounts), [version]);
  const pricing = useMemo(() => createUsagePricing(prices?.models), [prices]);
  const since = preset === "all" ? 0 : Math.max(0, previousUsageWindow(interval).start);
  const queryKey = `${since}:${interval.end}:${reload}:${refresh}:${version}`;
  const refreshing = !limitsOnly && load.queryKey !== queryKey;
  useEffect(() => {
    if (limitsOnly) return;
    let cancelled = false;
    void Promise.all([
      Promise.all(
        accounts.map(async (account) => {
          try {
            const report = await fetchProviderUsage(
              account.provider,
              account.id,
              Math.floor(since / 900_000) * 900_000,
            );
            return { account, rows: report.rows, failed: false };
          } catch {
            return { account, rows: [], failed: true };
          }
        }),
      ),
      invoke<UsageTurnReport>("session_usage_report", {
        sinceMs: since,
        untilMs: interval.end,
      }).catch(() => null),
      fetchModelPrices().catch(() => null),
    ]).then(([reports, turns, nextPrices]) => {
      if (cancelled) return;
      const failed = reports.filter((r) => r.failed).length;
      setLoad((previousLoad) => ({
        queryKey,
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
      setPrices(nextPrices);
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
            start: samples.reduce(
              (n, s) => Math.min(n, s.at),
              turns.reduce((n, turn) => Math.min(n, turn.startedAt), interval.end - 86_400_000),
            ),
            end: interval.end,
          }
        : interval,
    [interval, preset, samples, turns],
  );
  const filtered = useMemo(() => filterUsage(samples, filters, window), [samples, filters, window]);
  const previous = useMemo(
    () => filterUsage(samples, filters, previousUsageWindow(window)),
    [samples, filters, window],
  );
  const runtime = useMemo(
    () => durationSamples(turns, window, filters, groupFor),
    [turns, window, filters, groupFor],
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
    () => usageBreakdown(chartSamples, "model", metric),
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
      result.provider.set(s.provider, s.provider);
      result.account.set(s.account, `${s.provider} · ${s.accountLabel}`);
      result.model.set(s.model, s.model);
      result.project.set(s.project, s.projectLabel);
      result.group.set(s.group, s.groupLabel);
    }
    return result;
  }, [samples, runtime]);
  const activeFilters = Object.entries(filters).flatMap(([key, values]) =>
    values.map((value: string) => ({ key: key as keyof UsageFilters, value })),
  );
  const names: Record<keyof UsageFilters, string> = {
    provider: "Provider",
    account: "Account",
    project: "Project",
    model: "Model",
    group: "Workspace",
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
  const unpriced = [...new Set(filtered.filter((s) => !s.priced).map((s) => s.model))];
  const pricedTokens = filtered.filter((s) => s.priced).reduce((n, s) => n + s.tokens, 0);
  const activeDays = new Set(
    filtered.filter((s) => s.tokens > 0).map((s) => new Date(s.at).toDateString()),
  ).size;
  const inputTotal = totals.input + totals.cacheRead + totals.cacheWrite;
  const cacheSavings = filtered.reduce((sum, sample) => {
    const rate = pricing(sample.model);
    return sum + (rate ? (sample.cacheRead * (rate.input - rate.cacheRead)) / 1_000_000 : 0);
  }, 0);
  const matchedRows = breakdown.filter((row) =>
    row.label.toLocaleLowerCase(locale).includes(search.toLocaleLowerCase(locale)),
  );
  const sessionRows = sessions.filter(
    (row) =>
      `${row.title} ${row.project}`
        .toLocaleLowerCase(locale)
        .includes(search.toLocaleLowerCase(locale)) &&
      (!selectedSession || row.key === selectedSession),
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
                      label: new Date(turn.startedAt).toLocaleString(locale),
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
  const partial = !unavailable && (load.failed > 0 || load.turnsFailed);
  const hasFilteredData = filtered.length > 0 || runtime.length > 0;
  const showAnalytics = !firstLoad && !unavailable;
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
      {view === "projects" && (!showAnalytics || metricUnavailable) && (
        <div id="setting-provider-usage" data-setting-id="provider-usage" />
      )}
      <div className="usage-analytics-header">
        <div>
          <p>
            {t(limitsOnly ? "This machine" : "This machine · Local session logs")} ·{" "}
            {Intl.DateTimeFormat().resolvedOptions().timeZone}
            {load.refreshedAt > 0 &&
              !partial &&
              !unavailable &&
              ` · ${t("Updated")} ${new Date(load.refreshedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false })}`}
          </p>
        </div>
        <div className="usage-analytics-actions">
          <Select
            label={t("Date range")}
            value={preset}
            options={Object.entries(presetLabels)
              .filter(([key]) => key !== "custom" || preset === "custom")
              .map(([value, label]) => ({ value, label: t(label) }))}
            onValueChange={(v) => {
              setPreset(v as Preset);
              setInterval(presetWindow(v as Preset, Date.now()));
            }}
          />

          <Button
            ref={filterAnchor}
            variant="ghost"
            iconOnly
            label={`${t("Filters")}${activeFilters.length ? ` (${activeFilters.length})` : ""}`}
            selected={!!activeFilters.length}
            aria-haspopup="dialog"
            aria-expanded={openFilters}
            onClick={() => setOpenFilters(!openFilters)}
          >
            <ListFilter className="icon-sm" />
          </Button>
          {!limitsOnly && view !== "limits" && !unavailable && !partial && (
            <Button
              variant="ghost"
              iconOnly
              label={t("Refresh usage")}
              loading={refreshing}
              onClick={refreshData}
            >
              <RefreshCw className="icon-sm" />
            </Button>
          )}
        </div>
      </div>
      {openFilters && (
        <Popover
          anchor={filterAnchor}
          align="end"
          width={350}
          role="dialog"
          aria-label={t("Filters")}
          onDismiss={() => setOpenFilters(false)}
          autoFocus
        >
          <div className="usage-filter-panel">
            <h3>{t("Filters")}</h3>
            <DateTimeRangePicker
              minDate={new Date(0)}
              maxDate={new Date(new Date().setHours(24, 0, 0, 0))}
              value={{ start: new Date(window.start), end: new Date(window.end) }}
              onChange={(range) => {
                setPreset("custom");
                setInterval({ start: range.start.getTime(), end: range.end.getTime() });
                setSelectedSession(null);
              }}
            />
            {!limitsOnly && view !== "limits" && (
              <>
                <h3>{t("Chart options")}</h3>
                <div className="usage-controls">
                  <Select
                    label={t("Chart metric")}
                    value={metric}
                    onValueChange={(v) => setMetric(v as UsageMetric)}
                    options={Object.entries(metricNames).map(([value, label]) => ({
                      value,
                      label: t(label),
                    }))}
                  />
                  {view !== "time" && (
                    <Select
                      label={t("Group by")}
                      value={dimension}
                      onValueChange={(v) => setDimension(v as UsageDimension)}
                      options={(["provider", "account", "model", "project"] as const).map(
                        (value) => ({
                          value,
                          label: t(names[value]),
                        }),
                      )}
                    />
                  )}
                  {view === "overview" && (
                    <>
                      <Select
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
                    </>
                  )}
                </div>
              </>
            )}
            {(Object.keys(filters) as (keyof UsageFilters)[]).map((key) => (
              <div key={key} className="grid min-w-0 gap-1">
                <span className="text-ui-caption text-(--ui-text-secondary)">{t(names[key])}</span>
                <SearchableSelect
                  multiple
                  label={t(names[key])}
                  placeholder={t("All")}
                  value={filters[key]}
                  options={[...options[key]].map(([value, label]) => ({ value, label: t(label) }))}
                  onChange={(values) => {
                    setFilters((f) => ({ ...f, [key]: values }));
                    setSelectedSession(null);
                  }}
                />
              </div>
            ))}
            <Button
              variant="ghost"
              onClick={() => {
                setFilters(emptyUsageFilters());
                setSelectedSession(null);
              }}
            >
              {t("Reset filters")}
            </Button>
          </div>
        </Popover>
      )}

      {!limitsOnly && (
        <SegmentedControl
          label={t("Usage views")}
          value={view}
          onValueChange={setView}
          options={[
            { value: "overview", label: t("Overview") },
            { value: "projects", label: t("Projects") },
            { value: "time", label: t("Time analysis") },
            ...(limits ? [{ value: "limits", label: t("Limits") }] : []),
          ]}
        />
      )}
      {view !== "limits" && firstLoad && (
        <p role="status" className="usage-empty">
          {t("Loading usage…")}
        </p>
      )}
      {view !== "limits" && unavailable && (
        <Alert tone="danger" role="alert">
          <p>
            {t(
              load.error ??
                "Recorded session logs could not be read. Duration and session totals may be incomplete.",
            )}
          </p>
          <Button variant="secondary" loading={refreshing} onClick={refreshData}>
            {t("Refresh usage")}
          </Button>
        </Alert>
      )}
      {view !== "limits" && partial && (
        <Alert tone="warning">
          {(load.failed > 0 || stale) &&
            t(
              stale
                ? "Previous usage remains visible. Some sources could not be refreshed."
                : "Some account logs could not be read. Totals are partial.",
            )}
          {load.turnsFailed && (
            <p>
              {t(
                "Recorded session logs could not be read. Duration and session totals may be incomplete.",
              )}
            </p>
          )}
          <Button variant="ghost" loading={refreshing} onClick={refreshData}>
            {t("Refresh usage")}
          </Button>
        </Alert>
      )}
      {view !== "limits" && showAnalytics && (
        <>
          {refreshing && load.refreshedAt > 0 && (
            <p role="status" className="usage-muted">
              {t("Refreshing usage… Previous results remain visible.")}
            </p>
          )}
          {view === "overview" && (
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
                        {t(metricNames[key])}
                      </Button>
                      <strong>
                        <SlotText
                          motion={decorativeMotion ? "auto" : "none"}
                          value={
                            !load.refreshedAt ||
                            (key !== "duration" && !!load.error && !filtered.length) ||
                            (key === "duration" && load.turns === null) ||
                            (key === "cost" && unpriced.length > 0 && pricedTokens === 0)
                              ? "—"
                              : `${key === "cost" && unpriced.length ? "≥ " : ""}${formatMetric(totals[key], key)}`
                          }
                        />
                      </strong>
                      <small>
                        {change == null
                          ? t(
                              key === "cost"
                                ? "API-equivalent, not billed"
                                : key === "duration"
                                  ? "Recorded turn elapsed time"
                                  : "tokens",
                            )
                          : `${change >= 0 ? "+" : ""}${formatUsagePercent(change)} ${t("vs previous period")}`}
                      </small>
                    </div>
                  );
                })}
              </div>
              <Button
                variant="ghost"
                aria-expanded={showDetails}
                onClick={() => setShowDetails(!showDetails)}
              >
                {t("Usage details")}
              </Button>
              {showDetails && (
                <div className="usage-facts">
                  <span>
                    {t("Total tokens")} <b>{formatMetric(totals.tokens, "tokens")}</b>
                  </span>
                  <span>
                    {t("Cache hit rate")}{" "}
                    <b>
                      {inputTotal ? formatUsagePercent((totals.cacheRead / inputTotal) * 100) : "—"}
                    </b>
                  </span>
                  <span>
                    {t("Cache savings")}{" "}
                    <b>
                      {unpriced.length ? "≥ " : ""}
                      {formatMetric(cacheSavings, "cost")}
                    </b>
                  </span>
                  <span>
                    {t("Active days")} <b>{activeDays}</b>
                  </span>
                  <span>
                    {t("Cost per active day")}{" "}
                    <b>
                      {activeDays
                        ? `${unpriced.length ? "≥ " : ""}${formatMetric(totals.cost / activeDays, "cost")}`
                        : "—"}
                    </b>
                  </span>
                </div>
              )}
            </>
          )}
          {view === "overview" && actualResolution !== resolution && (
            <p className="usage-muted">
              {t(
                "The chart uses a coarser resolution to show the entire interval. Select a shorter range for more detail.",
              )}
            </p>
          )}
          {!refreshing && !hasFilteredData && !partial && (
            <Alert tone="info">
              {t(
                activeFilters.length
                  ? "No usage matches these filters."
                  : "No usage recorded in this period.",
              )}
            </Alert>
          )}
          {view === "overview" && !metricUnavailable && (
            <>
              <div className="usage-overview-main">
                <UsageTrend
                  {...chart}
                  metric={metric}
                  resolution={actualResolution}
                  percent={false}
                  onSelect={chooseInterval}
                  colors={colors}
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
          {view === "time" && !metricUnavailable && (
            <TimeDistribution
              samples={chartSamples}
              metric={metric}
              window={window}
              onSelect={chooseInterval}
            />
          )}
          {view === "projects" && !metricUnavailable && (
            <>
              <div
                className="usage-section-heading"
                id="setting-provider-usage"
                data-setting-id="provider-usage"
              >
                <h3>{t("Usage breakdown")}</h3>
                <SearchInput
                  aria-label={t("Search usage")}
                  placeholder={t("Search usage")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <Button variant="secondary" onClick={exportCsv}>
                  <ArrowDownCircle className="icon-sm" />
                  {t("Export CSV")}
                </Button>
              </div>
              <PagedUsageTable
                key={dimension}
                caption={t("Usage breakdown")}
                rows={matchedRows}
                metric={metric}
                onSelect={(value) => chooseFilter(dimension, value)}
              />
              {load.turns !== null ? (
                <section className="usage-panel">
                  <div className="usage-section-heading">
                    <h3>{t("Recorded sessions")}</h3>
                    {selectedSession && (
                      <Button variant="ghost" onClick={() => setSelectedSession(null)}>
                        {t("All sessions")}
                      </Button>
                    )}
                  </div>
                  <p className="usage-muted">
                    {t(
                      "Session tokens come from recorded turn metrics. Only whole turns inside the interval are included; these values are not added to provider-log totals.",
                    )}
                  </p>
                  <PagedUsageTable
                    key={`sessions:${selectedSession ?? "all"}`}
                    caption={t("Recorded sessions")}
                    metric="duration"
                    rows={sessionRows.map((row) => ({
                      ...row,
                      label: row.title || row.key,
                      duration: row.timedTurns ? row.duration : null,
                      cost: row.meteredTurns > row.unpricedTurns ? row.cost : null,
                      tokens: row.meteredTurns ? row.tokens : null,
                      input: row.meteredTurns ? row.input : null,
                      output: row.meteredTurns ? row.output : null,
                      cacheRead: row.meteredTurns ? row.cacheRead : null,
                      cacheWrite: row.meteredTurns ? row.cacheWrite : null,
                    }))}
                    onSelect={setSelectedSession}
                  />
                  {selectedSession &&
                    sessionRows.map((row) => (
                      <p className="usage-muted" key={row.key}>
                        {row.title} · {row.provider} · {row.timedTurns}/{row.turns}{" "}
                        {t("turns with duration")} · {row.meteredTurns}/{row.turns}{" "}
                        {t("turns with tokens")} · {row.unpricedTurns} {t("unpriced turns")}
                      </p>
                    ))}
                  {selectedSession && (
                    <PagedUsageTable
                      caption={t("Recorded turns")}
                      rows={turnRows}
                      metric="duration"
                    />
                  )}
                </section>
              ) : (
                <Alert tone="info">
                  {t(
                    "Session duration data is unavailable on this app version or could not be read.",
                  )}
                </Alert>
              )}
            </>
          )}
          <details className="usage-data-notes">
            <summary>
              {t("Data sources and coverage")}
              {unpriced.length ? ` · ${unpriced.length} ${t("Models without prices")}` : ""}
            </summary>
            <p>
              {t(
                "API-equivalent estimates from local session logs, not what a subscription plan bills.",
              )}{" "}
              {t("Priced token coverage")}:{" "}
              {totals.tokens ? formatUsagePercent((pricedTokens / totals.tokens) * 100) : "—"}.
            </p>
            {unpriced.length > 0 && (
              <p>
                {t("Models without prices")}: {unpriced.join(", ")}.{" "}
                {t("Their tokens are included; their cost is unavailable.")}
              </p>
            )}
            {prices === null && (
              <p>{t("OpenRouter prices could not be loaded, so built-in prices are used.")}</p>
            )}
            {load.turns === null ? (
              <p>
                {t(
                  "Session duration data is unavailable on this app version or could not be read.",
                )}
              </p>
            ) : (
              <p>
                {t(
                  "Agent time sums recorded completed turn intervals and may include waiting. Parallel sessions can exceed wall-clock time.",
                )}{" "}
                {sessions.reduce((n, s) => n + s.timedTurns, 0)}/
                {sessions.reduce((n, s) => n + s.turns, 0)} {t("turns with duration")}.
              </p>
            )}
            {load.turns?.truncated && (
              <p>
                {t(
                  "Session data is limited to the latest 50,000 turns. Select a shorter interval.",
                )}
              </p>
            )}
            <p>{t("Token timestamps have 15-minute precision. End time is exclusive.")}</p>
          </details>
        </>
      )}
      <div hidden={view !== "limits"}>
        {limits?.(filters)}
        {limits && <QuotaHistory window={window} filters={filters} accounts={accounts} />}
      </div>
    </section>
  );
}
