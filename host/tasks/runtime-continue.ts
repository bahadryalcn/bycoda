import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import { usageUpperBoundMinutes } from "../../src/features/tasks/model/taskBudget";
import { hasShellPhysicalOwner } from "../execution/shell-ownership";
import { assertTaskWorkRetired } from "../work/session-adapter";
import type { TaskContext } from "./context";

/**
 * Owner decision for a blocked task whose earlier runtime includes an unverified interval that may
 * reach its limit: accept that uncertainty and continue with `minutes` more on top of the verified
 * runtime. The accepted uncertainty is recorded and not counted again; the task stays blocked
 * until the owner starts it.
 */
export async function continueRuntime(
  context: TaskContext,
  id: string,
  minutes: number,
): Promise<HostTask> {
  await context.ready;
  if (!Number.isFinite(minutes) || minutes <= 0)
    throw new Error("Choose a positive number of minutes.");
  return context.transaction(async () => {
    await context.store.db.checkAuthorization();
    const task = await context.find(id);
    if (!task) throw new Error("Task not found.");
    if (task.status !== "blocked" || task.maxRunMinutes <= 0)
      throw new Error("Only a blocked task with a runtime limit can continue with more minutes.");
    if (
      context.jobs.has(id) ||
      context.delivering.has(id) ||
      (await hasShellPhysicalOwner(context.store, "task", id))
    )
      throw new Error("Task work is still active. Wait for it to stop.");
    await assertTaskWorkRetired(context.store, id);
    const usage = await context.budgets.read({ taskId: id });
    const upper = usageUpperBoundMinutes(usage, task.runtimeAccepted);
    if (usage.agentMinutes >= task.maxRunMinutes || (upper !== null && upper < task.maxRunMinutes))
      throw new Error("This task has no unverified runtime that needs an owner decision.");
    return await context.write({
      ...task,
      maxRunMinutes: Math.ceil(usage.agentMinutes) + minutes,
      runtimeAccepted: {
        extraMinutes: usage.uncertainty?.extraMinutes ?? 0,
        unboundedRuns: usage.uncertainty?.unboundedRuns ?? 0,
        at: context.now(),
      },
      budgetStop: undefined,
      awaitingOwnerRestart: true,
      updatedAt: context.now(),
    });
  });
}
