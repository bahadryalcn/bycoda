import type { BoardTask } from "./taskClient";
import { hasUnmergedBranch, orderTasksForDeletion, taskRequiresInstructions } from "./taskRules";

export type TaskBulkAction = "delete" | "start" | "stop" | "retry";
export type TaskBulkResult = {
  task: BoardTask;
  status: "succeeded" | "skipped" | "failed";
  reason?: string;
};

export const bulkTaskKey = (task: Pick<BoardTask, "machineId" | "projectId" | "id">): string =>
  JSON.stringify([task.machineId, task.projectId, task.id]);

/** The host revalidates state; a stale board never grants permission to mutate. */
export function taskBulkUnavailable(task: BoardTask, action: TaskBulkAction): string | undefined {
  if (task.stale) return "Reconnect this machine before changing its tasks.";
  if (task.crewRunId) return "Manage this assignment from its crew.";
  const active = task.status === "running" || task.status === "verifying";
  if (action === "delete") {
    if (active || (task.deliveryRequested && task.status !== "done"))
      return "Stop active work before deleting this task.";
    if (hasUnmergedBranch(task))
      return "Unmerged work is protected. Review or discard it individually.";
    return;
  }
  if (action === "stop") return active ? undefined : "This task is not running.";
  if (action === "start" && task.status !== "todo") return "Only tasks in To do can be started.";
  if (action === "retry" && task.status !== "blocked") return "Only blocked tasks can be retried.";
  if (!task.prompt.trim() || taskRequiresInstructions(task))
    return "Update this task's instructions before starting it.";
}

/** One serial queue per machine; independent hosts progress without blocking each other.
 * Results are retained individually, so a retry can target failed items only.
 * Selection is copied and deduplicated before the first mutation. No branch discard.
 */
export async function runTaskBulkAction(
  selected: readonly BoardTask[],
  action: TaskBulkAction,
  perform: (task: BoardTask, action: TaskBulkAction) => Promise<void>,
  onResult?: (result: TaskBulkResult, completed: number, total: number) => void,
): Promise<TaskBulkResult[]> {
  const tasks = [...new Map(selected.map((task) => [bulkTaskKey(task), task])).values()];
  const results: TaskBulkResult[] = [];
  const groups = new Map<string, { task: BoardTask; index: number }[]>();
  tasks.forEach((task, index) => {
    const group = groups.get(task.machineId) ?? [];
    group.push({ task, index });
    groups.set(task.machineId, group);
  });
  let completed = 0;
  await Promise.all(
    [...groups.values()].map(async (group) => {
      const identities = new Map(group.map((row) => [row.task.id, row]));
      const ordered =
        action === "delete"
          ? orderTasksForDeletion(group.map((row) => row.task)).map((task) =>
              identities.get(task.id)!,
            )
          : group;
      for (const { task, index } of ordered) {
        const reason = taskBulkUnavailable(task, action);
        let result: TaskBulkResult;
        if (reason) result = { task, status: "skipped", reason };
        else {
          try {
            await perform(task, action);
            result = { task, status: "succeeded" };
          } catch (error) {
            result = {
              task,
              status: "failed",
              reason: error instanceof Error ? error.message : String(error),
            };
          }
        }
        results[index] = result;
        onResult?.(result, ++completed, tasks.length);
        // Fast local replies must still yield to rendering/input between bounded
        // chunks. A long microtask chain can otherwise exhaust React's update limit.
        if (completed % 8 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }),
  );
  return results;
}
