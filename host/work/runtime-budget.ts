import type { HostTaskBudgets } from "../tasks/task-budgets";
import type { HostStore } from "../store";
import { cancelSessionRun, type SessionRunEngine } from "../sessions/sessionRuns";

export type WorkRuntimeBudget = {
  allowanceMinutes: number;
  usedMinutes: number;
  exceeded: boolean;
  blocked: boolean;
  reason?: string;
};

/** Frozen task allowance covers every exact run in the existing ledger. Time is the observed
 * run time; a gap such as sleep adds nothing and never blocks. Only used >= allowance exhausts.
 * No wall-clock subtraction, separate total, timer or retry allowance. */
export async function readTaskRuntimeBudget(
  budgets: Pick<HostTaskBudgets, "read">,
  task: { id: string; maxRunMinutes: number },
): Promise<WorkRuntimeBudget> {
  const usage = await budgets.read({ taskId: task.id });
  const allowanceMinutes = task.maxRunMinutes;
  const exceeded = allowanceMinutes > 0 && usage.agentMinutes >= allowanceMinutes;
  return {
    allowanceMinutes,
    usedMinutes: usage.agentMinutes,
    exceeded,
    blocked: exceeded,
    ...(exceeded
      ? {
          reason:
            "The cumulative task runtime allowance is exhausted. Completed work and partial findings are retained; owner action is required.",
        }
      : {}),
  };
}

/** Stop only exact live receipts belonging to this task family. A resumed unrelated
 * turn in the same conversation never inherits an earlier run's cancellation. */
export async function stopTaskRuntimeRuns(
  store: HostStore,
  engine: SessionRunEngine,
  taskId: string,
  current?: { sessionId?: string; runId?: string },
): Promise<void> {
  const rows = await store.db
    .prepare(
      // Only open receipts can still be running; sealed runs settled long ago.
      "SELECT session_id,run_id FROM task_run_budget_ledger WHERE (task_id=? OR parent_task_id=?) AND sealed_settled_at IS NULL",
    )
    .all(taskId, taskId);
  const receipts = new Map(
    rows.map((row) => {
      const receipt = { sessionId: String(row.session_id), runId: String(row.run_id) };
      return [JSON.stringify([receipt.sessionId, receipt.runId]), receipt] as const;
    }),
  );
  if (current?.sessionId && current.runId)
    receipts.set(JSON.stringify([current.sessionId, current.runId]), {
      sessionId: current.sessionId,
      runId: current.runId,
    });
  await Promise.all(
    [...receipts.values()].map(async ({ sessionId, runId }) => {
      const session = await store.session(sessionId).catch(() => undefined);
      if (session?.status === "running" && session.runId === runId)
        await cancelSessionRun(engine, { sessionId, runId });
    }),
  );
}
