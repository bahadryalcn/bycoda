import { pathKey } from "../../../shared/lib/paths";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import { isoTimestamp } from "../../../shared/lib/time/timestamps";
import { dateTimeFormat } from "../../../shared/lib/intl";
import { modelDisplayName } from "../../sessions/public/modelDisplayName";
import type { AccountUsage, UsagePricing } from "../../providers/public/providerUsage";
import {
  durationSamples,
  emptyUsageFilters,
  filterUsage,
  usageBreakdown,
  usageSamples,
  usageTotals,
  type UsageFilters,
  type UsageSample,
  type UsageTurnReport,
  type UsageWindow,
} from "./usageAnalytics";
import type { UsageGroupLookup } from "./usageOverview";
import {
  usageMonthToDateWindow,
  usageMonthWindows,
  usagePresetWindow,
  type UsageMonthWindow,
} from "./usageWindows";

/** Read-only report shared by voice and the dashboard link; figures come from the dashboard's own math. */
export type UsageReportPeriod = "month-to-date" | "last-30-days" | "monthly-history";
export type UsageReportMetric = "cost" | "tokens";

export const USAGE_REPORT_PROVIDER_MAX = 8;
export const USAGE_REPORT_MODEL_MAX = 12;
export const USAGE_REPORT_PROJECT_MAX = 8;
export const USAGE_REPORT_MONTHS_DEFAULT = 6;
export const USAGE_REPORT_MONTHS_MAX = 12;
const LABEL_MAX = 120;
const AVAILABLE_MAX = 20;

export type UsageReportRequest = {
  period: UsageReportPeriod;
  metric: UsageReportMetric;
  /** Provider id such as `codex`; matched case-insensitively. */
  provider?: string;
  /** Raw model id or its display name. */
  model?: string;
  /** Restricts the report to one project; absent means every project the owner may see. */
  projectPath?: string;
  /** Calendar months for `monthly-history`. */
  months?: number;
};

export type UsageReportRow = {
  key: string;
  label: string;
  provider?: string;
  cost: number;
  tokens: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  durationMs: number;
  /** Tokens of models without a price; their cost is not in `cost`. */
  unpricedTokens: number;
  /** Share of the chosen metric across the whole report; null when that total is zero. */
  share: number | null;
  /** Present on the aggregated tail row: how many rows it stands for. */
  grouped?: number;
};

export type UsageReportMonth = {
  key: string;
  startMs: number;
  endMs: number;
  partial: boolean;
  cost: number;
  tokens: number;
  durationMs: number;
};

export type UsageReportNote =
  | "accounts-unreadable"
  | "session-turns-unavailable"
  | "session-turns-truncated"
  | "unpriced-tokens"
  | "unknown-model"
  | "other-grouped"
  | "project-restricted"
  | "no-data";

export type UsageReport = {
  period: UsageReportPeriod;
  metric: UsageReportMetric;
  /** Cost is an API-equivalent estimate from public prices, not subscription billing. */
  costBasis: "api-equivalent-estimate";
  timeZone: string;
  window: { startMs: number; endMs: number; start: string; end: string };
  /** Resolved dashboard filter keys (provider id, raw model id, project key); the dashboard link repeats them exactly. */
  filters: { provider?: string; model?: string; project?: string };
  totals: {
    cost: number;
    tokens: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    durationMs: number;
    unpricedTokens: number;
  };
  providers: UsageReportRow[];
  models: UsageReportRow[];
  projects: UsageReportRow[];
  months?: UsageReportMonth[];
  coverage: {
    partial: boolean;
    accounts: { read: number; failed: number };
    sessionTurns: "available" | "unavailable" | "truncated";
    notes: UsageReportNote[];
  };
};

export type UsageReportFailure = {
  error: "unknown-filter" | "unknown-period";
  dimension?: "provider" | "model";
  value?: string;
  available?: string[];
};

export type UsageReportInput = {
  usage: readonly AccountUsage[];
  turns: UsageTurnReport | null;
  pricing: UsagePricing;
  groupFor: UsageGroupLookup;
  /** The group-lock check the dashboard applies to every row. */
  isLocked: (path: string) => boolean;
  accountsFailed: number;
  now: number;
  request: UsageReportRequest;
};

