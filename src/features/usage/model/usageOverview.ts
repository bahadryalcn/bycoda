import { pathKey, projectName } from "../../../shared/lib/paths";
import {
  rowCost,
  usageDays,
  usageRate,
  type AccountUsage,
  type UsagePricing,
  type UsageRow,
} from "../../providers/model/providerUsage";
import type { ProviderAccountProvider } from "../../providers/model/providerAccounts";

export type UsageRangeId = "7d" | "30d" | "90d" | "all";

export const USAGE_RANGES: ReadonlyArray<{
  id: UsageRangeId;
  label: string;
  /** Calendar days back from today; null reaches back to the first log. */
  days: number | null;
}> = [
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
  { id: "90d", label: "90 days", days: 90 },
  { id: "all", label: "All time", days: null },
];

/** Epoch ms to scan from; 0 reads every log. */
export function usageRangeSince(range: UsageRangeId, now: Date): number {
  const days = USAGE_RANGES.find((entry) => entry.id === range)?.days;
  return days == null ? 0 : usageDays(days, now)[0].getTime();
}

/** A folder's rail group, when the user filed it into one. */
export type UsageGroupRef = { id: string; name: string };
export type UsageGroupLookup = (project: string) => UsageGroupRef | null;

export type UsageStackBy = "provider" | "model";

export type UsageSeries = { key: string; label: string };

export type UsageAmount = { tokens: number; cost: number };

export type UsageDayBucket = UsageAmount & {
  /** Local `YYYY-MM-DD`. */
  key: string;
  /** Local midnight. */
  date: Date;
  /** Tokens and cost of this day per series key. */
  series: Record<string, UsageAmount>;
};

export type UsageProjectRow = {
  key: string;
  label: string;
  /** Full folder path behind the label. */
  title?: string;
  group: UsageGroupRef | null;
  /** Uncached input. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tokens: number;
  cost: number;
  /** Share of the costliest project, for the bar. */
  share: number;
  /** Some of this project's usage has no known price. */
  partlyUnpriced: boolean;
};

export type UsageGroupSection = {
  /** The group's id, or "" for projects in no group. */
  key: string;
  name: string | null;
  projects: UsageProjectRow[];
  tokens: number;
  cost: number;
};

