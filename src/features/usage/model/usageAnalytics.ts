import { modelDisplayName } from "../../sessions/public/modelDisplayName";
import { pathKey, projectName } from "../../../shared/lib/paths";
import {
  rowCost,
  type AccountUsage,
  type UsagePricing,
  type UsageRow,
} from "../../providers/model/providerUsage";

export type UsageMetric =
  | "cost"
  | "tokens"
  | "input"
  | "output"
  | "cacheRead"
  | "cacheWrite"
  | "duration";
export type UsageDimension = "provider" | "account" | "model" | "project" | "machine";
export type UsageResolution = "15m" | "hour" | "day" | "week";
export type UsageWindow = { start: number; end: number };
export type UsageFilters = Record<UsageDimension | "group", string[]>;
export const emptyUsageFilters = (): UsageFilters => ({
  provider: [],
  account: [],
  model: [],
  project: [],
  machine: [],
  group: [],
});
/** This computer in the `machine` dimension. The label is an English constant `usageLabel` translates. */
export const LOCAL_USAGE_MACHINE = { id: "local", label: "This machine" } as const;
export type UsageValues = Record<UsageMetric, number>;
export const zeroUsage = (): UsageValues => ({
  cost: 0,
  tokens: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  duration: 0,
});
export type UsageSample = UsageValues & {
  source: "logs" | "duration";
  at: number;
  provider: string;
  account: string;
  accountLabel: string;
  model: string;
  project: string;
  projectLabel: string;
  group: string;
  groupLabel: string;
  machine: string;
  machineLabel: string;
  priced: boolean;
};
export type UsageTurn = {
  sessionId: string;
  title: string;
  project: string;
  provider: string;
  accountId: string | null;
  model: string;
  startedAt: number;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
};
export type UsageTurnReport = { turns: UsageTurn[]; truncated: boolean };
export type UsageBucket = UsageValues & {
  key: string;
  start: number;
  end: number;
  series: Record<string, UsageValues>;
};
export type UsageBreakdown = UsageValues & {
  key: string;
  label: string;
  /** Provider the first sample of a model row came from; the icon of the model. */
  provider?: string;
  unpricedTokens: number;
  logSamples: number;
  timedSamples: number;
};
export type UsageSessionRow = UsageValues & {
  key: string;
  title: string;
  project: string;
  provider: string;
  turns: number;
  timedTurns: number;
  meteredTurns: number;
  unpricedTurns: number;
};

export function usageSamples(
  usage: readonly AccountUsage[],
  pricing: UsagePricing,
  groupFor: (path: string) => { id: string; name: string } | null,
): UsageSample[] {
  return usage.flatMap(({ account, rows, machine = LOCAL_USAGE_MACHINE }) =>
    rows.map((row) => {
      const group = groupFor(row.project);
      const cost = rowCost(row, pricing);
      return {
        ...zeroUsage(),
        source: "logs" as const,
        at: row.slot * 1000,
        provider: account.provider,
        account: `${account.provider}:${account.id}`,
        accountLabel: account.label,
        model: row.model,
        project: row.project ? pathKey(row.project) : "",
        projectLabel: row.project ? projectName(row.project) : "Unknown folder",
        group: group?.id ?? "",
        groupLabel: group?.name ?? "Not in a group",
        machine: machine.id,
        machineLabel: machine.label,
        input: row.input,
        output: row.output,
        cacheRead: row.cacheRead,
        cacheWrite: row.cacheWrite5m + row.cacheWrite1h,
        tokens: row.input + row.output + row.cacheRead + row.cacheWrite5m + row.cacheWrite1h,
        cost: cost ?? 0,
        priced: cost !== null,
      };
    }),
  );
}

export function matchesUsage(
  sample: Pick<UsageSample, "provider" | "account" | "model" | "project" | "group" | "machine">,
  filters: UsageFilters,
): boolean {
  return (Object.keys(filters) as (keyof UsageFilters)[]).every(
    (key) => !filters[key].length || filters[key].includes(sample[key]),
  );
}