/** The window a period scans, and its calendar months when it is the monthly history. */
export function usageReportWindows(
  request: Pick<UsageReportRequest, "period" | "months">,
  now: number,
): { window: UsageWindow; months?: UsageMonthWindow[] } {
  if (request.period === "month-to-date") return { window: usageMonthToDateWindow(now) };
  if (request.period === "last-30-days") return { window: usagePresetWindow("30d", now) };
  const count = Math.min(
    Math.max(Math.trunc(request.months ?? USAGE_REPORT_MONTHS_DEFAULT), 1),
    USAGE_REPORT_MONTHS_MAX,
  );
  const months = usageMonthWindows(now, count);
  return {
    window: { start: months[0].window.start, end: months[months.length - 1].window.end },
    months,
  };
}

function matchFilter(
  samples: readonly UsageSample[],
  dimension: "provider" | "model",
  value: string,
): { key: string } | { available: string[] } {
  const wanted = value.trim().toLowerCase();
  const names = new Map<string, string>();
  for (const sample of samples) {
    const key = sample[dimension];
    names.set(key, dimension === "model" ? modelDisplayName(key, sample.provider) : key);
  }
  for (const [key, name] of names)
    if (key.toLowerCase() === wanted || name.toLowerCase() === wanted) return { key };
  return { available: [...names.values()].sort().slice(0, AVAILABLE_MAX) };
}

const row = (
  source: ReturnType<typeof usageBreakdown>[number],
  metric: UsageReportMetric,
  total: number,
  label = source.label,
): UsageReportRow => ({
  key: source.key,
  label: truncateGraphemes(label, LABEL_MAX),
  ...(source.provider ? { provider: source.provider } : {}),
  cost: source.cost,
  tokens: source.tokens,
  input: source.input,
  output: source.output,
  cacheRead: source.cacheRead,
  cacheWrite: source.cacheWrite,
  durationMs: source.duration,
  unpricedTokens: source.unpricedTokens,
  share: total > 0 ? Math.round((source[metric] / total) * 10_000) / 10_000 : null,
});

/** Top rows by the metric; the rest is one `Other` row that keeps exact sums. */
function bounded(
  rows: readonly UsageReportRow[],
  max: number,
  metric: UsageReportMetric,
  total: number,
): UsageReportRow[] {
  if (rows.length <= max) return [...rows];
  const head = rows.slice(0, max - 1);
  const tail = rows.slice(max - 1);
  const sum = (key: keyof UsageReportRow) =>
    tail.reduce((value, item) => value + (item[key] as number), 0);
  const metricSum = sum(metric);
  return [
    ...head,
    {
      key: "other",
      label: "Other",
      cost: sum("cost"),
      tokens: sum("tokens"),
      input: sum("input"),
      output: sum("output"),
      cacheRead: sum("cacheRead"),
      cacheWrite: sum("cacheWrite"),
      durationMs: sum("durationMs"),
      unpricedTokens: sum("unpricedTokens"),
      share: total > 0 ? Math.round((metricSum / total) * 10_000) / 10_000 : null,
      grouped: tail.length,
    },
  ];
}

/**
 * Builds the report with the dashboard's pipeline: lock-filtered log rows and recorded turns,
 * the same sample, filter, duration and breakdown functions, the same local calendar.
 */
