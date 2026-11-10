import { USAGE_LIMIT_RESUME_GRACE_MS } from "../../src/features/sessions/model/usageLimit";
import type { UsageLimit } from "../../src/features/sessions/model/session";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import { newRequestId } from "../../src/shared/lib/id/requestId";
import { withTimeout } from "../../src/shared/lib/withTimeout";
import { errorMessage } from "../sessions/sessionRuns";
import type { TaskContext } from "./context";

const ARM_DEADLINE_MS = 30_000;

export type TaskUsageLimit = UsageLimit;

/** Assistant goals own their workers' model pool, so their limits wait instead of blocking. */
export const isAssistantGoalTask = (task: Pick<HostTask, "goalId">): boolean =>
  task.goalId?.startsWith("assistant-") === true;

/** Armed, idle and past its reset (plus the renderer's grace): the continue turn is due. */
export function taskUsageLimitDue(limit: TaskUsageLimit, now: number): boolean {
  return (
    limit.resumeAtReset === true &&
    limit.resetsAt !== undefined &&
    now >= limit.resetsAt + USAGE_LIMIT_RESUME_GRACE_MS
  );
}

/** The limit a task's idle session is waiting on, read from the session itself. */
export async function sessionUsageLimit(
  context: Pick<TaskContext, "store">,
  task: Pick<HostTask, "sessionId">,
): Promise<TaskUsageLimit | undefined> {
  if (!task.sessionId) return undefined;
  try {
    const record = await context.store.session(task.sessionId);
    return record.status === "running" ? undefined : record.session.usageLimit;
  } catch {
    return undefined;
  }
}

/** Whether a queued task's retained session may continue now that its limit has reset. */
export async function canResumeAfterUsageLimit(
  context: Pick<TaskContext, "store">,
  task: Pick<HostTask, "sessionId">,
  now: number,
): Promise<boolean> {
  const limit = await sessionUsageLimit(context, task);
  return !!limit && taskUsageLimitDue(limit, now);
}

/** Keeps a task whose worker hit a provider usage limit waiting for the reset.
 * Returns false when the failure must follow the ordinary path (not armed and not an
 * assistant goal). The session keeps its model; once the reset passes, the task is
 * requeued with its session and continues there exactly once. */
export async function waitForUsageLimit(
  context: TaskContext,
  task: HostTask,
  limit: TaskUsageLimit,
  now: number,
): Promise<boolean> {
  if (task.crewRunId || task.crewDefinitionId) return false;
  let armed = limit.resumeAtReset === true;
  if (!armed && isAssistantGoalTask(task)) {
    try {
      await withTimeout(
        context.engine.command({
          type: "usageLimit",
          commandId: newRequestId(),
          sessionId: task.sessionId ?? "",
          action: "arm",
        }),
        ARM_DEADLINE_MS,
        "Arming the usage limit resume",
      );
      armed = true;
    } catch (error) {
      console.error("Could not arm the usage limit resume:", errorMessage(error));
      return false;
    }
  }
  if (!armed) return false;
  if (taskUsageLimitDue({ ...limit, resumeAtReset: true }, now))
    await context.requeueInterrupted(task, now);
  return true;
}
