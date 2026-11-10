import type { RemoteProvider } from "../../src/features/connections/model/protocol";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import type { TaskContext } from "./context";
import { isAssistantGoalTask } from "./usage-limit";

export type RepointInput = {
  taskId: string;
  /** The task revision the caller decided from; any later edit or start refuses the change. */
  expectedUpdatedAt: number;
  harness: RemoteProvider;
  providerAccountId?: string;
  model: string;
  modelSettings: Record<string, string>;
};

/** Moves a queued assistant-goal task that has not started onto another model.
 * Running, started, crew and non-assistant tasks are never changed. Returns the
 * saved task, or undefined when the task no longer qualifies. */
export async function repointUnstartedTask(
  context: TaskContext,
  input: RepointInput,
): Promise<HostTask | undefined> {
  await context.ready;
  return context.store.db.scope(async () => {
    const expected = await context.taskValue(input.taskId);
    return await context.store.transaction(async () => {
      const task = await context.unchangedTask(input.taskId, expected);
      if (
        !task ||
        task.updatedAt !== input.expectedUpdatedAt ||
        task.status !== "queued" ||
        task.sessionId ||
        task.runId ||
        task.crewDefinitionId ||
        !isAssistantGoalTask(task) ||
        context.jobs.has(task.id)
      )
        return undefined;
      return await context.write({
        ...task,
        harness: input.harness,
        providerAccountId: input.providerAccountId,
        model: input.model,
        modelSettings: input.modelSettings,
        updatedAt: context.now(),
      });
    });
  });
}
