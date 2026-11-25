import type { TaskHelper } from "../../src/shared/model/host-contracts/tasks";
import type { DelegationRecord } from "./store";

/** Most helpers one read returns; newest first, so a long task keeps its latest. */
export const MAX_TASK_HELPERS = 100;

/**
 * The delegation records that belong to a task, as the task detail shows them. The task's
 * `budgetScope` binds a helper to it, so a helper that a worker or the reviewer started is
 * found by the task, never by session id alone. A record carries no result text or cost.
 */
export function taskHelpers(
  records: readonly DelegationRecord[],
  options: { taskId?: string; failedOnly?: boolean },
): TaskHelper[] {
  const found: TaskHelper[] = [];
  for (const record of records) {
    const taskId = record.budgetScope?.taskId;
    if (!taskId || (options.taskId !== undefined && taskId !== options.taskId)) continue;
    const status = record.status ?? "running";
    if (options.failedOnly && status !== "failed") continue;
    found.push({
      runId: record.runId,
      taskId,
      kind: record.kind,
      title: record.title,
      harness: record.model.harness,
      model: record.model.model,
      ...(record.childSessionId ? { childSessionId: record.childSessionId } : {}),
      status,
      startedAt: record.startedAt,
      ...(record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt }),
      ...(record.error ? { error: record.error } : {}),
    });
  }
  return found.sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_TASK_HELPERS);
}
