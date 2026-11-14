import type { HostStore } from "../store";
import type { WorkRecord } from "../../src/shared/model/host-contracts/work";
import type { BudgetRunRegistration } from "../tasks/task-budgets";

/** Resolve only the persisted receipt for this exact parent turn. */
export async function delegationWorkRoot(
  store: HostStore,
  sessionId: string,
  parentRunId: string | undefined,
): Promise<string | undefined> {
  // The scoped caller resolves Native and Host sessions. Only a Host run can
  // own an unattended Work receipt; never manufacture one for a Native turn.
  if (!parentRunId || !store.db) return undefined;
  const tables = await store.db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('work_queue','task_run_budget_ledger')",
    )
    .all();
  if (tables.some((row) => row.name === "work_queue")) {
    const rows = await store.db.prepare("SELECT value FROM work_queue").all();
    for (const row of rows) {
      const work = JSON.parse(String(row.value)) as WorkRecord;
      if (work.receipt?.sessionId === sessionId && work.receipt.runId === parentRunId)
        return work.rootWorkId;
    }
  }
  if (tables.some((row) => row.name === "task_run_budget_ledger")) {
    const row = await store.db
      .prepare("SELECT value FROM task_run_budget_ledger WHERE session_id=? AND run_id=?")
      .get(sessionId, parentRunId);
    if (row) {
      const run = JSON.parse(String(row.value)) as BudgetRunRegistration;
      return (
        run.rootWorkId ??
        (run.taskId ? `task:${run.taskId}` : run.goalId ? `goal:${run.goalId}` : undefined)
      );
    }
  }
  return undefined;
}

/** Keep the originating task, parent task and goal in the single usage ledger. */
export async function delegationBudgetScope(
  store: HostStore,
  sessionId: string,
  parentRunId: string | undefined,
) {
  if (!parentRunId || !store.db) return undefined;
  if (
    !(await store.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='task_run_budget_ledger'",
      )
      .get())
  )
    return undefined;
  const row = await store.db
    .prepare("SELECT value FROM task_run_budget_ledger WHERE session_id=? AND run_id=?")
    .get(sessionId, parentRunId);
  if (!row) return undefined;
  const { taskId, parentTaskId, goalId } = JSON.parse(String(row.value)) as BudgetRunRegistration;
  return {
    ...(taskId ? { taskId } : {}),
    ...(parentTaskId ? { parentTaskId } : {}),
    ...(goalId ? { goalId } : {}),
  };
}
