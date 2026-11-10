import type { CrewRunView } from "./crewClient";

/** What one task, member or the whole work cost, from the Host's task budget ledger. */
export type CrewUsage = {
  /** Agent run time across attempts; absent when nothing was measured. */
  durationMs?: number;
  /** Tokens reported by providers. */
  tokens?: number;
  /** False when some runs reported no tokens, so `tokens` is a lower bound. */
  tokensExact: boolean;
  /** Provider-reported cost in USD; never estimated. */
  costUsd?: number;
};
export type CrewRunUsage = {
  perTask: Record<string, CrewUsage>;
  perMember: Record<string, CrewUsage & { tasks: number }>;
  total: CrewUsage;
};

type Task = CrewRunView["tasks"][number];

function taskUsage(task: Task): CrewUsage {
  const budget = task.budgetUsage;
  const measured = budget && budget.attempts > 0 ? budget.agentMinutes * 60_000 : undefined;
  const span =
    task.startedAt !== undefined && task.completedAt !== undefined
      ? Math.max(0, task.completedAt - task.startedAt)
      : undefined;
  const tokens = budget
    ? (budget.tokens ?? (budget.reportedTokens > 0 ? budget.reportedTokens : undefined))
    : undefined;
  return {
    durationMs: measured ?? span,
    tokens,
    tokensExact: !!budget && budget.tokens !== null,
    costUsd: budget?.reportedCostUsd ?? undefined,
  };
}

function sum(parts: CrewUsage[]): CrewUsage {
  const known = (key: "durationMs" | "tokens" | "costUsd") => {
    const values = parts.flatMap((part) => (part[key] === undefined ? [] : [part[key]]));
    return values.length ? values.reduce((a, b) => a + b, 0) : undefined;
  };
  return {
    durationMs: known("durationMs"),
    tokens: known("tokens"),
    tokensExact: parts.every((part) => part.tokens === undefined || part.tokensExact),
    costUsd: known("costUsd"),
  };
}

/**
 * Time, tokens and cost per task and member, derived from each task's budget usage (the Host's
 * run ledger) with task timestamps as the duration fallback. Input and output tokens are not
 * recorded separately, so only the combined count exists.
 */
export function crewRunUsage(run: CrewRunView): CrewRunUsage {
  const memberOfTask = new Map(run.assignments.map((a) => [a.taskId, a.memberId]));
  const perTask: Record<string, CrewUsage> = {};
  const byMember = new Map<string, CrewUsage[]>();
  for (const task of run.tasks) {
    const usage = taskUsage(task);
    perTask[task.id] = usage;
    const member = memberOfTask.get(task.id);
    if (member) byMember.set(member, [...(byMember.get(member) ?? []), usage]);
  }
  const perMember: CrewRunUsage["perMember"] = {};
  for (const [member, parts] of byMember)
    perMember[member] = { ...sum(parts), tasks: parts.length };
  return { perTask, perMember, total: sum(Object.values(perTask)) };
}

/** Elapsed time of the work: creation to its last update when finished, otherwise to `now`. */
export function crewRunElapsedMs(run: CrewRunView, now: number): number {
  return Math.max(0, (run.status === "finished" ? run.updatedAt : now) - run.createdAt);
}

export type CrewRunSummary = {
  /** Accepted tasks, in acceptance order. */
  done: { taskId: string; title: string; memberId?: string }[];
  /** Members who delivered accepted work, in first-acceptance order. */
  memberIds: string[];
  /** Tasks not accepted: blocked, in review, running or waiting. */
  open: { taskId: string; title: string; status: Task["status"]; memberId?: string }[];
};

/** What a finished work delivered, who did it and what is left. */
export function crewRunSummary(run: CrewRunView): CrewRunSummary {
  const memberOfTask = new Map(run.assignments.map((a) => [a.taskId, a.memberId]));
  const entry = (task: Task) => ({
    taskId: task.id,
    title: task.title,
    memberId: memberOfTask.get(task.id),
  });
  const done = run.tasks
    .filter((task) => task.status === "done")
    .sort((a, b) => (a.completedAt ?? a.updatedAt) - (b.completedAt ?? b.updatedAt))
    .map(entry);
  return {
    done,
    memberIds: [...new Set(done.flatMap((item) => (item.memberId ? [item.memberId] : [])))],
    open: run.tasks
      .filter((task) => task.status !== "done")
      .map((task) => ({ ...entry(task), status: task.status })),
  };
}
