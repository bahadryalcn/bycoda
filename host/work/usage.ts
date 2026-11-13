import type { HostStore } from "../store";
import type { HostTaskBudgets } from "../tasks/task-budgets";

export type WorkUsageMetric = "tokens" | "costUsd";
export type WorkUsageRun = {
  sessionId: string;
  runId: string;
  startedAt: number;
  settledAt?: number;
  provider?: string;
  accountId?: string;
  tokens: number | null;
  costUsd: number | null;
  usageIntervals?: Array<{
    from: number;
    to: number;
    tokens: number | null;
    costUsd: number | null;
  }>;
};
export type WorkUsageWindow = {
  start: number;
  nextResetAt: number;
};
export type WorkUsageMeasurement = {
  /** Confirmed lower bound, never a substitute for an incomplete reading. */
  reported: number;
  used: number | null;
  complete: boolean;
  reasons: string[];
};
export type WorkUsageBucket = WorkUsageWindow & Record<WorkUsageMetric, WorkUsageMeasurement>;
export type WorkUsageReading = {
  measuredAt: number;
  provider?: string;
  accountId?: string;
  daily: WorkUsageBucket;
  monthly: WorkUsageBucket;
};

/** Host-local calendar, matching HostLimits; Date handles DST and month length. */
export function workUsageWindows(now: number): {
  daily: WorkUsageWindow;
  monthly: WorkUsageWindow;
} {
  if (!Number.isFinite(now)) throw new Error("Invalid Work usage clock.");
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const nextDay = new Date(day);
  nextDay.setDate(nextDay.getDate() + 1);
  const month = new Date(day);
  month.setDate(1);
  const nextMonth = new Date(month);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  return {
    daily: { start: day.getTime(), nextResetAt: nextDay.getTime() },
    monthly: { start: month.getTime(), nextResetAt: nextMonth.getTime() },
  };
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Unique exact runs only. Cumulative session costs have already been baselined by the ledger. */
export function aggregateWorkUsage(
  runs: WorkUsageRun[],
  options: { now: number; provider?: string; accountId?: string; coverageSince?: number },
): WorkUsageReading {
  const windows = workUsageWindows(options.now);
  const bucket = (window: WorkUsageWindow): WorkUsageBucket => {
    const measure = (metric: WorkUsageMetric): WorkUsageMeasurement => {
      let reported = 0;
      const reasons = new Set<string>();
      if (!finite(options.coverageSince) || options.coverageSince > window.start)
        reasons.add("Work usage coverage does not include the whole calendar window.");
      const seen = new Set<string>();
      for (const run of runs) {
        const id = JSON.stringify([run.sessionId, run.runId]);
        if (seen.has(id)) continue;
        seen.add(id);
        if (!finite(run.startedAt) || (run.settledAt !== undefined && !finite(run.settledAt))) {
          reasons.add("A run has an invalid calendar interval.");
          continue;
        }
        const end = run.settledAt ?? options.now;
        if (end < run.startedAt) {
          reasons.add("A run has an invalid calendar interval.");
          continue;
        }
        if (run.startedAt >= window.nextResetAt || end < window.start) continue;
        if (options.provider && run.provider && run.provider !== options.provider) continue;
        if (options.accountId && run.accountId && run.accountId !== options.accountId) continue;
        if ((options.provider && !run.provider) || (options.accountId && !run.accountId)) {
          reasons.add("An overlapping run has unknown provider or account identity.");
          continue;
        }
        const total = run[metric];
        if (!finite(total)) {
          reasons.add(`An overlapping run has unknown ${metric}.`);
          continue;
        }
        // Still-running observations are lower bounds even when a provider reported zero.
        if (run.settledAt === undefined) reasons.add("An overlapping run is still running.");
        if (run.startedAt >= window.start && end < window.nextResetAt) {
          reported += total;
          continue;
        }
        let accounted = 0;
        for (const interval of run.usageIntervals ?? []) {
          const delta = interval[metric];
          if (!finite(delta)) continue;
          if (!finite(interval.from) || !finite(interval.to) || interval.to < interval.from) {
            reasons.add("A usage observation has an invalid calendar interval.");
            continue;
          }
          accounted += delta;
          if (interval.to < window.start || interval.from >= window.nextResetAt) continue;
          if (interval.from >= window.start && interval.to < window.nextResetAt) reported += delta;
          else if (delta > 0) reasons.add(`A ${metric} observation crosses a calendar boundary.`);
        }
        if (Math.abs(accounted - total) > Number.EPSILON * Math.max(1, total) * 8)
          reasons.add(`Historical ${metric} lacks timestamped deltas.`);
      }
      return {
        reported,
        used: reasons.size ? null : reported,
        complete: reasons.size === 0,
        reasons: [...reasons],
      };
    };
    return { ...window, tokens: measure("tokens"), costUsd: measure("costUsd") };
  };
  return {
    measuredAt: options.now,
    provider: options.provider,
    accountId: options.accountId,
    daily: bucket(windows.daily),
    monthly: bucket(windows.monthly),
  };
}

/** Reads the existing authoritative ledger; no parallel totals or provider-log estimates.
 * coverageSince must be the persisted all-producer registration cutover, never process start.
 * Omit it while any producer can bypass registration; configured caps then wait truthfully.
 */
export async function readWorkUsage(
  store: HostStore,
  budgets: Pick<HostTaskBudgets, "sync">,
  options: Parameters<typeof aggregateWorkUsage>[1],
): Promise<WorkUsageReading> {
  await budgets.sync();
  const rows = await store.db.prepare("SELECT value FROM task_run_budget_ledger").all();
  const runs = rows.map((row) => JSON.parse(String(row.value)) as WorkUsageRun);
  for (const run of runs) {
    if (run.provider && run.accountId) continue;
    try {
      const session = await store.session(run.sessionId);
      // A later retained turn may use a different account. Never attribute it backwards.
      if (session.runId !== run.runId) continue;
      run.provider ??= session.session.harness;
      run.accountId ??= session.session.providerAccountId;
    } catch {
      // Deletion cannot erase recorded usage or turn missing identity into zero.
    }
  }
  return aggregateWorkUsage(runs, options);
}
