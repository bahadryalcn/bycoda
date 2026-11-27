import type {
  PlanShareAccount,
  PlanShareJob,
  PlanShareObservation,
  PlanShareWindow,
} from "../../src/shared/model/host-contracts/usage-plan-share";

/**
 * Estimates how much of a subscription plan window each job consumed. Providers expose only an
 * account-level percentage, so every observed increase between two readings is split across the
 * local turns of that interval by weight (API-equivalent cost, or raw tokens when a turn has no
 * price). Results are estimates; `null` is unknown, never zero. Accounts are never pooled.
 */

export type PlanShareTurn = {
  /** `provider:accountId`, the same key as the observations. */
  account: string;
  /** Unix ms. */
  at: number;
  sessionId: string;
  taskId?: string;
  label?: string;
  tokens: number;
  /** API-equivalent cost; `null` when the model has no price. */
  costUsd: number | null;
};

export type PlanShareInput = {
  window: PlanShareWindow;
  now: number;
  /** Readings of the requested window kind only. */
  observations: PlanShareObservation[];
  turns: PlanShareTurn[];
  accounts?: string[];
  sessionIds?: string[];
  taskIds?: string[];
  limit: number;
};

/** An interval needs this much local weight before it teaches the calibration anything. */
export const MIN_CALIBRATION_WEIGHT = { costUsd: 0.25, tokens: 250_000 } as const;
const DEFAULT_WINDOW_MINUTES: Record<PlanShareWindow, number> = {
  fiveHour: 300,
  weekly: 10_080,
};

type Basis = "costUsd" | "tokens";
const round = (value: number) => Math.round(value * 100) / 100;
const roundOrNull = (value: number | null) => (value === null ? null : round(value));

/** A decrease, or a reset time passing between two readings, means the window restarted. */
function isReset(a: PlanShareObservation, b: PlanShareObservation): boolean {
  if (b.usedPercent < a.usedPercent) return true;
  return a.resetsAt !== null && a.resetsAt > a.at && a.resetsAt <= b.at;
}

/** Percent per weight unit over the intervals with enough local usage: a ratio of sums. */
function calibrate(
  observations: PlanShareObservation[],
  turns: PlanShareTurn[],
  weight: (turn: PlanShareTurn) => number,
  basis: Basis,
): { percentPerUnit: number | null; intervals: number } {
  let increase = 0;
  let local = 0;
  let intervals = 0;
  let cursor = 0;
  for (let index = 1; index < observations.length; index++) {
    const a = observations[index - 1];
    const b = observations[index];
    // The increase across a reset cannot be measured, so it teaches nothing.
    if (isReset(a, b)) continue;
    while (cursor < turns.length && turns[cursor].at <= a.at) cursor++;
    let sum = 0;
    for (let probe = cursor; probe < turns.length && turns[probe].at <= b.at; probe++)
      sum += weight(turns[probe]);
    if (sum < MIN_CALIBRATION_WEIGHT[basis]) continue;
    increase += b.usedPercent - a.usedPercent;
    local += sum;
    intervals++;
  }
  return { percentPerUnit: increase > 0 && local > 0 ? increase / local : null, intervals };
}

type JobAcc = {
  sessionId: string;
  taskId?: string;
  label?: string;
  percent: number;
  partial: boolean;
  tokens: number;
  costUsd: number | null;
};

function addTurn(jobs: Map<string, JobAcc>, turn: PlanShareTurn, share: number | null) {
  let job = jobs.get(turn.sessionId);
  if (!job) {
    job = { sessionId: turn.sessionId, percent: 0, partial: false, tokens: 0, costUsd: 0 };
    jobs.set(turn.sessionId, job);
  }
  job.taskId ??= turn.taskId;
  job.label ??= turn.label;
  job.tokens += turn.tokens;
  job.costUsd = job.costUsd === null || turn.costUsd === null ? null : job.costUsd + turn.costUsd;
  if (share === null) job.partial = true;
  else job.percent += share;
}

function listJobs(
  jobs: Map<string, JobAcc>,
  input: Pick<PlanShareInput, "sessionIds" | "taskIds" | "limit">,
  attributable: boolean,
): { jobs: PlanShareJob[]; omitted: number } {
  const filtered = input.sessionIds !== undefined || input.taskIds !== undefined;
  const rows = [...jobs.values()]
    .filter(
      (job) =>
        !filtered ||
        input.sessionIds?.includes(job.sessionId) === true ||
        (job.taskId !== undefined && input.taskIds?.includes(job.taskId) === true),
    )
    .map((job): PlanShareJob => ({
      sessionId: job.sessionId,
      ...(job.taskId === undefined ? {} : { taskId: job.taskId }),
      ...(job.label === undefined ? {} : { label: job.label }),
      // A job whose every turn lacked an estimate is unknown, not zero.
      estimatedPercent:
        attributable && !(job.partial && job.percent === 0) ? round(job.percent) : null,
      partial: job.partial,
      tokens: job.tokens,
      costUsd: job.costUsd === null ? null : Math.round(job.costUsd * 1e6) / 1e6,
    }))
    .sort(
      (a, b) =>
        (b.estimatedPercent ?? -1) - (a.estimatedPercent ?? -1) ||
        b.tokens - a.tokens ||
        a.sessionId.localeCompare(b.sessionId),
    );
  return { jobs: rows.slice(0, input.limit), omitted: Math.max(0, rows.length - input.limit) };
}