export function filterUsage(
  samples: readonly UsageSample[],
  filters: UsageFilters,
  window: UsageWindow,
): UsageSample[] {
  return samples.filter(
    (s) => s.at >= window.start && s.at < window.end && matchesUsage(s, filters),
  );
}

export function addUsage(target: UsageValues, source: UsageValues) {
  for (const key of Object.keys(zeroKeys) as UsageMetric[]) target[key] += source[key];
}
const zeroKeys = zeroUsage();

export function usageTotals(samples: readonly UsageValues[]): UsageValues {
  const total = zeroUsage();
  for (const sample of samples) addUsage(total, sample);
  return total;
}

export function usageBreakdown(
  samples: readonly UsageSample[],
  dimension: UsageDimension,
  metric: UsageMetric,
): UsageBreakdown[] {
  const rows = new Map<string, UsageBreakdown>();
  for (const sample of samples) {
    const key = sample[dimension];
    const label =
      dimension === "account"
        ? sample.accountLabel
        : dimension === "machine"
          ? sample.machineLabel
          : dimension === "project"
            ? sample.projectLabel
            : dimension === "model"
              ? modelDisplayName(key, sample.provider)
              : key;
    const row = rows.get(key) ?? {
      ...zeroUsage(),
      key,
      label,
      ...(dimension === "model" ? { provider: sample.provider } : {}),
      unpricedTokens: 0,
      logSamples: 0,
      timedSamples: 0,
    };
    addUsage(row, sample);
    if (sample.source === "logs") row.logSamples++;
    else row.timedSamples++;
    if (!sample.priced) row.unpricedTokens += sample.tokens;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b[metric] - a[metric] || a.label.localeCompare(b.label));
}

export function bucketStart(timestamp: number, resolution: UsageResolution): number {
  const date = new Date(timestamp);
  if (resolution === "15m") return Math.floor(timestamp / 900_000) * 900_000;
  if (resolution === "hour") {
    const start =
      timestamp - date.getMinutes() * 60_000 - date.getSeconds() * 1000 - date.getMilliseconds();
    // A partial repeated hour starts at the offset transition, not at an
    // invented local hour boundary before it (for example Lord Howe's 01:30).
    return new Date(start).getTimezoneOffset() === date.getTimezoneOffset()
      ? start
      : offsetTransition(start, timestamp);
  }
  date.setHours(0, 0, 0, 0);
  if (resolution === "week") date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
}

export function nextBucket(timestamp: number, resolution: UsageResolution): number {
  if (resolution === "15m") return timestamp + 900_000;
  if (resolution === "hour") {
    const date = new Date(timestamp);
    const end =
      timestamp +
      (60 - date.getMinutes()) * 60_000 -
      date.getSeconds() * 1000 -
      date.getMilliseconds();
    return new Date(end - 1).getTimezoneOffset() === date.getTimezoneOffset()
      ? end
      : offsetTransition(timestamp, end - 1);
  }
  const date = new Date(timestamp);
  date.setDate(date.getDate() + (resolution === "week" ? 7 : 1));
  return date.getTime();
}

/** First instant with a new UTC offset, within an interval crossing a transition. */
function offsetTransition(start: number, end: number): number {
  const offset = new Date(start).getTimezoneOffset();
  while (end - start > 1) {
    const middle = Math.floor((start + end) / 2);
    if (new Date(middle).getTimezoneOffset() === offset) start = middle;
    else end = middle;
  }
  return end;
}

/** Keep the entire selected interval while bounding the chart DOM. */
export function effectiveResolution(
  window: UsageWindow,
  requested: UsageResolution,
): UsageResolution {
  const order: UsageResolution[] = ["15m", "hour", "day", "week"];
  const widths = { "15m": 900_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 };
  return (
    order
      .slice(order.indexOf(requested))
      .find((r) => (window.end - window.start) / widths[r] <= 180) ?? "week"
  );
}