export function buildUsageReport(input: UsageReportInput): UsageReport | UsageReportFailure {
  const { request } = input;
  if (!["month-to-date", "last-30-days", "monthly-history"].includes(request.period))
    return { error: "unknown-period" };
  const { window, months } = usageReportWindows(request, input.now);
  const permitted = request.projectPath ? pathKey(request.projectPath) : undefined;
  // The lock applies to every row, restricted or not, exactly as in the dashboard.
  const allowed = (project: string) =>
    (permitted === undefined || (project !== "" && pathKey(project) === permitted)) &&
    !(project && input.isLocked(project));
  const samples = usageSamples(
    input.usage.map(({ account, rows }) => ({
      account,
      rows: rows.filter((item) => allowed(item.project)),
    })),
    input.pricing,
    input.groupFor,
  );
  const turns = input.turns?.turns.filter((turn) => allowed(turn.project)) ?? [];

  const filters: UsageFilters = emptyUsageFilters();
  const applied: UsageReport["filters"] = {};
  for (const dimension of ["provider", "model"] as const) {
    const value = request[dimension];
    if (!value?.trim()) continue;
    const match = matchFilter(samples, dimension, value);
    if ("available" in match)
      return { error: "unknown-filter", dimension, value, available: match.available };
    filters[dimension] = [match.key];
    applied[dimension] = match.key;
  }
  if (permitted !== undefined) {
    filters.project = [permitted];
    applied.project = permitted;
  }

  const within = (span: UsageWindow) => {
    const logs = filterUsage(samples, filters, span);
    const runtime = durationSamples(turns, span, filters, input.groupFor);
    return { logs, runtime, all: [...logs, ...runtime] };
  };
  const whole = within(window);
  const totals = { ...usageTotals(whole.logs), duration: usageTotals(whole.runtime).duration };
  const metricTotal = totals[request.metric];
  const unpricedTokens = whole.logs.reduce(
    (sum, sample) => sum + (sample.priced ? 0 : sample.tokens),
    0,
  );
  const rowsFor = (dimension: "provider" | "model" | "project") =>
    usageBreakdown(whole.all, dimension, request.metric).map((item) =>
      row(
        item,
        request.metric,
        metricTotal,
        dimension === "model" && !item.key.trim() ? "Unknown model" : undefined,
      ),
    );
  const providers = rowsFor("provider");
  const models = rowsFor("model");
  const projects = rowsFor("project");

  const failedAccounts = input.accountsFailed;
  const turnsStatus =
    input.turns === null ? "unavailable" : input.turns.truncated ? "truncated" : "available";
  const notes: UsageReportNote[] = [];
  if (failedAccounts > 0) notes.push("accounts-unreadable");
  if (turnsStatus === "unavailable") notes.push("session-turns-unavailable");
  if (turnsStatus === "truncated") notes.push("session-turns-truncated");
  if (unpricedTokens > 0) notes.push("unpriced-tokens");
  if (models.some((item) => !item.key.trim())) notes.push("unknown-model");
  if (
    providers.length > USAGE_REPORT_PROVIDER_MAX ||
    models.length > USAGE_REPORT_MODEL_MAX ||
    projects.length > USAGE_REPORT_PROJECT_MAX
  )
    notes.push("other-grouped");
  if (permitted !== undefined) notes.push("project-restricted");
  if (whole.all.length === 0) notes.push("no-data");

  return {
    period: request.period,
    metric: request.metric,
    costBasis: "api-equivalent-estimate",
    timeZone: dateTimeFormat().resolvedOptions().timeZone,
    window: {
      startMs: window.start,
      endMs: window.end,
      start: isoTimestamp(window.start) ?? "",
      end: isoTimestamp(window.end) ?? "",
    },
    filters: applied,
    totals: {
      cost: totals.cost,
      tokens: totals.tokens,
      input: totals.input,
      output: totals.output,
      cacheRead: totals.cacheRead,
      cacheWrite: totals.cacheWrite,
      durationMs: totals.duration,
      unpricedTokens,
    },
    providers: bounded(providers, USAGE_REPORT_PROVIDER_MAX, request.metric, metricTotal),
    models: bounded(models, USAGE_REPORT_MODEL_MAX, request.metric, metricTotal),
    projects: bounded(projects, USAGE_REPORT_PROJECT_MAX, request.metric, metricTotal),
    ...(months
      ? {
          months: months.map(({ key, window: span, partial }) => {
            const month = within(span);
            const sums = usageTotals(month.logs);
            return {
              key,
              startMs: span.start,
              endMs: span.end,
              partial,
              cost: sums.cost,
              tokens: sums.tokens,
              durationMs: usageTotals(month.runtime).duration,
            };
          }),
        }
      : {}),
    coverage: {
      partial: failedAccounts > 0 || turnsStatus !== "available",
      accounts: { read: input.usage.length - failedAccounts, failed: failedAccounts },
      sessionTurns: turnsStatus,
      notes,
    },
  };
}