export type UsageOverviewData = {
  days: UsageDayBucket[];
  /** Series in legend order; the same for every day. */
  series: UsageSeries[];
  /** Every project, costliest first. */
  projects: UsageProjectRow[];
  /** Projects gathered by rail group, costliest group first. */
  groups: UsageGroupSection[];
  totals: UsageAmount & {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  unpricedModels: string[];
};

/** Models beyond this many collapse into one "Other" series. */
const MAX_MODEL_SERIES = 5;
const OTHER_SERIES = "other";

const PROVIDER_LABEL: Record<ProviderAccountProvider, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

function dayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function tokensOf(row: UsageRow): number {
  return row.input + row.cacheRead + row.cacheWrite5m + row.cacheWrite1h + row.output;
}

/** Contiguous local days, oldest first; for "all" from the first row on. */
function rangeDays(range: UsageRangeId, firstSlot: number | undefined, now: Date): Date[] {
  const days = USAGE_RANGES.find((entry) => entry.id === range)?.days;
  if (days != null) return usageDays(days, now);
  if (firstSlot === undefined) return [startOfDay(now)];
  const first = startOfDay(new Date(firstSlot * 1000));
  const today = startOfDay(now);
  const out: Date[] = [];
  for (const date = new Date(first); date <= today; date.setDate(date.getDate() + 1)) {
    out.push(new Date(date));
  }
  return out;
}

/**
 * Cost and tokens by day and by project, as API-equivalent estimates.
 * Rows without a known price add tokens but no cost, and their models are
 * listed so the table can say the figure is a floor.
 */
export function summarizeUsageOverview(
  usage: readonly AccountUsage[],
  range: UsageRangeId,
  now: Date,
  stackBy: UsageStackBy,
  groupFor: UsageGroupLookup,
  pricing: UsagePricing = usageRate,
): UsageOverviewData {
  const rangeStart =
    range === "all"
      ? 0
      : usageDays(USAGE_RANGES.find((entry) => entry.id === range)?.days ?? 1, now)[0].getTime() /
        1000;
  const entries = usage.flatMap((entry) =>
    entry.rows
      .filter((row) => row.slot >= rangeStart)
      .map((row) => ({ provider: entry.account.provider, row })),
  );

  const firstSlot = entries.reduce<number | undefined>(
    (first, { row }) => (first === undefined || row.slot < first ? row.slot : first),
    undefined,
  );
  const days = rangeDays(range, firstSlot, now).map<UsageDayBucket>((date) => ({
    key: dayKey(date),
    date,
    tokens: 0,
    cost: 0,
    series: {},
  }));
  const byDay = new Map(days.map((day) => [day.key, day]));

  // Rank models once so the stack and legend agree on which ones get a colour.
  const modelWeight = new Map<string, number>();
  const unpriced = new Set<string>();
  const priced = entries.map(({ provider, row }) => {
    const cost = rowCost(row, pricing);
    if (cost == null) unpriced.add(row.model);
    modelWeight.set(
      row.model,
      (modelWeight.get(row.model) ?? 0) + (cost ?? 0) + tokensOf(row) * 1e-12,
    );
    return { provider, row, cost: cost ?? 0 };
  });
  const rankedModels = [...modelWeight.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([model]) => model);
  const shownModels = new Set(rankedModels.slice(0, MAX_MODEL_SERIES));

  const seriesKey = (provider: ProviderAccountProvider, model: string) =>
    stackBy === "provider" ? provider : shownModels.has(model) ? model : OTHER_SERIES;

  const projects = new Map<string, Omit<UsageProjectRow, "share">>();
  const providersSeen = new Set<ProviderAccountProvider>();
  const totals = {
    tokens: 0,
    cost: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };

  for (const { provider, row, cost } of priced) {
    providersSeen.add(provider);
    const tokens = tokensOf(row);
    const cacheWrite = row.cacheWrite5m + row.cacheWrite1h;
    const day = byDay.get(dayKey(new Date(row.slot * 1000)));
    if (day) {
      const key = seriesKey(provider, row.model);
      const slice = (day.series[key] ??= { tokens: 0, cost: 0 });
      slice.tokens += tokens;
      slice.cost += cost;
      day.tokens += tokens;
      day.cost += cost;
    }

    const project = row.project;
    const key = project ? pathKey(project) : "";
    const target = projects.get(key) ?? {
      key,
      label: project ? projectName(project) : "Unknown folder",
      title: project || undefined,
      group: project ? groupFor(project) : null,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      tokens: 0,
      cost: 0,
      partlyUnpriced: false,
    };
    target.input += row.input;
    target.output += row.output;
    target.cacheRead += row.cacheRead;
    target.cacheWrite += cacheWrite;
    target.tokens += tokens;
    target.cost += cost;
    if (!pricing(row.model)) target.partlyUnpriced = true;
    projects.set(key, target);

    totals.tokens += tokens;
    totals.cost += cost;
    totals.input += row.input;
    totals.output += row.output;
    totals.cacheRead += row.cacheRead;
    totals.cacheWrite += cacheWrite;
  }

  const sorted = [...projects.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
  const top = sorted[0];
  const shareOf = (row: { cost: number; tokens: number }) =>
    !top ? 0 : top.cost > 0 ? row.cost / top.cost : top.tokens > 0 ? row.tokens / top.tokens : 0;
  const projectRows = sorted.map<UsageProjectRow>((row) => ({
    ...row,
    share: shareOf(row),
  }));

  return {
    days,
    series:
      stackBy === "provider"
        ? [...providersSeen].sort().map((key) => ({ key, label: PROVIDER_LABEL[key] }))
        : [
            ...rankedModels
              .slice(0, MAX_MODEL_SERIES)
              .map((model) => ({ key: model, label: model })),
            ...(rankedModels.length > MAX_MODEL_SERIES
              ? [{ key: OTHER_SERIES, label: "Other models" }]
              : []),
          ],
    projects: projectRows,
    groups: groupSections(projectRows),
    totals,
    unpricedModels: [...unpriced].sort(),
  };
}

/** Named groups costliest first, then folders in no group. */
function groupSections(projects: UsageProjectRow[]): UsageGroupSection[] {
  const sections = new Map<string, UsageGroupSection>();
  for (const project of projects) {
    const key = project.group?.id ?? "";
    const section = sections.get(key) ?? {
      key,
      name: project.group?.name ?? null,
      projects: [],
      tokens: 0,
      cost: 0,
    };
    section.projects.push(project);
    section.tokens += project.tokens;
    section.cost += project.cost;
    sections.set(key, section);
  }
  return [...sections.values()].sort(
    (a, b) => Number(a.key === "") - Number(b.key === "") || b.cost - a.cost || b.tokens - a.tokens,
  );
}

/** Colours for stacked series: the tab-group hues, legible on both themes. */
export const USAGE_SERIES_COLORS = [
  "hsl(211 92% 62%)",
  "hsl(25 85% 58%)",
  "hsl(142 55% 50%)",
  "hsl(280 55% 62%)",
  "hsl(45 90% 55%)",
  "hsl(330 70% 62%)",
] as const;

/** The "Other models" bucket is neutral rather than another hue. */
export function usageSeriesColor(index: number, key: string): string {
  return key === OTHER_SERIES
    ? "hsl(210 8% 58%)"
    : USAGE_SERIES_COLORS[index % USAGE_SERIES_COLORS.length];
}
