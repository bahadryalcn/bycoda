import { canFinishTaskWithFindings } from "../../src/shared/model/host-contracts/task-findings";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import { hasShellPhysicalOwner } from "../execution/shell-ownership";
import { sessionRunState } from "../sessions/sessionRuns";
import type { TaskContext } from "./context";
import { completeWithFindings } from "./recovery";

/** Completes the exact failed result the owner saw without approving delivery. */
export async function finishWithFindings(
  context: TaskContext,
  id: string,
  expectedUpdatedAt: number,
): Promise<HostTask> {
  await context.ready;
  return context.transaction(async () => {
    await context.store.db.checkAuthorization();
    const task = await context.find(id);
    if (!task || task.updatedAt !== expectedUpdatedAt)
      throw new Error("Task changed. Refresh before finishing with findings.");
    if (!canFinishTaskWithFindings(task))
      throw new Error(
        "Only a blocked task with a retained verification failure can finish with findings.",
      );
    if (
      context.jobs.has(id) ||
      context.delivering.has(id) ||
      (await hasShellPhysicalOwner(context.store, "task", id))
    )
      throw new Error("Task work is still active. Wait for it to stop.");
    for (const run of [task, task.reviewer]) {
      if (
        run?.sessionId &&
        (
          await sessionRunState(
            context.store,
            { ...run, startedAt: run.startedAt ?? task.createdAt },
            0,
            context.now(),
          )
        ).state !== "finished"
      )
        throw new Error("Task work is not proven stopped. Inspect Host diagnostics.");
    }
    return completeWithFindings(context, task, task.error!, context.now(), "limit");
  });
}