export function usageBuckets(
  samples: readonly UsageSample[],
  window: UsageWindow,
  resolution: UsageResolution,
  dimension: UsageDimension,
  metric: UsageMetric,
): { buckets: UsageBucket[]; series: UsageBreakdown[] } {
  const ranked = usageBreakdown(samples, dimension, metric);
  const series = ranked.slice(0, 5);
  if (ranked.length > 5)
    series.push({
      ...usageTotals(ranked.slice(5)),
      key: "__other",
      label: "Other",
      unpricedTokens: ranked.slice(5).reduce((n, r) => n + r.unpricedTokens, 0),
      logSamples: ranked.slice(5).reduce((n, r) => n + r.logSamples, 0),
      timedSamples: ranked.slice(5).reduce((n, r) => n + r.timedSamples, 0),
    });
  const keys = new Set(series.map((s) => s.key));
  const buckets: UsageBucket[] = [];
  const byStart = new Map<number, UsageBucket>();
  const approximateWidth =
    resolution === "week"
      ? 604_800_000
      : resolution === "day"
        ? 86_400_000
        : resolution === "hour"
          ? 3_600_000
          : 900_000;
  const stride = Math.max(1, Math.ceil((window.end - window.start) / approximateWidth / 180));
  let index = 0;
  for (
    let start = bucketStart(window.start, resolution);
    start < window.end;
    start = nextBucket(start, resolution)
  ) {
    const row = {
      ...zeroUsage(),
      key: String(start),
      start,
      end: nextBucket(start, resolution),
      series: {},
    };
    if (index++ % stride === 0) buckets.push(row);
    const target = buckets[buckets.length - 1];
    target.end = row.end;
    byStart.set(start, target);
  }
  for (const sample of samples) {
    const row = byStart.get(bucketStart(sample.at, resolution));
    if (!row || sample.at < window.start || sample.at >= window.end) continue;
    const key = keys.has(sample[dimension]) ? sample[dimension] : "__other";
    addUsage(row, sample);
    addUsage((row.series[key] ??= zeroUsage()), sample);
  }
  return { buckets, series };
}

export function turnDimensions(
  turn: UsageTurn,
  groupFor: (path: string) => { id: string; name: string } | null,
) {
  const group = groupFor(turn.project);
  return {
    provider: turn.provider,
    account: `${turn.provider}:${turn.accountId || "default"}`,
    model: turn.model,
    project: turn.project ? pathKey(turn.project) : "",
    group: group?.id ?? "",
    // Recorded turns are this computer's own session store.
    machine: LOCAL_USAGE_MACHINE.id,
  };
}

/** Converts supported provider turn counters into disjoint token buckets. */
export function meteredTurnUsage(turn: UsageTurn, pricing: UsagePricing) {
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = turn;
  const cacheRead = cacheReadTokens ?? 0;
  const cacheWrite = cacheWriteTokens ?? 0;
  if (
    inputTokens == null ||
    outputTokens == null ||
    ![inputTokens, outputTokens, cacheRead, cacheWrite].every(
      (n) => Number.isFinite(n) && n >= 0,
    ) ||
    !["claude", "codex"].includes(turn.provider)
  )
    return null;
  const input = Math.max(0, inputTokens - (turn.provider === "codex" ? cacheRead : 0));
  const usage: UsageRow = {
    slot: turn.startedAt / 1000,
    model: turn.model,
    project: turn.project,
    input,
    output: outputTokens,
    cacheRead,
    cacheWrite5m: cacheWrite,
    cacheWrite1h: 0,
  };
  // Turn metrics do not retain Claude cache-write TTL.
  const cost = turn.provider === "claude" && cacheWrite > 0 ? null : rowCost(usage, pricing);
  return { input, output: outputTokens, cacheRead, cacheWrite, cost };
}

