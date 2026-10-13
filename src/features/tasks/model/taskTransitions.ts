import type { Automation } from "../../automations/model/automations";
import type { GoalStatus } from "./hostGoals";
import type { TaskStatus } from "./hostTasks";
import type { BoardGoal } from "./goalClient";
import type { BoardTask } from "./taskClient";

/** What the background notifier remembers of one task between polls. */
export type TaskSnapshotEntry = {
  title: string;
  machineName: string;
  status: TaskStatus;
  needsInput: boolean;
  error?: string;
  /** The host merged the task on its own. */
  autoMerged?: boolean;
};

/** What it remembers of one background automation between polls. */
export type AutomationSnapshotEntry = {
  name: string;
  lastRunStatus?: string;
  lastRunError?: string;
  /** Run time of the last finished run, so a second failure in a row counts. */
  lastRunAt?: number;
  needsInput: boolean;
};

/** What it remembers of one goal between polls. */
export type GoalSnapshotEntry = {
  title: string;
  status: GoalStatus;
  /** Why the goal is blocked. */
  error?: string;
};

/** Background work as one poll saw it, keyed by machine and ID. */
export type BackgroundSnapshot = {
  tasks: Map<string, TaskSnapshotEntry>;
  automations: Map<string, AutomationSnapshotEntry>;
  goals: Map<string, GoalSnapshotEntry>;
};

export type BackgroundTransition = {
  /** The view a click on the notification opens. */
  target: "tasks" | "automations";
  /** Which notification setting gates it. */
  kind: "finished" | "failed" | "input";
  /** The notification's text, e.g. "Ready for review: Fix login on laptop". */
  message: string;
};

export function emptyBackgroundSnapshot(): BackgroundSnapshot {
  return { tasks: new Map(), automations: new Map(), goals: new Map() };
}

export function backgroundKey(machineId: string, id: string): string {
  return `${machineId}\n${id}`;
}

/** One poll's board tasks, host automations and goals, as the notifier keeps
 * them. An automation that is not run by a host is left out. */
export function backgroundSnapshot(
  tasks: readonly BoardTask[],
  automations: readonly Automation[],
  goals: readonly BoardGoal[] = [],
): BackgroundSnapshot {
  const snapshot = emptyBackgroundSnapshot();
  for (const task of tasks)
    snapshot.tasks.set(backgroundKey(task.machineId, task.id), {
      title: task.title,
      machineName: task.machineName,
      status: task.status,
      needsInput: Boolean(task.needsInput),
      ...(task.error ? { error: task.error } : {}),
      ...(task.autoMerged ? { autoMerged: true } : {}),
    });
  for (const automation of automations) {
    if (!automation.host) continue;
    snapshot.automations.set(backgroundKey(automation.host.machineId, automation.id), {
      name: automation.name,
      lastRunStatus: automation.lastRunStatus,
      lastRunError: automation.lastRunError,
      lastRunAt: automation.lastRunAt,
      needsInput: Boolean(automation.host.needsInput),
    });
  }
  for (const goal of goals) {
    const error = goal.planError ?? goal.error;
    snapshot.goals.set(backgroundKey(goal.machineId, goal.id), {
      title: goal.title,
      status: goal.status,
      ...(error ? { error } : {}),
    });
  }
  return snapshot;
}

/** `next`, keeping what `previous` had of anything missing from it: a machine
 * that did not answer this time keeps its last known state, so a change made
 * while it was out of reach is still noticed once it answers again. */
export function carryForward(
  previous: BackgroundSnapshot,
  next: BackgroundSnapshot,
): BackgroundSnapshot {
  const tasks = new Map(previous.tasks);
  for (const [key, entry] of next.tasks) tasks.set(key, entry);
  const automations = new Map(previous.automations);
  for (const [key, entry] of next.automations) automations.set(key, entry);
  const goals = new Map(previous.goals);
  for (const [key, entry] of next.goals) goals.set(key, entry);
  return { tasks, automations, goals };
}

/** The changes since `previous` that the owner should hear about. Something
 * not seen before only counts once it changes: a task that shows up already
 * in review was most likely there before this app started watching. */
export function backgroundTransitions(
  previous: BackgroundSnapshot,
  next: BackgroundSnapshot,
): BackgroundTransition[] {
  const transitions: BackgroundTransition[] = [];
  for (const [key, task] of next.tasks) {
    const before = previous.tasks.get(key);
    // Nothing runs for a to-do item, so moving one there is never news.
    if (!before || task.status === "todo") continue;
    if (task.status === "review" && before.status !== "review")
      transitions.push({
        target: "tasks",
        kind: "finished",
        message: `Ready for review: ${task.title} on ${task.machineName}`,
      });
    else if (task.status === "done" && task.autoMerged && before.status !== "done")
      transitions.push({
        target: "tasks",
        kind: "finished",
        message: `Merged automatically: ${task.title} on ${task.machineName}`,
      });
    else if (task.status === "blocked" && before.status !== "blocked")
      transitions.push({
        target: "tasks",
        kind: "failed",
        message: task.error ? `Blocked: ${task.title} — ${task.error}` : `Blocked: ${task.title}`,
      });
    if (task.needsInput && !before.needsInput)
      transitions.push({
        target: "tasks",
        kind: "input",
        message: `Waiting for you: ${task.title}`,
      });
  }
  for (const [key, automation] of next.automations) {
    const before = previous.automations.get(key);
    if (!before) continue;
    if (
      automation.lastRunStatus === "failed" &&
      (before.lastRunStatus !== "failed" || automation.lastRunAt !== before.lastRunAt)
    )
      transitions.push({
        target: "automations",
        kind: "failed",
        message: automation.lastRunError
          ? `Automation failed: ${automation.name} — ${automation.lastRunError}`
          : `Automation failed: ${automation.name}`,
      });
    if (automation.needsInput && !before.needsInput)
      transitions.push({
        target: "automations",
        kind: "input",
        message: `Waiting for you: ${automation.name}`,
      });
  }
  for (const [key, goal] of next.goals) {
    const before = previous.goals.get(key);
    if (!before || before.status === goal.status) continue;
    if (goal.status === "awaiting-approval")
      transitions.push({
        target: "tasks",
        kind: "input",
        message: `Plan ready: ${goal.title}`,
      });
    else if (goal.status === "blocked")
      transitions.push({
        target: "tasks",
        kind: "failed",
        message: goal.error
          ? `Goal blocked: ${goal.title} — ${goal.error}`
          : `Goal blocked: ${goal.title}`,
      });
    else if (goal.status === "done")
      transitions.push({
        target: "tasks",
        kind: "finished",
        message: `Goal done: ${goal.title}`,
      });
  }
  return transitions;
}
