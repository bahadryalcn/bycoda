import { Text } from "../../../shared/ui/Text";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Disclosure } from "../../../shared/ui/Disclosure";
import {
  useContext,
  useDeferredValue,
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
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Select } from "../../../shared/ui/Select";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Heading } from "../../../shared/ui/Heading";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { SearchInput } from "../../../shared/ui/SearchInput";
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
import { SettingsPageLoading } from "../../settings/public/settingsControls";
import { recallUsageLoad, rememberUsageLoad } from "../model/usageLoadCache";
import { railGroupLookup } from "../model/railGroups";
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
  metricNames,
  UsageDataNotes,
} from "./UsageCharts";
import { Contribution, TimeDistribution, UsageShare, UsageTrend } from "./UsageVisualizations";
import { usageColorMap } from "../model/usageColors";
import { QuotaHistory } from "./UsageQuotaHistory";
import { UsageRecordedSessions } from "./UsageRecordedSessions";
import { usageProviderLabel, UsageProviderIdentity } from "./UsageProviderIdentity";
import { useRateLimitHistory } from "../../providers/model/rateLimitHistory";
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
  const revealed = useContext(RevealedSetting);
  const [selection, setSelection] = useState({ view: "overview", revealed });
  const view = limitsOnly ? "limits" : selection.view;
  const setView = (next: string) => {
    setSelection({ view: next, revealed });
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
  const [overviewDimension, setOverviewDimension] = useState<UsageDimension>("provider");
  const [projectDimension, setProjectDimension] = useState<UsageDimension>("project");
  const dimension = view === "projects" ? projectDimension : overviewDimension;
  const setDimension = view === "projects" ? setProjectDimension : setOverviewDimension;
  const [resolution, setResolution] = useState<UsageResolution>("day");
  const [openFilters, setOpenFilters] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showProjectTable, setShowProjectTable] = useState(false);
  const [reload, setReload] = useState(0);
  const [version, setVersion] = useState(0);
  const [load, setLoad] = useState<Load>(() => recallUsageLoad(interval, initialLoad));
  useEffect(() => rememberUsageLoad(load), [load]);
  const [prices, setPrices] = useState<ModelPrices | null | undefined>();
  const [search, setSearch] = useState("");
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const filterAnchor = useRef<HTMLButtonElement>(null);
  useEffect(() => subscribeProviderAccounts(() => setVersion((v) => v + 1)), []);
  const accounts = useMemo(() => PROVIDER_ACCOUNT_PROVIDERS.flatMap(providerAccounts), [version]);
  const quotaHistory = useRateLimitHistory();
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
      result.provider.set(s.provider, usageProviderLabel(s.provider));
      result.account.set(s.account, `${usageProviderLabel(s.provider)} · ${s.accountLabel}`);
      result.model.set(s.model, s.model);
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
    return searchRows(breakdown, (row) => row.label, deferredSearch, locale).map((row) => ({
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
  const partial = !unavailable && (load.failed > 0 || load.turnsFailed || !!load.turns?.truncated);
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
      <div className="usage-band">
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
        <div className="usage-band-scope">
          <Text as="p" leading="inherit">
            {t("This machine")}
          </Text>
          <InfoPopover label={t("Data sources and coverage")}>
            <p>{t(limitsOnly ? "This machine" : "This machine · Local session logs")}</p>
            <p>{Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
            {view !== "limits" && load.refreshedAt > 0 && !partial && !unavailable && (
              <p>
                {t("Updated")}{" "}
                {new Date(load.refreshedAt).toLocaleTimeString(locale, {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })}
              </p>
            )}
          </InfoPopover>
          {view === "limits" ? (
            <InfoPopover label={t("About limit filters")}>
              {t(
                "Provider and account filters apply to account limits and history. Local budget rules keep their own scope.",
              )}
            </InfoPopover>
          ) : null}
        </div>
        <div className="usage-analytics-actions">
          <Select
            hideLabel
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
            label={`${t("Filters")}${activeFilterCount ? ` (${activeFilterCount})` : ""}`}
            selected={!!activeFilters.length}
            aria-haspopup="dialog"
            aria-expanded={openFilters}
            onClick={() => setOpenFilters(!openFilters)}
          >
            <ListFilter aria-hidden className="icon-sm" strokeWidth={1.75} />
          </Button>
          {!limitsOnly && view !== "limits" && !unavailable && !partial && (
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
            <SectionLabel>{t("Filters")}</SectionLabel>
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
            {!limitsOnly && view !== "limits" && (
              <>
                <SectionLabel>{t("Chart options")}</SectionLabel>
                <div className="usage-controls">
                  <Select
                    hideLabel
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
                      hideLabel
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
                    </>
                  )}
                </div>
              </>
            )}
            {filterKeys.map((key) => (
              <SearchableSelect
                key={key}
                multiple
                label={t(names[key])}
                placeholder={t("All")}
                value={effectiveFilters[key]}
                options={[...options[key]].map(([value, label]) => ({
                  value,
                  label: t(label),
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
        <Alert tone="danger">
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
          {load.turns?.truncated ? (
            <p>
              {t("Session data is limited to the latest 50,000 turns. Select a shorter interval.")}
            </p>
          ) : null}
          <Button variant="ghost" loading={refreshing} onClick={refreshData}>
            {t("Refresh usage")}
          </Button>
        </Alert>
      )}
      {view !== "limits" && showAnalytics && (
        <>
          {refreshing && load.refreshedAt > 0 && (
            <LoadingText
              presentation="text"
              size="caption"
              tone="secondary"
              leading="inherit"
              className="usage-muted"
            >
              {t("Refreshing usage… Previous results remain visible.")}
            </LoadingText>
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
                      {key === "cost" ? (
                        <Text as="small" size="caption" tone="secondary" leading="inherit">
                          {t("API-equivalent, not billed")}
                          {/* Full coverage is stated in the data notes; only a gap needs the tile. */}
                          {!totals.tokens || pricedTokens < totals.tokens
                            ? ` · ${t("Priced token coverage")}: ${
                                totals.tokens
                                  ? formatUsagePercent((pricedTokens / totals.tokens) * 100)
                                  : "—"
                              }`
                            : null}
                        </Text>
                      ) : null}
                      <Text
                        as="small"
                        size="caption"
                        tone="secondary"
                        leading="inherit"
                        hidden={key === "cost" && change == null}
                      >
                        {change == null
                          ? t(
                              key === "cost"
                                ? "API-equivalent, not billed"
                                : key === "duration"
                                  ? "Recorded turn elapsed time"
                                  : "tokens",
                            )
                          : `${change >= 0 ? "+" : ""}${formatUsagePercent(change)} ${t("vs previous period")}`}
                      </Text>
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
                    {t("Total tokens")}{" "}
                    <Text as="b" size="inherit" tone="primary" weight="medium">
                      {formatMetric(totals.tokens, "tokens")}
                    </Text>
                  </span>
                  <span>
                    {t("Cache hit rate")}{" "}
                    <Text as="b" size="inherit" tone="primary" weight="medium">
                      {inputTotal ? formatUsagePercent((totals.cacheRead / inputTotal) * 100) : "—"}
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
          {view === "overview" && actualResolution !== resolution && (
            <Text as="p" leading="inherit" className="usage-muted">
              {t(
                "The chart uses a coarser resolution to show the entire interval. Select a shorter range for more detail.",
              )}
            </Text>
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
                  title={t("Usage breakdown")}
                  rows={matchedRows}
                  metric={metric}
                  colors={colors}
                  onSelect={(value) => chooseFilter(dimension, value)}
                />
                <UsageShare
                  rows={providers}
                  metric={metric}
                  colors={providerColors}
                  onSelect={(value) => chooseFilter("provider", value)}
                />
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
        </>
      )}
      <div hidden={view !== "limits"} className="usage-limits-view">
        {limits?.(quotaFilters)}
        {limits && <QuotaHistory window={window} filters={quotaFilters} accounts={accounts} />}
      </div>
    </section>
  );
}
