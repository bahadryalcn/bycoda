import { projectDisplayName } from "../../projects/model/projectNames";

import type { BoardGoal } from "./goalClient";
import { goalProgress } from "./hostGoals";
import type { BoardTask } from "./taskClient";

/** A task as the summary lists it. `key` opens it on the board. */
export type SummaryTask = {
  key: string;
  machineName: string;
  project: string;
  title: string;
  /** The first line of its error, or why it waits on the owner. */
  detail?: string;
};

export type SummaryGoal = {
  title: string;
  machineName: string;
  done: number;
  total: number;
};

export type SummaryUsage = {
  machineName: string;
  usedMinutes: number;
  /** Zero means no limit. */
  dailyAgentMinutes: number;
};

export type DailySummary = {
  since: number;
  until: number;
  finished: SummaryTask[];
  /** How many of `finished` merged on their own. */
  autoMerged: number;
  blocked: SummaryTask[];
  waiting: SummaryTask[];
  suggestions: SummaryTask[];
  goals: SummaryGoal[];
  goalsFinished: SummaryGoal[];
  usage: SummaryUsage[];
  /** Machines whose work is not included: offline, or with an older host. */
  unreachable: string[];
  outdated: string[];
};

export type DailySummaryInput = {
  since: number;
  now: number;
  tasks: readonly BoardTask[];
  goals: readonly BoardGoal[];
  usageByMachine: readonly SummaryUsage[];
  unreachable: readonly string[];
  outdated: readonly string[];
};

export function summaryTaskKey(task: Pick<BoardTask, "machineId" | "id">) {
  return `${task.machineId}:${task.id}`;
}

function entry(task: BoardTask, detail?: string): SummaryTask {
  return {
    key: summaryTaskKey(task),
    machineName: task.machineName,
    project: projectDisplayName(task.cwd),
    title: task.title,
    ...(detail ? { detail } : {}),
  };
}

/** A task record carries no history, only when it last changed. A task that
 * finished is dated by `completedAt` (falling back to `updatedAt`); a task
 * that is blocked now by `updatedAt`, which moves when it is stopped; a
 * suggestion by `createdAt`. The period is `since` (exclusive) to `now`. */
function inPeriod(at: number, since: number, now: number): boolean {
  return at > since && at <= now;
}

function firstLine(text: string | undefined): string | undefined {
  const line = text
    ?.split("\n")
    .map((part) => part.trim())
    .find(Boolean);
  return line || undefined;
}

export function buildDailySummary(input: DailySummaryInput): DailySummary {
  const { since, now } = input;
  // Tasks of a machine that did not answer are last-known, not news.
  const tasks = input.tasks.filter((task) => !task.stale);
  const finishedTasks = tasks.filter(
    (task) => task.status === "done" && inPeriod(task.completedAt ?? task.updatedAt, since, now),
  );
  const waiting = new Map<string, SummaryTask>();
  for (const task of tasks) {
    if (task.status === "review")
      waiting.set(summaryTaskKey(task), entry(task, "Ready for review"));
    else if (task.needsInput && (task.status === "running" || task.status === "verifying"))
      waiting.set(summaryTaskKey(task), entry(task, "Needs your input"));
  }
  const goals = input.goals.filter((goal) => !goal.stale);
  const progress = (goal: BoardGoal): SummaryGoal => ({
    title: goal.title,
    machineName: goal.machineName,
    ...goalProgress(
      goal,
      tasks.filter((task) => task.machineId === goal.machineId),
    ),
  });
  return {
    since,
    until: now,
    finished: finishedTasks.map((task) => entry(task)),
    autoMerged: finishedTasks.filter((task) => task.autoMerged).length,
    blocked: tasks
      .filter((task) => task.status === "blocked" && inPeriod(task.updatedAt, since, now))
      .map((task) => entry(task, firstLine(task.error))),
    waiting: [...waiting.values()],
    suggestions: tasks
      .filter(
        (task) =>
          task.source === "steward" &&
          task.status === "todo" &&
          inPeriod(task.createdAt, since, now),
      )
      .map((task) => entry(task)),
    goals: goals
      .filter((goal) => goal.status !== "done" && goal.status !== "cancelled")
      .map(progress),
    goalsFinished: goals
      .filter((goal) => goal.status === "done" && inPeriod(goal.updatedAt, since, now))
      .map(progress),
    usage: [...input.usageByMachine],
    unreachable: [...input.unreachable],
    outdated: [...input.outdated],
  };
}

/** One short line for the notification, e.g. "3 finished · 1 blocked". */
export function summaryHeadline(summary: DailySummary): string {
  const parts = [
    summary.finished.length ? `${summary.finished.length} finished` : "",
    summary.blocked.length ? `${summary.blocked.length} blocked` : "",
    summary.waiting.length ? `${summary.waiting.length} waiting for you` : "",
    summary.suggestions.length
      ? `${summary.suggestions.length} new ${summary.suggestions.length === 1 ? "suggestion" : "suggestions"}`
      : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No background activity";
}
