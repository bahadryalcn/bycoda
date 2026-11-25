import { t } from "../i18n";
import { taskNeedsInput } from "./host-contracts/task-stop";
import {
  firstSentence,
  taskStopSummary,
  type TaskStopSummary,
  type TaskStopSummaryInput,
} from "./taskStopSummary";

/**
 * The one status projection: where a piece of work stands (`phase`) and, when it is stopped or
 * waiting, why (`stop`, `wait`). Task cards, goals, automation occurrences, the assistant's
 * tracked-work reader and voice status answers all read it; none derives its own state.
 */

export const WORK_PHASES = [
  "pending",
  "running",
  "input",
  "review",
  "done",
  "stopped",
  "cancelled",
] as const;
export type WorkPhase = (typeof WORK_PHASES)[number];

export type WorkProjection = {
  phase: WorkPhase;
  /** Why the work stopped; present for `stopped` and `cancelled`, or a live task asking the owner. */
  stop?: TaskStopSummary;
  /** Why the work has not started or is held back. */
  wait?: TaskStopSummary;
};

/** Phase, stop and wait of one task; the summary text comes from `taskStopSummary`. */
export function projectTask(task: TaskStopSummaryInput): WorkProjection {
  const summary = taskStopSummary(task);
  const phase: WorkPhase =
    task.status === "done"
      ? "done"
      : task.status === "review"
        ? "review"
        : task.status === "blocked"
          ? task.stop?.code === "owner_stopped"
            ? "cancelled"
            : "stopped"
          : task.status === "running" || task.status === "verifying"
            ? taskNeedsInput(task)
              ? "input"
              : "running"
            : "pending";
  if (!summary) return { phase };
  return task.stop || task.status === "blocked"
    ? { phase, stop: summary }
    : { phase, wait: summary };
}

/** A goal as the projection reads it. */
export type GoalProjectionInput = {
  status: "planning" | "awaiting-approval" | "running" | "done" | "blocked" | "cancelled";
  error?: string;
  planError?: string;
};

/** Phase of a goal from its own status and its tasks; a blocked goal shows its first blocked task's stop. */
export function projectGoal(
  goal: GoalProjectionInput,
  tasks: readonly TaskStopSummaryInput[],
): WorkProjection {
  switch (goal.status) {
    case "done":
      return { phase: "done" };
    case "cancelled":
      return { phase: "cancelled" };
    case "awaiting-approval":
      return { phase: "input" };
    case "planning":
      return { phase: "running" };
    case "blocked": {
      const child = tasks.map(projectTask).find((entry) => entry.stop);
      if (child?.stop) return { phase: "stopped", stop: child.stop };
      return {
        phase: "stopped",
        stop: {
          code: "unrecorded",
          title: t("Blocked"),
          reason: firstSentence(goal.error ?? goal.planError),
          tone: "danger",
        },
      };
    }
    case "running": {
      const projections = tasks.map(projectTask);
      return {
        phase: projections.some((entry) => entry.phase === "input") ? "input" : "running",
      };
    }
  }
}

/** The status an automation occurrence takes from the phase of the work it started. */
export function automationRunStatusOf(
  phase: WorkPhase,
  cancellationRequested?: boolean,
): "pending" | "running" | "succeeded" | "failed" | "cancelled" {
  switch (phase) {
    case "done":
      return "succeeded";
    case "stopped":
      return cancellationRequested ? "cancelled" : "failed";
    case "cancelled":
      return "cancelled";
    case "pending":
      return "pending";
    case "running":
    case "input":
    case "review":
      return "running";
  }
}

type ProgressTask = { id: string; title: string; status: string; dependsOn?: string[] };

/** Array consumers only need to index this goal, rather than the archive. */
function indexGoalTasks<T extends { id: string }>(ids: readonly string[], all: readonly T[]) {
  const wanted = new Set(ids);
  const byId = new Map<string, T>();
  for (const task of all) {
    if (wanted.has(task.id) && !byId.has(task.id)) byId.set(task.id, task);
  }
  return byId;
}

/** How far a goal's tasks have got. */
export function goalProgress(
  goal: { taskIds: readonly string[] },
  tasks: readonly { id: string; status: string }[],
): { done: number; total: number } {
  const byId = indexGoalTasks(goal.taskIds, tasks);
  const own = goal.taskIds.flatMap((id) => {
    const task = byId.get(id);
    return task ? [task] : [];
  });
  return {
    done: own.filter((task) => task.status === "done").length,
    total: own.length,
  };
}

/** Where a goal that has tasks stands: done once every task is done; blocked
 * while some task is blocked and none can make progress, i.e. nothing runs,
 * waits in review, or waits in the queue on dependencies that can still
 * finish; running otherwise. */
export function goalStateFromTasks(
  goal: { taskIds: readonly string[] },
  all: readonly ProgressTask[] | ReadonlyMap<string, ProgressTask>,
): { status: "running" | "done" | "blocked"; error?: string } {
  const byId: ReadonlyMap<string, ProgressTask> = Array.isArray(all)
    ? indexGoalTasks(goal.taskIds, all)
    : (all as ReadonlyMap<string, ProgressTask>);
  let dependencies = byId;
  const tasks = goal.taskIds.flatMap((id) => {
    const task = byId.get(id);
    return task ? [task] : [];
  });
  if (tasks.length === 0)
    return {
      status: "blocked",
      error: "All of this goal’s tasks were deleted.",
    };
  if (tasks.every((task) => task.status === "done")) return { status: "done" };
  const blocked = tasks.filter((task) => task.status === "blocked");
  if (blocked.length === 0) return { status: "running" };
  // A queued task is stuck when something it waits for, directly or not, is
  // blocked.
  const stuck = new Map<string, boolean>();
  const isStuck = (task: ProgressTask, seen: Set<string>): boolean => {
    if (task.status === "blocked") return true;
    if (task.status !== "queued") return false;
    const known = stuck.get(task.id);
    if (known !== undefined) return known;
    if (seen.has(task.id)) return true;
    seen.add(task.id);
    const result = (task.dependsOn ?? []).some((id) => {
      // Cross-goal dependencies need the complete pass index. Array callers
      // build it lazily once; host callers already supply that complete index.
      if (!dependencies.has(id) && dependencies === byId && Array.isArray(all))
        dependencies = new Map(all.map((entry) => [entry.id, entry]));
      const dependency = dependencies.get(id);
      return dependency ? isStuck(dependency, seen) : false;
    });
    stuck.set(task.id, result);
    return result;
  };
  const moving = tasks.some(
    (task) => task.status !== "done" && task.status !== "blocked" && !isStuck(task, new Set()),
  );
  if (moving) return { status: "running" };
  return {
    status: "blocked",
    error: `${blocked.length} of ${tasks.length} task${tasks.length === 1 ? "" : "s"} blocked: ${blocked
      .map((task) => task.title)
      .join(", ")}`,
  };
}