/** Runtime uses measured finished intervals only. Missing/live durations are not guessed. */
export function durationSamples(
  turns: readonly UsageTurn[],
  window: UsageWindow,
  filters: UsageFilters,
  groupFor: (path: string) => { id: string; name: string } | null,
): UsageSample[] {
  const samples: UsageSample[] = [];
  for (const turn of turns) {
    const dims = turnDimensions(turn, groupFor);
    if (!matchesUsage(dims, filters) || turn.durationMs == null || turn.durationMs < 0) continue;
    const end = Math.min(window.end, turn.startedAt + turn.durationMs);
    for (let start = Math.max(window.start, turn.startedAt); start < end;) {
      const next = Math.min(end, (Math.floor(start / 900_000) + 1) * 900_000);
      samples.push({
        ...zeroUsage(),
        source: "duration",
        ...dims,
        at: start,
        accountLabel: turn.accountId || "Default account",
        projectLabel: projectName(turn.project),
        groupLabel: groupFor(turn.project)?.name ?? "Not in a group",
        machineLabel: LOCAL_USAGE_MACHINE.label,
        priced: true,
        duration: next - start,
      });
      start = next;
    }
  }
  return samples;
}

export function sessionUsage(
  turns: readonly UsageTurn[],
  window: UsageWindow,
  filters: UsageFilters,
  pricing: UsagePricing,
  groupFor: (path: string) => { id: string; name: string } | null,
): UsageSessionRow[] {
  const sessions = new Map<string, UsageSessionRow>();
  for (const turn of turns) {
    const end = turn.startedAt + (turn.durationMs ?? 0);
    if (
      turn.startedAt >= window.end ||
      (end <= window.start && turn.startedAt < window.start) ||
      !matchesUsage(turnDimensions(turn, groupFor), filters)
    )
      continue;
    const row = sessions.get(turn.sessionId) ?? {
      ...zeroUsage(),
      key: turn.sessionId,
      title: turn.title,
      project: turn.project,
      provider: turn.provider,
      turns: 0,
      timedTurns: 0,
      meteredTurns: 0,
      unpricedTurns: 0,
    };
    row.turns++;
    if (turn.durationMs != null && Number.isFinite(turn.durationMs) && turn.durationMs >= 0) {
      row.timedTurns++;
      row.duration += Math.max(
        0,
        Math.min(end, window.end) - Math.max(turn.startedAt, window.start),
      );
    }
    // Turn token totals have no intra-turn attribution: include only whole turns.
    if (
      turn.durationMs != null &&
      turn.durationMs >= 0 &&
      turn.startedAt >= window.start &&
      end <= window.end
    ) {
      const usage = meteredTurnUsage(turn, pricing);
      if (usage) {
        row.meteredTurns++;
        row.input += usage.input;
        row.output += usage.output;
        row.cacheRead += usage.cacheRead;
        row.cacheWrite += usage.cacheWrite;
        row.tokens += usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
        row.cost += usage.cost ?? 0;
        if (usage.cost === null) row.unpricedTurns++;
      }
    }
    sessions.set(turn.sessionId, row);
  }
  return [...sessions.values()].sort((a, b) => b.duration - a.duration || b.tokens - a.tokens);
}

export function previousUsageWindow(window: UsageWindow): UsageWindow {
  return { start: window.start - (window.end - window.start), end: window.start };
}

export function usageCsv(rows: readonly UsageBreakdown[]): string {
  const cell = (value: string | number) =>
    `"${String(value)
      .replace(/^(?:\s*[=+@-]|[\t\r\n])/, "'$&")
      .replace(/"/g, '""')}"`;
  return [
    [
      "Name",
      "Estimated USD",
      "Uncached input",
      "Output",
      "Cache read",
      "Cache write",
      "Total tokens",
      "Agent milliseconds",
      "Unpriced tokens",
    ],
    ...rows.map((r) => [
      r.label,
      r.logSamples && r.unpricedTokens < r.tokens ? r.cost : "",
      r.logSamples ? r.input : "",
      r.logSamples ? r.output : "",
      r.logSamples ? r.cacheRead : "",
      r.logSamples ? r.cacheWrite : "",
      r.logSamples ? r.tokens : "",
      r.timedSamples ? r.duration : "",
      r.unpricedTokens,
    ]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