function planAccount(
  account: string,
  input: PlanShareInput,
  allObservations: PlanShareObservation[],
  allTurns: PlanShareTurn[],
): PlanShareAccount {
  const observations = allObservations.slice().sort((a, b) => a.at - b.at);
  const turns = allTurns.filter((turn) => turn.at <= input.now).sort((a, b) => a.at - b.at);
  // One weight unit per account: cost only when every turn is priced, so units never mix.
  const basis: Basis = turns.every((turn) => turn.costUsd !== null) ? "costUsd" : "tokens";
  const weight = (turn: PlanShareTurn) => (basis === "costUsd" ? (turn.costUsd ?? 0) : turn.tokens);
  const calibration = calibrate(observations, turns, weight, basis);
  const cal = calibration.percentPerUnit;
  const latest = observations.at(-1);
  const minutes = latest?.windowMinutes ?? DEFAULT_WINDOW_MINUTES[input.window];
  // A reset time already passed means the last reading belongs to a window that is over.
  const ended = latest !== undefined && latest.resetsAt !== null && latest.resetsAt <= input.now;
  const startMs =
    ended && latest.resetsAt !== null
      ? latest.resetsAt
      : (latest?.resetsAt ?? input.now) - minutes * 60_000;
  const windowTurns = turns.filter((turn) => turn.at >= startMs);
  const series = latest && !ended ? observations.filter((entry) => entry.at >= startMs) : [];

  const jobs = new Map<string, JobAcc>();
  if (!latest || series.length === 0) {
    // Without a live reading in this window nothing can be attributed; jobs stay unknown.
    for (const turn of windowTurns) addTurn(jobs, turn, null);
    const listed = listJobs(jobs, input, false);
    return {
      account,
      status: ended ? "stale" : "noObservations",
      window: latest || ended ? { startMs, resetsAt: null } : null,
      observedPercent: null,
      explainedPercent: null,
      untrackedPercent: null,
      unobservedTailPercent: null,
      calibration: { basis, ...calibration },
      jobs: listed.jobs,
      jobsOmitted: listed.omitted,
    };
  }

  let explained = 0;
  // The window starts at zero by definition, which covers usage before the first reading.
  let previous = { at: startMs - 1, usedPercent: 0 };
  let cursor = 0;
  for (const point of series) {
    const increase = Math.max(0, point.usedPercent - previous.usedPercent);
    const inside: PlanShareTurn[] = [];
    while (cursor < windowTurns.length && windowTurns[cursor].at <= point.at) {
      if (windowTurns[cursor].at > previous.at) inside.push(windowTurns[cursor]);
      cursor++;
    }
    const total = inside.reduce((sum, turn) => sum + weight(turn), 0);
    // Without a calibration the whole increase goes to the local turns, if any ran.
    const attributed = total > 0 ? (cal === null ? increase : Math.min(increase, cal * total)) : 0;
    explained += attributed;
    for (const turn of inside)
      addTurn(jobs, turn, total > 0 ? (attributed * weight(turn)) / total : 0);
    previous = point;
  }
  let tail: number | null = 0;
  for (; cursor < windowTurns.length; cursor++) {
    const turn = windowTurns[cursor];
    const share = cal === null ? null : cal * weight(turn);
    addTurn(jobs, turn, share);
    if (share === null) tail = null;
    else if (tail !== null) tail += share;
  }

  const observed = latest.usedPercent;
  const listed = listJobs(jobs, input, true);
  return {
    account,
    status: "ok",
    window: { startMs, resetsAt: latest.resetsAt },
    observedPercent: round(observed),
    explainedPercent: round(Math.min(explained, observed)),
    untrackedPercent: round(Math.max(0, observed - explained)),
    unobservedTailPercent: roundOrNull(tail),
    calibration: { basis, ...calibration },
    jobs: listed.jobs,
    jobsOmitted: listed.omitted,
  };
}

function groupByAccount<T extends { account: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const list = map.get(item.account);
    if (list) list.push(item);
    else map.set(item.account, [item]);
  }
  return map;
}

export function computePlanShare(input: PlanShareInput): PlanShareAccount[] {
  const observations = groupByAccount(input.observations);
  const turns = groupByAccount(input.turns);
  const names = new Set([...observations.keys(), ...turns.keys()]);
  return [...names]
    .filter((name) => !input.accounts || input.accounts.includes(name))
    .sort()
    .map((name) => planAccount(name, input, observations.get(name) ?? [], turns.get(name) ?? []));
}
