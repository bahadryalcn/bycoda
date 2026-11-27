import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import {
  buildTaskStop,
  type TaskRepairReason,
  type TaskStop,
  type TaskStopInput,
  type TaskStopPhase,
  type TaskWait,
} from "../../src/shared/model/host-contracts/task-stop";
import type { WorkWait } from "../../src/shared/model/host-contracts/work";
import { STOPPED_BY_USER } from "../sessions/sessionRuns";
import { MODEL_ROUTING_WAIT } from "./model-routing";

/** What `block()` needs: the structured stop, plus the free-text `error` when it differs from the message. */
export type BlockReason = TaskStopInput & { error?: string };

/** The owner stopped the work; nothing resumes it automatically. */
export const OWNER_STOP: BlockReason = { code: "owner_stopped", message: STOPPED_BY_USER };

/** A failed review or check recorded on the task, else a failed run. The code and phase come from
 * the recorded verification, never from the message. */
export function verificationStop(task: HostTask, message: string): BlockReason {
  const { review, command } = task.verification ?? {};
  if (review?.verdict === "fail") return { code: "run_failed", phase: "review", message };
  if (command && (command.timedOut || command.exitCode !== 0))
    return { code: "run_failed", phase: "check", message };
  return { code: "run_failed", phase: "worker", message };
}

/** Automatic correction ended: `message` is what the owner reads, `error` the failure behind it. */
export function repairStop(repair: TaskRepairReason, message: string, error?: string): BlockReason {
  return { code: "repair_exhausted", phase: "repair", repair, message, error };
}

/** A live task paused on a question or approval; cleared when the owner answers. */
export function inputStop(phase: TaskStopPhase, at: number): TaskStop {
  return buildTaskStop(
    { code: "input_required", phase, message: "Waiting for your answer or approval." },
    at,
  );
}

/** A run hit its time limit: recorded on the active task until the cancelled turn settles, then blocked with it. */
export function runLimitStop(phase: TaskStopPhase, message: string, at: number): TaskStop {
  return buildTaskStop({ code: "budget_exhausted", phase, message }, at);
}

/** How a finished, non-successful run stopped the task. The recorded stop and the run's `cause`
 * decide the code; the provider's `error` text is detail only. */
export function runOutcomeStop(
  task: HostTask,
  outcome: { status: string; error?: string; cause?: string },
  phase: TaskStopPhase,
): BlockReason {
  const message = outcome.error ?? "The run failed.";
  if (outcome.status === "cancelled") return OWNER_STOP;
  if (outcome.cause === "host_interrupted") return { code: "host_interrupted", phase, message };
  if (task.stop?.code === "budget_exhausted") return { code: "budget_exhausted", phase, message };
  if (outcome.cause === "owner_gate")
    return { code: "permission_required", phase, message, actor: "owner", nextAction: "retry" };
  return { code: "run_failed", phase, message };
}

/** The model-routing wait of a task: no eligible entry until a limit or account recovers. */
export function modelQuotaWait(resolution: { nextResetAt?: number }): TaskWait {
  return {
    code: "model_quota",
    message: MODEL_ROUTING_WAIT,
    ...(resolution.nextResetAt !== undefined ? { retryAt: resolution.nextResetAt } : {}),
  };
}

/** A task is not waiting on a reset that is still ahead. */
export function taskWaitDue(task: Pick<HostTask, "wait">, now: number): boolean {
  const retryAt = task.wait?.retryAt;
  return retryAt === undefined || now >= retryAt;
}

export function sameWait(a: TaskWait | undefined, b: TaskWait | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The owner changed instructions or settings: nothing resumes until they restart the task. */
export function restartHold(at: number): TaskStop {
  return buildTaskStop(
    {
      code: "owner_stopped",
      message: "Instructions or settings changed. Retry to run it again.",
      nextAction: "restart",
    },
    at,
  );
}

/** The task wait a deferred shared-Work admission stands for. */
export function taskWaitFromWork(wait: WorkWait): TaskWait {
  const codes: Record<WorkWait["code"], TaskWait["code"]> = {
    capacity: "model_quota",
    projectCapacity: "model_quota",
    model: "model_quota",
    configuration: "model_quota",
    dailyLimit: "daily_limit",
    usageLimit: "usage_limit",
    dependency: "dependency",
    permission: "assistant_hold",
    owner: "assistant_hold",
  };
  return { code: codes[wait.code], message: wait.message };
}
