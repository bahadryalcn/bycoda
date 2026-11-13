import type { HostTaskBudgets } from "../tasks/task-budgets";
import type { HostStore } from "../store";
import { cancelSessionRun, type SessionRunEngine } from "../sessions/sessionRuns";

export type WorkRuntimeBudget = {
  allowanceMinutes: number;
  confirmedMinutes: number;
  /** Null retains unknown intervals rather than presenting a lower bound as total. */
  usedMinutes: number | null;
  historyComplete: boolean;
  exceeded: boolean;
  blocked: boolean;
  reason?: string;
};

/** Frozen task allowance covers every exact run in the existing ledger.
 * No wall-clock subtraction, separate total, timer or retry allowance. */
export async function readTaskRuntimeBudget(
  budgets: Pick<HostTaskBudgets, "read">,
  task: { id: string; maxRunMinutes: number },
  starting = false,
): Promise<WorkRuntimeBudget> {
  const usage = await budgets.read({ taskId: task.id });
  const allowanceMinutes = task.maxRunMinutes;
  const exceeded = allowanceMinutes > 0 && usage.agentMinutes >= allowanceMinutes;
  const unknown = allowanceMinutes > 0 && !usage.historyComplete;
  const reason = exceeded
    ? "The cumulative task runtime allowance is exhausted. Completed work and partial findings are retained; owner action is required."
    : starting && unknown
      ? "Earlier task runtime includes an unknown interval. Owner action is required before another run; completed work is retained."
      : undefined;
  return {
    allowanceMinutes,
    confirmedMinutes: usage.agentMinutes,
    usedMinutes: usage.historyComplete ? usage.agentMinutes : null,
    historyComplete: usage.historyComplete,
    exceeded,
    blocked: reason !== undefined,
    ...(reason ? { reason } : {}),
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
      "SELECT session_id,run_id FROM task_run_budget_ledger WHERE task_id=? OR parent_task_id=?",
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
