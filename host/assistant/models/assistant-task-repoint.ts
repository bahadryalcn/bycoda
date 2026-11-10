import type { HostTask } from "../../../src/features/tasks/model/hostTasks";
import type { AssistantProfile } from "../../../src/shared/model/host-contracts/assistant";
import type { HostTasks } from "../../tasks/tasks";
import { assistantWorkerModelSettings } from "../work/assistant-worker-settings";
import type { AssistantModelSelector } from "./assistant-model-execution";

const sameAccount = (a: string | undefined, b: string | undefined) =>
  (a ?? "default") === (b ?? "default");

/** Moves queued, not-yet-started tasks of an assistant goal to the first pool row that is
 * eligible now, so work that has not begun does not wait on a limited model. Started tasks keep
 * their model; with no eligible row (or no saved pool) every task is left as it is and waits. */
export async function repointUnstartedGoalTasks(input: {
  tasks: Pick<HostTasks, "repointUnstartedTask">;
  selector: AssistantModelSelector | undefined;
  profile: AssistantProfile;
  children: readonly HostTask[];
}): Promise<number> {
  const unstarted = input.children.filter(
    (task) =>
      task.status === "queued" &&
      !task.sessionId &&
      !task.runId &&
      !task.crewDefinitionId &&
      task.goalId?.startsWith("assistant-"),
  );
  if (!unstarted.length || !input.selector) return 0;
  const choice = await input.selector("worker", input.profile);
  if (!choice || "held" in choice) return 0;
  const { execution } = choice;
  let moved = 0;
  for (const task of unstarted) {
    if (
      task.harness === execution.harness &&
      task.model === execution.model &&
      sameAccount(task.providerAccountId, execution.providerAccountId)
    )
      continue;
    const saved = await input.tasks.repointUnstartedTask({
      taskId: task.id,
      expectedUpdatedAt: task.updatedAt,
      harness: execution.harness,
      ...(execution.providerAccountId ? { providerAccountId: execution.providerAccountId } : {}),
      model: execution.model,
      modelSettings: assistantWorkerModelSettings(input.profile, execution),
    });
    if (saved) moved++;
  }
  return moved;
}
