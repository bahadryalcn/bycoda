import { z } from "zod";
import { SafeCounterSchema } from "./schemas";

/** Why a task stopped. Behaviour and every owner-facing surface read the code, never `error` text. */
export const TASK_STOP_CODES = [
  "owner_stopped",
  "host_interrupted",
  "budget_exhausted",
  "run_failed",
  "repair_exhausted",
  "preparation_failed",
  "permission_required",
  "input_required",
  "dependency_cycle",
  "dependency_stopped",
  "crew_unavailable",
  "working_copy_changed",
  "cleanup_failed",
  "restored",
  "scheduling_failed",
] as const;
export type TaskStopCode = (typeof TASK_STOP_CODES)[number];

/** Why a queued task has not started yet. */
export const TASK_WAIT_CODES = [
  "model_quota",
  "usage_limit",
  "daily_limit",
  "crew_capacity",
  "dependency",
  "assistant_hold",
] as const;
export type TaskWaitCode = (typeof TASK_WAIT_CODES)[number];

export const TASK_NEXT_ACTIONS = [
  "retry",
  "takeover",
  "raise_budget",
  "provide_input",
  "fix_dependency",
  "restart",
  "none",
] as const;
export type TaskNextAction = (typeof TASK_NEXT_ACTIONS)[number];

export const TASK_STOP_ACTORS = ["owner", "host", "provider"] as const;
export type TaskStopActor = (typeof TASK_STOP_ACTORS)[number];

/** Where in the task lifecycle the stop happened. */
export const TASK_STOP_PHASES = [
  "preparation",
  "worker",
  "check",
  "review",
  "repair",
  "delivery",
  "cleanup",
  "scheduling",
  "crew",
] as const;
export type TaskStopPhase = (typeof TASK_STOP_PHASES)[number];

/** Detail of `repair_exhausted`: the repair loop ended on an external check, no progress or its limit. */
export const TASK_REPAIR_REASONS = ["external", "no_progress", "limit"] as const;
export type TaskRepairReason = (typeof TASK_REPAIR_REASONS)[number];

export const TaskStopCodeSchema = z.enum(TASK_STOP_CODES);
export const TaskWaitCodeSchema = z.enum(TASK_WAIT_CODES);

export const TaskStopSchema = z.strictObject({
  code: TaskStopCodeSchema,
  phase: z.enum(TASK_STOP_PHASES).optional(),
  attempt: z.number().optional(),
  /** Detail only; never classify by it. */
  message: z.string(),
  actor: z.enum(TASK_STOP_ACTORS),
  nextAction: z.enum(TASK_NEXT_ACTIONS),
  at: SafeCounterSchema,
  repair: z.enum(TASK_REPAIR_REASONS).optional(),
});
export type TaskStop = z.infer<typeof TaskStopSchema>;

export const TaskWaitSchema = z.strictObject({
  code: TaskWaitCodeSchema,
  retryAt: SafeCounterSchema.optional(),
  /** The unfinished dependency, with its stop code once it is blocked. */
  waitsOn: z.strictObject({ taskId: z.string(), code: TaskStopCodeSchema.optional() }).optional(),
  /** A crew Work occurrence that was never dispatched; its run time is retracted. */
  unstarted: z.boolean().optional(),
  message: z.string(),
});
export type TaskWait = z.infer<typeof TaskWaitSchema>;

/** What a call site supplies; actor, next action and time default from the code. */
export type TaskStopInput = {
  code: TaskStopCode;
  message: string;
  phase?: TaskStopPhase;
  attempt?: number;
  actor?: TaskStopActor;
  nextAction?: TaskNextAction;
  repair?: TaskRepairReason;
};

const DEFAULTS: Record<TaskStopCode, { actor: TaskStopActor; nextAction: TaskNextAction }> = {
  owner_stopped: { actor: "owner", nextAction: "retry" },
  host_interrupted: { actor: "host", nextAction: "retry" },
  budget_exhausted: { actor: "host", nextAction: "raise_budget" },
  run_failed: { actor: "provider", nextAction: "retry" },
  repair_exhausted: { actor: "host", nextAction: "provide_input" },
  preparation_failed: { actor: "host", nextAction: "retry" },
  permission_required: { actor: "owner", nextAction: "provide_input" },
  input_required: { actor: "owner", nextAction: "provide_input" },
  dependency_cycle: { actor: "host", nextAction: "fix_dependency" },
  dependency_stopped: { actor: "host", nextAction: "fix_dependency" },
  crew_unavailable: { actor: "host", nextAction: "retry" },
  working_copy_changed: { actor: "host", nextAction: "retry" },
  cleanup_failed: { actor: "host", nextAction: "retry" },
  restored: { actor: "host", nextAction: "retry" },
  scheduling_failed: { actor: "host", nextAction: "retry" },
};

/** The stored stop for a call site's input. */
export function buildTaskStop(input: TaskStopInput, at: number): TaskStop {
  const defaults = DEFAULTS[input.code];
  return {
    code: input.code,
    ...(input.phase ? { phase: input.phase } : {}),
    ...(input.attempt !== undefined ? { attempt: input.attempt } : {}),
    message: input.message,
    actor: input.actor ?? defaults.actor,
    nextAction: input.nextAction ?? defaults.nextAction,
    at,
    ...(input.repair ? { repair: input.repair } : {}),
  };
}

/** Structural shape every reader of a task's stop/wait needs; HostTask and raw Host rows both fit. */
export type TaskStopFields = { stop?: TaskStop; wait?: TaskWait };

/** The task is paused on the owner: a question, an approval or instructions to change. */
export function taskNeedsInput(task: { stop?: { nextAction: string } }): boolean {
  return task.stop?.nextAction === "provide_input";
}

/** Instructions or settings changed after a stop; nothing resumes the work until the owner restarts it. */
export function taskAwaitsRestart(task: { stop?: { nextAction: string } }): boolean {
  return task.stop?.nextAction === "restart";
}

/** Whether a stop may be stored on a task in this status: always when blocked, otherwise only while
 * an active task waits for the owner's answer or an edited task waits for the owner to restart it. */
export function stopFitsStatus(task: TaskStopFields & { status: string }): boolean {
  if (!task.stop) return true;
  if (task.status === "blocked") return true;
  if (task.status === "todo") return taskAwaitsRestart(task);
  if (task.status === "queued" || task.status === "running" || task.status === "verifying")
    return (
      task.stop.code === "input_required" ||
      // A run past its time limit, until its cancelled turn settles and blocks the task.
      task.stop.code === "budget_exhausted" ||
      taskAwaitsRestart(task)
    );
  return false;
}

/** A wait belongs to a queued task, or to a task idle until its provider usage limit resets. */
export function waitFitsStatus(task: TaskStopFields & { status: string }): boolean {
  if (!task.wait) return true;
  return (
    task.status === "queued" || (task.status === "running" && task.wait.code === "usage_limit")
  );
}
